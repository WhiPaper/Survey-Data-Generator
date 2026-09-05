from __future__ import annotations

import math
import random
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sdv.metadata import Metadata
from sdv.sampling import Condition
from sdv.single_table import GaussianCopulaSynthesizer


TABLE_NAME = "table"


@dataclass(frozen=True)
class CandidatePool:
    data: pd.DataFrame
    metadata: dict[str, object]


def _model_frame(source: pd.DataFrame, id_column: str) -> pd.DataFrame:
    if id_column not in source.columns:
        raise ValueError(f"source is missing id column: {id_column}")
    return source.drop(columns=[id_column]).copy()


def _valid_ordinal_rows(
    data: pd.DataFrame,
    target_column: str,
    minimum: int,
    maximum: int,
) -> pd.Series:
    numeric = pd.to_numeric(data[target_column], errors="coerce")
    rounded = numeric.round()
    return numeric.notna() & np.isclose(numeric, rounded, atol=1e-9) & rounded.between(minimum, maximum)


def _valid_timestamp_rows(
    data: pd.DataFrame,
    timestamp_column: str | None,
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> pd.Series:
    valid = pd.Series(True, index=data.index)
    if timestamp_column is None:
        return valid

    timestamps = pd.to_datetime(data[timestamp_column], utc=True, errors="coerce")
    valid &= timestamps.notna()
    if start is not None:
        valid &= timestamps >= start
    if end is not None:
        valid &= timestamps <= end
    return valid


def _valid_categorical_rows(
    data: pd.DataFrame,
    allowed_values: dict[str, frozenset[str]],
) -> pd.Series:
    valid = pd.Series(True, index=data.index)
    for column, allowed in allowed_values.items():
        valid &= data[column].isin(allowed)
    return valid


def _build_metadata(
    model_data: pd.DataFrame,
    *,
    target_column: str,
    categorical_columns: list[str],
    timestamp_column: str | None,
) -> tuple[Metadata, dict[str, object]]:
    metadata = Metadata.detect_from_dataframe(
        data=model_data,
        table_name=TABLE_NAME,
        infer_keys=None,
    )
    metadata.update_column(
        column_name=target_column,
        sdtype="numerical",
        table_name=TABLE_NAME,
    )
    if timestamp_column is not None:
        metadata.update_column(
            column_name=timestamp_column,
            sdtype="datetime",
            table_name=TABLE_NAME,
        )
    for column in categorical_columns:
        metadata.update_column(
            column_name=column,
            sdtype="categorical",
            table_name=TABLE_NAME,
        )
    metadata.validate()

    serialized = metadata.to_dict()
    tables = serialized.get("tables")
    if not isinstance(tables, dict):
        raise RuntimeError("SDV metadata did not contain tables")
    table_metadata = tables.get(TABLE_NAME)
    if not isinstance(table_metadata, dict):
        raise RuntimeError("SDV metadata did not contain the synthesis table")
    return metadata, table_metadata


def _request_counts(
    target_score_counts: dict[int, int],
    pool_size: int,
) -> dict[int, int]:
    required_total = sum(target_score_counts.values())
    if required_total <= 0:
        return {}

    return {
        score: max(required, math.ceil(pool_size * required / required_total))
        for score, required in target_score_counts.items()
        if required > 0
    }


def generate_candidates(
    source: pd.DataFrame,
    *,
    id_column: str,
    target_column: str,
    target_min: int,
    target_max: int,
    target_score_counts: dict[int, int],
    pool_size: int,
    seed: int,
    categorical_columns: list[str] | None = None,
    timestamp_column: str | None = None,
    timestamp_start: pd.Timestamp | None = None,
    timestamp_end: pd.Timestamp | None = None,
) -> CandidatePool:
    if pool_size <= 0:
        raise ValueError("candidate pool size must be positive")
    if target_column not in source.columns:
        raise ValueError(f"source is missing mean target column: {target_column}")
    if timestamp_column is not None and timestamp_column not in source.columns:
        raise ValueError(f"source is missing timestamp column: {timestamp_column}")
    if any(score < target_min or score > target_max for score in target_score_counts):
        raise ValueError("target score support contains a value outside the ordinal range")

    categorical_columns = categorical_columns or []
    missing_categorical = [column for column in categorical_columns if column not in source.columns]
    if missing_categorical:
        raise ValueError(
            f"source is missing categorical columns: {', '.join(missing_categorical)}"
        )

    model_data = _model_frame(source, id_column)
    if timestamp_column is not None:
        timestamps = pd.to_datetime(model_data[timestamp_column], utc=True, errors="raise")
        model_data[timestamp_column] = timestamps.dt.tz_convert(None)

    allowed_values: dict[str, frozenset[str]] = {}
    for column in categorical_columns:
        values = model_data[column]
        if values.isna().any() or not values.map(lambda value: isinstance(value, str)).all():
            raise ValueError(f"categorical source column must contain strings only: {column}")
        allowed_values[column] = frozenset(values.tolist())

    metadata, quality_metadata = _build_metadata(
        model_data,
        target_column=target_column,
        categorical_columns=categorical_columns,
        timestamp_column=timestamp_column,
    )

    random.seed(seed)
    np.random.seed(seed)
    synthesizer = GaussianCopulaSynthesizer(
        metadata,
        enforce_min_max_values=False,
    )
    synthesizer.fit(model_data)

    requested_by_score = _request_counts(target_score_counts, pool_size)
    accepted: list[pd.DataFrame] = []

    for score, requested in requested_by_score.items():
        score_batches: list[pd.DataFrame] = []
        accepted_count = 0
        for _ in range(5):
            missing = requested - accepted_count
            if missing <= 0:
                break
            sample_count = max(missing * 2, 20)
            try:
                sampled = synthesizer.sample_from_conditions(
                    [Condition(num_rows=sample_count, column_values={target_column: score})]
                )
            except Exception as error:  # SDV raises several sampling-specific exception classes.
                raise RuntimeError(
                    f"SDV could not generate candidates conditioned on target score {score}: {error}"
                ) from error

            numeric = pd.to_numeric(sampled[target_column], errors="coerce")
            valid = _valid_ordinal_rows(sampled, target_column, target_min, target_max)
            valid &= np.isclose(numeric, score, atol=1e-9)
            valid &= _valid_timestamp_rows(
                sampled,
                timestamp_column,
                timestamp_start,
                timestamp_end,
            )
            valid &= _valid_categorical_rows(sampled, allowed_values)
            sampled = sampled.loc[valid].copy()
            if sampled.empty:
                continue

            sampled[target_column] = score
            if timestamp_column is not None:
                sampled[timestamp_column] = pd.to_datetime(sampled[timestamp_column], utc=True)
            score_batches.append(sampled)
            accepted_count += len(sampled)

        if accepted_count < requested:
            raise RuntimeError(
                f"SDV produced only {accepted_count} valid candidates for target score {score}; required {requested}"
            )
        accepted.append(pd.concat(score_batches, ignore_index=True).iloc[:requested].copy())

    if not accepted and target_score_counts:
        raise RuntimeError("SDV did not produce any target-directed candidates")

    data = pd.concat(accepted, ignore_index=True) if accepted else model_data.iloc[0:0].copy()
    return CandidatePool(data=data, metadata=quality_metadata)
