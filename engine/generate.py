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


@dataclass(frozen=True)
class ShareCandidateSupport:
    column: str
    member_values: frozenset[str]
    synthetic_member_count: int
    synthetic_nonmember_count: int


@dataclass(frozen=True)
class ConditionalCandidateSupport:
    id: str
    population_column: str
    population_member_values: frozenset[str]
    option_column: str
    option_values: frozenset[str]
    target_value: float


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


def _sample_condition(
    synthesizer: GaussianCopulaSynthesizer,
    *,
    requested: int,
    condition_values: dict[str, object],
    target_column: str,
    target_score: int,
    target_min: int,
    target_max: int,
    allowed_values: dict[str, frozenset[str]],
    timestamp_column: str | None,
    timestamp_start: pd.Timestamp | None,
    timestamp_end: pd.Timestamp | None,
) -> pd.DataFrame:
    if requested <= 0:
        return pd.DataFrame()

    batches: list[pd.DataFrame] = []
    accepted_count = 0
    for _ in range(5):
        missing = requested - accepted_count
        if missing <= 0:
            break
        sample_count = max(missing * 2, 20)
        try:
            sampled = synthesizer.sample_from_conditions(
                [Condition(num_rows=sample_count, column_values=condition_values)]
            )
        except Exception as error:  # SDV raises several sampling-specific exception classes.
            details = ", ".join(f"{key}={value!r}" for key, value in condition_values.items())
            raise RuntimeError(
                f"SDV could not generate candidates conditioned on {details}: {error}"
            ) from error

        numeric = pd.to_numeric(sampled[target_column], errors="coerce")
        valid = _valid_ordinal_rows(sampled, target_column, target_min, target_max)
        valid &= np.isclose(numeric, target_score, atol=1e-9)
        valid &= _valid_timestamp_rows(
            sampled,
            timestamp_column,
            timestamp_start,
            timestamp_end,
        )
        valid &= _valid_categorical_rows(sampled, allowed_values)
        for column, value in condition_values.items():
            valid &= sampled[column] == value
        sampled = sampled.loc[valid].copy()
        if sampled.empty:
            continue

        sampled[target_column] = target_score
        if timestamp_column is not None:
            sampled[timestamp_column] = pd.to_datetime(sampled[timestamp_column], utc=True)
        batches.append(sampled)
        accepted_count += len(sampled)

    if accepted_count < requested:
        details = ", ".join(f"{key}={value!r}" for key, value in condition_values.items())
        raise RuntimeError(
            f"SDV produced only {accepted_count} valid candidates for {details}; required {requested}"
        )
    return pd.concat(batches, ignore_index=True).iloc[:requested].copy()


def _weighted_requests(
    model_data: pd.DataFrame,
    column: str,
    values: frozenset[str],
    requested: int,
) -> list[tuple[str, int]]:
    if requested <= 0:
        return []
    if not values:
        raise RuntimeError(f"No observed categorical values can satisfy directed support for {column}")

    counts = model_data[column].value_counts()
    total = int(sum(int(counts.get(value, 0)) for value in values))
    if total <= 0:
        raise RuntimeError(f"No observed categorical values can satisfy directed support for {column}")

    requests: list[tuple[str, int]] = []
    remaining = requested
    ordered = sorted(values)
    for index, value in enumerate(ordered):
        if index == len(ordered) - 1:
            amount = remaining
        else:
            weight = int(counts.get(value, 0)) / total
            amount = min(remaining, max(1, int(round(requested * weight))))
        if amount > 0:
            requests.append((value, amount))
            remaining -= amount
        if remaining <= 0:
            break
    return requests


def _weighted_joint_requests(
    model_data: pd.DataFrame,
    *,
    left_column: str,
    left_values: frozenset[str],
    right_column: str,
    right_values: frozenset[str],
    requested: int,
) -> list[tuple[dict[str, str], int]]:
    if requested <= 0:
        return []
    if not left_values or not right_values:
        raise RuntimeError(
            f"No observed categorical values can satisfy directed support for {left_column}/{right_column}"
        )

    eligible = model_data.loc[
        model_data[left_column].isin(left_values) & model_data[right_column].isin(right_values),
        [left_column, right_column],
    ]
    counts = eligible.value_counts()
    if len(counts) == 0:
        left_counts = model_data[left_column].value_counts()
        right_counts = model_data[right_column].value_counts()
        left = max(left_values, key=lambda value: int(left_counts.get(value, 0)))
        right = max(right_values, key=lambda value: int(right_counts.get(value, 0)))
        return [({left_column: left, right_column: right}, requested)]

    total = int(counts.sum())
    pairs = sorted(
        ((str(index[0]), str(index[1]), int(count)) for index, count in counts.items()),
        key=lambda item: (-item[2], item[0], item[1]),
    )
    requests: list[tuple[dict[str, str], int]] = []
    remaining = requested
    for index, (left, right, count) in enumerate(pairs):
        if index == len(pairs) - 1:
            amount = remaining
        else:
            amount = min(remaining, max(1, int(round(requested * count / total))))
        if amount > 0:
            requests.append(({left_column: left, right_column: right}, amount))
            remaining -= amount
        if remaining <= 0:
            break
    return requests


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
    share_support: ShareCandidateSupport | None = None,
    conditional_supports: tuple[ConditionalCandidateSupport, ...] = (),
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

    if share_support is not None:
        if share_support.column not in allowed_values:
            raise ValueError("share support column must be one of categorical_columns")
        if not share_support.member_values <= allowed_values[share_support.column]:
            raise ValueError("share support contains categorical values outside the observed source support")
        if share_support.synthetic_member_count < 0 or share_support.synthetic_nonmember_count < 0:
            raise ValueError("share support counts must be non-negative")

    for support in conditional_supports:
        if support.population_column not in allowed_values or support.option_column not in allowed_values:
            raise ValueError("conditional support columns must be categorical columns")
        if not support.population_member_values <= allowed_values[support.population_column]:
            raise ValueError("conditional population support is outside observed source support")
        if not support.option_values <= allowed_values[support.option_column]:
            raise ValueError("conditional option support is outside observed source support")
        if not 0 <= support.target_value <= 1:
            raise ValueError("conditional support target must be between 0 and 1")

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

    accepted: list[pd.DataFrame] = []
    requested_by_score = _request_counts(target_score_counts, pool_size)
    for score, requested in requested_by_score.items():
        accepted.append(
            _sample_condition(
                synthesizer,
                requested=requested,
                condition_values={target_column: score},
                target_column=target_column,
                target_score=score,
                target_min=target_min,
                target_max=target_max,
                allowed_values=allowed_values,
                timestamp_column=timestamp_column,
                timestamp_start=timestamp_start,
                timestamp_end=timestamp_end,
            )
        )

    if share_support is not None:
        observed = allowed_values[share_support.column]
        member_values = share_support.member_values
        nonmember_values = observed - member_values
        for score, required_score_count in target_score_counts.items():
            state_requests = [
                (
                    member_values,
                    min(required_score_count, share_support.synthetic_member_count),
                ),
                (
                    nonmember_values,
                    min(required_score_count, share_support.synthetic_nonmember_count),
                ),
            ]
            for values, required_capacity in state_requests:
                if required_capacity <= 0:
                    continue
                directed_total = max(required_capacity * 3, 20)
                for value, requested in _weighted_requests(
                    model_data,
                    share_support.column,
                    values,
                    directed_total,
                ):
                    accepted.append(
                        _sample_condition(
                            synthesizer,
                            requested=requested,
                            condition_values={
                                target_column: score,
                                share_support.column: value,
                            },
                            target_column=target_column,
                            target_score=score,
                            target_min=target_min,
                            target_max=target_max,
                            allowed_values=allowed_values,
                            timestamp_column=timestamp_column,
                            timestamp_start=timestamp_start,
                            timestamp_end=timestamp_end,
                        )
                    )

    for support in conditional_supports:
        observed_options = allowed_values[support.option_column]
        states: list[frozenset[str]] = []
        if support.target_value > 0:
            states.append(support.option_values)
        if support.target_value < 1:
            states.append(observed_options - support.option_values)
        for score, required_score_count in target_score_counts.items():
            directed_total = max(required_score_count * 3, 30)
            for option_values in states:
                for conditions, requested in _weighted_joint_requests(
                    model_data,
                    left_column=support.population_column,
                    left_values=support.population_member_values,
                    right_column=support.option_column,
                    right_values=option_values,
                    requested=directed_total,
                ):
                    accepted.append(
                        _sample_condition(
                            synthesizer,
                            requested=requested,
                            condition_values={target_column: score, **conditions},
                            target_column=target_column,
                            target_score=score,
                            target_min=target_min,
                            target_max=target_max,
                            allowed_values=allowed_values,
                            timestamp_column=timestamp_column,
                            timestamp_start=timestamp_start,
                            timestamp_end=timestamp_end,
                        )
                    )

    if not accepted and target_score_counts:
        raise RuntimeError("SDV did not produce any target-directed candidates")

    data = pd.concat(accepted, ignore_index=True) if accepted else model_data.iloc[0:0].copy()
    return CandidatePool(data=data, metadata=quality_metadata)
