from __future__ import annotations

import random
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sdv.metadata import SingleTableMetadata
from sdv.single_table import GaussianCopulaSynthesizer


@dataclass(frozen=True)
class CandidatePool:
    data: pd.DataFrame
    metadata: SingleTableMetadata


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


def generate_candidates(
    source: pd.DataFrame,
    *,
    id_column: str,
    target_column: str,
    target_min: int,
    target_max: int,
    pool_size: int,
    seed: int,
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

    model_data = _model_frame(source, id_column)
    if timestamp_column is not None:
        timestamps = pd.to_datetime(model_data[timestamp_column], utc=True, errors="raise")
        model_data[timestamp_column] = timestamps.dt.tz_convert(None)

    metadata = SingleTableMetadata()
    metadata.detect_from_dataframe(model_data)

    random.seed(seed)
    np.random.seed(seed)
    synthesizer = GaussianCopulaSynthesizer(metadata)
    synthesizer.fit(model_data)

    accepted: list[pd.DataFrame] = []
    accepted_count = 0
    batch_size = max(pool_size, 100)

    for _ in range(5):
        sampled = synthesizer.sample(num_rows=batch_size)
        valid = _valid_ordinal_rows(sampled, target_column, target_min, target_max)
        valid &= _valid_timestamp_rows(
            sampled,
            timestamp_column,
            timestamp_start,
            timestamp_end,
        )
        sampled = sampled.loc[valid].copy()
        if sampled.empty:
            continue

        sampled[target_column] = pd.to_numeric(sampled[target_column]).round().astype(int)
        if timestamp_column is not None:
            sampled[timestamp_column] = pd.to_datetime(sampled[timestamp_column], utc=True)
        accepted.append(sampled)
        accepted_count += len(sampled)
        if accepted_count >= pool_size:
            break

    if accepted_count < pool_size:
        raise RuntimeError(
            f"SDV produced only {accepted_count} structurally valid candidates; required {pool_size}"
        )

    data = pd.concat(accepted, ignore_index=True).iloc[:pool_size].copy()
    return CandidatePool(data=data, metadata=metadata)
