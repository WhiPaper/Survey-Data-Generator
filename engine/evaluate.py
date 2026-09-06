from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import pandas as pd
from scipy.stats import ks_2samp
from sdmetrics.reports import QualityReport


@dataclass(frozen=True)
class Evaluation:
    final_count: int
    achieved_mean: float
    target_mean: float
    absolute_error: float
    duplicate_row_count: int
    max_fingerprint_count: int
    max_fingerprint_share: float
    source_clone_count: int
    source_clone_rate: float
    timestamp_ks_statistic: float | None
    timestamp_median_delta_seconds: float | None
    quality_score: float | None
    quality_warning: str | None
    means: tuple["MeanEvaluation", ...] = ()


@dataclass(frozen=True)
class MeanEvaluation:
    id: str
    column: str
    requested: float
    achieved: float
    absolute_error: float


def _row_diagnostics(
    source: pd.DataFrame,
    synthetic: pd.DataFrame,
    final: pd.DataFrame,
    *,
    id_column: str,
) -> tuple[int, int, float, int, float]:
    comparison_columns = [
        column for column in final.columns if column not in {id_column, "__origin"}
    ]
    duplicate_row_count = int(final.duplicated(subset=comparison_columns, keep=False).sum())
    if synthetic.empty:
        return duplicate_row_count, 0, 0.0, 0, 0.0

    synthetic_fingerprints = pd.util.hash_pandas_object(
        synthetic[comparison_columns],
        index=False,
    )
    max_fingerprint_count = int(synthetic_fingerprints.value_counts().max())
    max_fingerprint_share = max_fingerprint_count / len(synthetic)

    source_fingerprints = set(
        pd.util.hash_pandas_object(source[comparison_columns], index=False).tolist()
    )
    source_clone_count = sum(
        int(fingerprint in source_fingerprints) for fingerprint in synthetic_fingerprints
    )
    source_clone_rate = source_clone_count / len(synthetic)
    return (
        duplicate_row_count,
        max_fingerprint_count,
        max_fingerprint_share,
        source_clone_count,
        source_clone_rate,
    )


def _timestamps(data: pd.DataFrame, column: str, label: str) -> pd.Series:
    if column not in data.columns:
        raise RuntimeError(f"{label} dataset is missing timestamp column: {column}")
    values = pd.to_datetime(data[column], utc=True, errors="coerce")
    if values.isna().any():
        raise RuntimeError(f"{label} dataset contains invalid timestamps")
    return values


def _timestamp_diagnostics(
    source: pd.DataFrame,
    synthetic: pd.DataFrame,
    final: pd.DataFrame,
    *,
    timestamp_column: str | None,
    timestamp_start: pd.Timestamp | None = None,
    timestamp_end: pd.Timestamp | None = None,
) -> tuple[float | None, float | None]:
    if timestamp_column is None:
        return None, None

    source_values = _timestamps(source, timestamp_column, "SourceScope")
    final_values = _timestamps(final, timestamp_column, "Final")
    if timestamp_start is not None and (final_values < timestamp_start).any():
        raise RuntimeError("Final dataset contains a timestamp before the frozen time scope")
    if timestamp_end is not None and (final_values > timestamp_end).any():
        raise RuntimeError("Final dataset contains a timestamp after the frozen time scope")
    if synthetic.empty:
        return None, None

    synthetic_values = _timestamps(synthetic, timestamp_column, "Synthetic")
    source_ns = source_values.astype("int64").to_numpy(dtype=float)
    synthetic_ns = synthetic_values.astype("int64").to_numpy(dtype=float)
    ks_statistic = float(ks_2samp(source_ns, synthetic_ns, method="auto").statistic)
    median_delta_seconds = float(
        (synthetic_values.median() - source_values.median()).total_seconds()
    )
    return ks_statistic, median_delta_seconds


def evaluate_result(
    source: pd.DataFrame,
    synthetic: pd.DataFrame,
    final: pd.DataFrame,
    *,
    metadata: dict[str, object],
    id_column: str,
    target_column: str,
    target_mean: float,
    target_min: int,
    target_max: int,
    expected_final_count: int,
    timestamp_column: str | None = None,
    timestamp_start: pd.Timestamp | None = None,
    timestamp_end: pd.Timestamp | None = None,
    mean_targets: Sequence[tuple[str, str, float, int, int]] | None = None,
) -> Evaluation:
    if len(final) != expected_final_count:
        raise RuntimeError(
            f"Final dataset has {len(final)} rows; expected {expected_final_count}"
        )

    resolved_means = tuple(mean_targets or (("mean", target_column, target_mean, target_min, target_max),))
    evaluated_means: list[MeanEvaluation] = []
    for target_id, column, requested, minimum, maximum in resolved_means:
        target_values = pd.to_numeric(final[column], errors="coerce")
        if target_values.isna().any(): raise RuntimeError("Final dataset contains an unanswered or invalid mean target value")
        if not target_values.between(minimum, maximum).all(): raise RuntimeError("Final dataset contains a target score outside the allowed range")
        achieved = float(target_values.mean())
        evaluated_means.append(MeanEvaluation(target_id, column, requested, achieved, abs(achieved - requested)))
    achieved_mean = evaluated_means[0].achieved if evaluated_means else 0.0
    absolute_error = evaluated_means[0].absolute_error if evaluated_means else 0.0
    (
        duplicate_row_count,
        max_fingerprint_count,
        max_fingerprint_share,
        source_clone_count,
        source_clone_rate,
    ) = _row_diagnostics(source, synthetic, final, id_column=id_column)
    timestamp_ks_statistic, timestamp_median_delta_seconds = _timestamp_diagnostics(
        source,
        synthetic,
        final,
        timestamp_column=timestamp_column,
        timestamp_start=timestamp_start,
        timestamp_end=timestamp_end,
    )

    quality_score: float | None = None
    quality_warning: str | None = None
    if len(synthetic) > 0:
        real_model = source.drop(columns=[id_column], errors="ignore").copy()
        synthetic_model = synthetic.drop(columns=[id_column, "__origin"], errors="ignore").copy()
        try:
            report = QualityReport()
            report.generate(
                real_model,
                synthetic_model,
                metadata,
                verbose=False,
            )
            quality_score = float(report.get_score())
        except Exception as error:  # SDMetrics is diagnostic, hard product validation remains authoritative.
            quality_warning = str(error)

    return Evaluation(
        final_count=len(final),
        achieved_mean=achieved_mean,
        target_mean=target_mean,
        absolute_error=absolute_error,
        duplicate_row_count=duplicate_row_count,
        max_fingerprint_count=max_fingerprint_count,
        max_fingerprint_share=max_fingerprint_share,
        source_clone_count=source_clone_count,
        source_clone_rate=source_clone_rate,
        timestamp_ks_statistic=timestamp_ks_statistic,
        timestamp_median_delta_seconds=timestamp_median_delta_seconds,
        quality_score=quality_score,
        quality_warning=quality_warning,
        means=tuple(evaluated_means),
    )
