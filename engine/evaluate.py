from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sdmetrics.reports import QualityReport


@dataclass(frozen=True)
class Evaluation:
    final_count: int
    achieved_mean: float
    target_mean: float
    absolute_error: float
    duplicate_row_count: int
    quality_score: float | None
    quality_warning: str | None


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
) -> Evaluation:
    if len(final) != expected_final_count:
        raise RuntimeError(
            f"Final dataset has {len(final)} rows; expected {expected_final_count}"
        )

    target_values = pd.to_numeric(final[target_column], errors="coerce")
    if target_values.isna().any():
        raise RuntimeError("Final dataset contains an unanswered or invalid mean target value")
    if not target_values.between(target_min, target_max).all():
        raise RuntimeError("Final dataset contains a target score outside the allowed range")

    achieved_mean = float(target_values.mean())
    absolute_error = abs(achieved_mean - target_mean)

    comparison_columns = [column for column in final.columns if column not in {id_column, "__origin"}]
    duplicate_row_count = int(final.duplicated(subset=comparison_columns, keep=False).sum())

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
        quality_score=quality_score,
        quality_warning=quality_warning,
    )
