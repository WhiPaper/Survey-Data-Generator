from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Literal, TypeVar

if sys.version_info[:2] != (3, 12):
    print(
        json.dumps(
            {
                "type": "error",
                "kind": "runtime",
                "message": f"Survey Synth engine requires Python 3.12, got {sys.version_info.major}.{sys.version_info.minor}",
            }
        ),
        file=sys.stderr,
    )
    raise SystemExit(1)

import numpy as np  # noqa: E402
import pandas  # noqa: E402
import pyarrow  # noqa: E402
import pydantic  # noqa: E402
import scipy  # noqa: E402
import sdmetrics  # noqa: E402
import sdv  # noqa: E402
from pydantic import BaseModel, ConfigDict, Field, ValidationError  # noqa: E402
from scipy.optimize import milp  # noqa: E402,F401
from sdmetrics.reports import QualityReport  # noqa: E402,F401
from sdv.single_table import GaussianCopulaSynthesizer  # noqa: E402,F401

from evaluate import Evaluation, evaluate_result  # noqa: E402
from generate import (  # noqa: E402
    ConditionalCandidateSupport,
    ShareCandidateSupport,
    generate_candidates,
)
from prepare import read_source, smoke_source, write_parquet  # noqa: E402
from replacement import EditPlanSelection, plan_replacements  # noqa: E402
from candidate_selection import (  # noqa: E402
    CountTarget,
    MeanTarget,
    ConditionalShareTarget,
    ShareTarget,
    TargetInfeasible,
    TargetSelection,
    _conditional_vectors,
    plan_mean_support,
    plan_share_support,
    select_for_targets,
)


class JobPaths(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: Literal[1] = 1
    source_parquet: Path
    result_parquet: Path
    report_json: Path


class SmokeJob(JobPaths):
    kind: Literal["smoke"]


class MeanTargetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    column: str
    value: float
    minimum: int
    maximum: int


class ShareTargetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    column: str
    member_values: list[str] = Field(min_length=1)
    value: float


class CountTargetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    column: str
    member_values: list[str] = Field(min_length=1)
    value: int = Field(ge=0)


class ConditionalShareTargetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    population_column: str
    population_member_values: list[str] = Field(min_length=1)
    option_column: str
    option_values: list[str] = Field(min_length=1)
    schema_option_values: list[str] = Field(default_factory=list)
    value: float


class SynthesizeJob(JobPaths):
    kind: Literal["synthesize"]
    final_count: int
    mean_targets: list[MeanTargetSpec] = Field(default_factory=list)
    count_targets: list[CountTargetSpec] = Field(default_factory=list)
    share_targets: list[ShareTargetSpec] = Field(default_factory=list)
    conditional_share_targets: list[ConditionalShareTargetSpec] = Field(default_factory=list)
    seed: int
    id_column: str = "response_id"
    categorical_columns: list[str] = Field(default_factory=list)
    timestamp_column: str | None = None
    timestamp_start: str | None = None
    timestamp_end: str | None = None
    candidate_pool_size: int | None = None

    @property
    def mean_target(self) -> MeanTargetSpec:
        if not self.mean_targets:
            raise ValueError("synthesis without a mean target requires the generic candidate path")
        return self.mean_targets[0]


JobT = TypeVar("JobT", bound=JobPaths)


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def resolve_job_paths(job: JobT, job_path: Path) -> JobT:
    base = job_path.parent

    def resolved(path: Path) -> Path:
        return path.resolve() if path.is_absolute() else (base / path).resolve()

    source = resolved(job.source_parquet)
    result = resolved(job.result_parquet)
    report = resolved(job.report_json)
    if source == result:
        raise ValueError("source_parquet and result_parquet must be different")
    if report in {source, result}:
        raise ValueError("report_json must be different from parquet paths")

    return job.model_copy(
        update={
            "source_parquet": source,
            "result_parquet": result,
            "report_json": report,
        }
    )


def load_job(job_path: Path, model: type[JobT]) -> JobT:
    raw = json.loads(job_path.read_text(encoding="utf-8"))
    return resolve_job_paths(model.model_validate(raw), job_path)


def dependency_versions() -> dict[str, str]:
    modules = {
        "pydantic": pydantic,
        "pandas": pandas,
        "pyarrow": pyarrow,
        "scipy": scipy,
        "sdv": sdv,
        "sdmetrics": sdmetrics,
    }
    versions: dict[str, str] = {}
    for name, module in modules.items():
        value = getattr(module, "__version__", None)
        if not isinstance(value, str) or not value:
            raise RuntimeError(f"{name} does not expose __version__")
        versions[name] = value
    return versions


def write_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def run_smoke(job_path: Path) -> dict[str, object]:
    job = load_job(job_path, SmokeJob)
    if not job.source_parquet.is_file():
        raise FileNotFoundError(f"source parquet does not exist: {job.source_parquet}")

    emit({"type": "progress", "stage": "read_source"})
    source = read_source(job.source_parquet)
    emit({"type": "progress", "stage": "write_result", "rows": len(source)})
    write_parquet(source, job.result_parquet)

    report: dict[str, object] = {
        "status": "ok",
        "kind": "smoke",
        "rowCount": int(len(source)),
        "columnCount": int(len(source.columns)),
        "dependencies": dependency_versions(),
        "capabilities": {
            "parquet": True,
            "sdvGaussianCopula": True,
            "scipyMilp": True,
            "sdmetricsQualityReport": True,
        },
    }
    write_report(job.report_json, report)
    emit({"type": "complete", "report": str(job.report_json)})
    return report


def _timestamp_bound(value: str | None) -> pandas.Timestamp | None:
    if value is None:
        return None
    parsed = pandas.to_datetime(value, utc=True, errors="raise")
    if not isinstance(parsed, pandas.Timestamp):
        raise ValueError(f"invalid timestamp bound: {value}")
    return parsed


def _infeasible_report(job: SynthesizeJob, issue: TargetInfeasible) -> dict[str, object]:
    return {
        "status": "infeasible",
        "kind": "synthesize",
        "sourceCount": None,
        "finalCount": job.final_count,
        "target": {
            "kind": "mean",
            "column": job.mean_target.column,
            "value": job.mean_target.value,
        },
        "shareTargets": [
            {"id": target.id, "column": target.column, "value": target.value}
            for target in job.share_targets
        ],
        "countTargets": [
            {"id": target.id, "column": target.column, "value": target.value}
            for target in job.count_targets
        ],
        "conditionalShareTargets": [
            {
                "id": target.id,
                "populationColumn": target.population_column,
                "optionColumn": target.option_column,
                "value": target.value,
            }
            for target in job.conditional_share_targets
        ],
        "issues": [{"code": issue.code, "message": issue.message}],
    }


def _share_targets(job: SynthesizeJob) -> tuple[ShareTarget, ...]:
    return tuple(
        ShareTarget(
            id=target.id,
            column=target.column,
            member_values=frozenset(target.member_values),
            value=target.value,
        )
        for target in job.share_targets
    )


def _count_targets(job: SynthesizeJob) -> tuple[CountTarget, ...]:
    return tuple(
        CountTarget(target.id, target.column, frozenset(target.member_values), target.value)
        for target in job.count_targets
    )


def _conditional_share_targets(job: SynthesizeJob) -> tuple[ConditionalShareTarget, ...]:
    return tuple(
        ConditionalShareTarget(
            id=target.id,
            population_column=target.population_column,
            population_member_values=frozenset(target.population_member_values),
            option_column=target.option_column,
            option_values=frozenset(target.option_values),
            value=target.value,
        )
        for target in job.conditional_share_targets
    )


def _write_infeasible(
    job: SynthesizeJob,
    source_count: int,
    issue: TargetInfeasible,
) -> dict[str, object]:
    report = _infeasible_report(job, issue)
    report["sourceCount"] = source_count
    write_report(job.report_json, report)
    emit({"type": "complete", "report": str(job.report_json), "status": "infeasible"})
    return report


def _target_outcome(selection: TargetSelection) -> dict[str, object]:
    return {
        "means": [
            {"id": target.id, "value": target.value, "mean": target.achieved_mean,
             "absoluteError": target.absolute_error, "exact": target.absolute_error <= 1e-9}
            for target in selection.means
        ],
        "mean": selection.achieved_mean,
        "absoluteError": selection.mean_absolute_error,
        "exact": selection.mean_exact,
        "shares": [
            {
                "id": target.id,
                "value": target.value,
                "share": target.achieved_share,
                "absoluteError": target.absolute_error,
                "exact": target.absolute_error <= 1e-9,
            }
            for target in selection.shares
        ],
        "counts": [
            {
                "id": target.id,
                "value": target.value,
                "count": target.achieved_count,
                "absoluteError": target.absolute_error,
                "exact": target.absolute_error == 0,
            }
            for target in selection.counts
        ],
        "conditionalShares": [
            {
                "id": target.id,
                "value": target.value,
                "share": target.achieved_share,
                "numeratorCount": target.numerator_count,
                "denominatorCount": target.denominator_count,
                "absoluteError": target.absolute_error,
                "exact": target.absolute_error <= 1e-9,
            }
            for target in selection.conditional_shares
        ],
    }


def _quality_payload(evaluation: Evaluation) -> dict[str, object]:
    return {
        "sdmetricsScore": evaluation.quality_score,
        "warning": evaluation.quality_warning,
        "duplicateRowCount": evaluation.duplicate_row_count,
        "maxFingerprintCount": evaluation.max_fingerprint_count,
        "maxFingerprintShare": evaluation.max_fingerprint_share,
        "sourceCloneCount": evaluation.source_clone_count,
        "sourceCloneRate": evaluation.source_clone_rate,
        "timestampKsStatistic": evaluation.timestamp_ks_statistic,
        "timestampMedianDeltaSeconds": evaluation.timestamp_median_delta_seconds,
    }


def _materialize_replacement(
    source: pandas.DataFrame,
    candidates: pandas.DataFrame,
    plan: EditPlanSelection,
    *,
    id_column: str,
    seed: int,
) -> tuple[pandas.DataFrame, pandas.DataFrame, list[dict[str, str]]]:
    if plan.status != "available" or plan.replacement_outcome is None:
        raise ValueError("replacement materialization requires an available EditPlan")

    replacement_pairs = list(plan.proposed_replacements)
    removed = {pair.source_index for pair in replacement_pairs}
    kept_source = source.iloc[
        [index for index in range(len(source)) if index not in removed]
    ].copy()
    kept_source["__origin"] = "original"

    replacement_rows = candidates.iloc[
        [pair.candidate_index for pair in replacement_pairs]
    ].copy().reset_index(drop=True)
    replacement_ids = [
        f"replacement:{seed}:{index + 1}" for index in range(len(replacement_rows))
    ]
    replacement_rows.insert(0, id_column, replacement_ids)

    addition_rows = candidates.iloc[plan.addition_candidate_indices].copy().reset_index(drop=True)
    addition_rows.insert(
        0,
        id_column,
        [f"synthetic:{seed}:{index + 1}" for index in range(len(addition_rows))],
    )

    generated = pandas.concat([replacement_rows, addition_rows], ignore_index=True)
    generated["__origin"] = "synthetic"
    final = pandas.concat([kept_source, generated], ignore_index=True)
    proposed = [
        {
            "sourceResponseId": str(source.iloc[pair.source_index][id_column]),
            "replacementResponseId": replacement_ids[index],
        }
        for index, pair in enumerate(replacement_pairs)
    ]
    return generated, final, proposed


def _replacement_result_path(result_path: Path) -> Path:
    return result_path.with_name(f"{result_path.stem}.replacement{result_path.suffix}")


def run_synthesize(job_path: Path) -> dict[str, object]:
    job = load_job(job_path, SynthesizeJob)
    has_public_means = bool(job.mean_targets)
    if not job.source_parquet.is_file():
        raise FileNotFoundError(f"source parquet does not exist: {job.source_parquet}")
    if job.final_count <= 0:
        raise ValueError("final_count must be positive")
    if any(target.minimum > target.maximum for target in job.mean_targets):
        raise ValueError("mean target minimum must not exceed maximum")
    all_target_ids = [target.id for target in (*job.mean_targets, *job.count_targets, *job.share_targets, *job.conditional_share_targets)]
    if len(all_target_ids) != len(set(all_target_ids)):
        raise ValueError("target ids must be unique")
    if job.candidate_pool_size is not None and job.candidate_pool_size <= 0:
        raise ValueError("candidate_pool_size must be positive")
    if len(job.categorical_columns) != len(set(job.categorical_columns)):
        raise ValueError("categorical_columns must not contain duplicates")
    if len({target.id for target in job.share_targets}) != len(job.share_targets):
        raise ValueError("share target ids must be unique")
    if len({target.id for target in job.count_targets}) != len(job.count_targets):
        raise ValueError("count target ids must be unique")
    if len({target.id for target in job.conditional_share_targets}) != len(
        job.conditional_share_targets
    ):
        raise ValueError("conditional share target ids must be unique")
    for target in job.conditional_share_targets:
        if not set(target.schema_option_values) <= set(target.option_values):
            raise ValueError("schema option support must be included in option_values")

    reserved_columns = {job.id_column, *(target.column for target in job.mean_targets)}
    if job.timestamp_column is not None:
        reserved_columns.add(job.timestamp_column)
    conflicting = [column for column in job.categorical_columns if column in reserved_columns]
    if conflicting:
        raise ValueError(
            f"categorical_columns contain reserved columns: {', '.join(conflicting)}"
        )

    emit({"type": "progress", "stage": "read_source"})
    source = read_source(job.source_parquet).copy()
    if not job.mean_targets:
        # A constant internal column keeps the existing dependency-backed candidate/selection
        # pipeline target-neutral. It is never a public target or reported outcome.
        fallback = MeanTargetSpec(
            id="__no_mean__", column="__no_mean_score", value=0.0, minimum=0, maximum=0
        )
        source[fallback.column] = 0
        job = job.model_copy(update={"mean_targets": [fallback]})
    required_columns = {
        job.id_column,
        *(target.column for target in job.mean_targets),
        *job.categorical_columns,
        *(target.column for target in job.share_targets),
        *(target.column for target in job.count_targets),
        *(target.population_column for target in job.conditional_share_targets),
        *(target.option_column for target in job.conditional_share_targets),
    }
    if job.timestamp_column is not None:
        required_columns.add(job.timestamp_column)
    missing = sorted(required_columns - set(source.columns))
    if missing:
        raise ValueError(f"source is missing columns: {', '.join(missing)}")

    for mean_target in job.mean_targets:
        source_scores = pandas.to_numeric(source[mean_target.column], errors="coerce")
        if source_scores.notna().any():
            rounded = source_scores.round()
            invalid_score = source_scores.notna() & (~np.isclose(source_scores, rounded, atol=1e-9) | ~rounded.between(mean_target.minimum, mean_target.maximum))
            if invalid_score.any():
                raise ValueError("source contains invalid ordinal target values")
            source.loc[source_scores.notna(), mean_target.column] = rounded[source_scores.notna()].astype(int)

    timestamp_start = _timestamp_bound(job.timestamp_start)
    timestamp_end = _timestamp_bound(job.timestamp_end)
    if timestamp_start is not None and timestamp_end is not None and timestamp_start > timestamp_end:
        raise ValueError("timestamp_start must not be after timestamp_end")
    if job.timestamp_column is not None:
        source[job.timestamp_column] = pandas.to_datetime(
            source[job.timestamp_column], utc=True, errors="raise"
        )

    source_count = len(source)
    additions = job.final_count - source_count
    shares = _share_targets(job)
    counts = _count_targets(job)
    conditionals = _conditional_share_targets(job)

    try:
        mean_support = plan_mean_support(
            source,
            target_column=job.mean_target.column,
            final_count=job.final_count,
            target_mean=job.mean_target.value,
            target_min=job.mean_target.minimum,
            target_max=job.mean_target.maximum,
        )
        extra_mean_targets = tuple(MeanTarget(target.id, target.column, target.value, target.minimum, target.maximum) for target in job.mean_targets[1:])
        share_supports = tuple(
            plan_share_support(source, target=share, final_count=job.final_count)
            for share in shares
        )
        count_supports = tuple(
            plan_share_support(
                source,
                target=ShareTarget(count.id, count.column, count.member_values, count.value / job.final_count),
                final_count=job.final_count,
            )
            for count in counts
        )
    except TargetInfeasible as issue:
        return _write_infeasible(job, source_count, issue)
    generator_share_supports = tuple(
        ShareCandidateSupport(
            column=share.column,
            member_values=share.member_values,
            synthetic_member_count=support.synthetic_member_count,
            synthetic_nonmember_count=additions - support.synthetic_member_count,
        )
        for share, support in (*tuple(zip(shares, share_supports, strict=True)), *tuple(zip(counts, count_supports, strict=True)))
    )
    generator_conditional_supports = tuple(
        ConditionalCandidateSupport(
            id=compiled.id,
            population_column=compiled.population_column,
            population_member_values=compiled.population_member_values,
            option_column=compiled.option_column,
            option_values=compiled.option_values,
            target_value=compiled.value,
            schema_option_values=frozenset(spec.schema_option_values),
        )
        for spec, compiled in zip(job.conditional_share_targets, conditionals, strict=True)
    )

    emit(
        {
            "type": "progress",
            "stage": "generate_candidates",
            "rows": additions,
            "targetScores": mean_support.score_counts,
            "targetShareMembers": (
                share_supports[0].synthetic_member_count if share_supports else None
            ),
            "conditionalTargets": len(conditionals),
        }
    )
    default_pool_size = max(
        additions * 20,
        800 if conditionals else (500 if shares else 200),
    )
    pool_size = job.candidate_pool_size or default_pool_size
    try:
        pool = generate_candidates(
            source,
            id_column=job.id_column,
            target_column=job.mean_target.column,
            target_min=job.mean_target.minimum,
            target_max=job.mean_target.maximum,
            target_score_counts=mean_support.score_counts,
            pool_size=pool_size,
            seed=job.seed,
            categorical_columns=job.categorical_columns,
            timestamp_column=job.timestamp_column,
            timestamp_start=timestamp_start,
            timestamp_end=timestamp_end,
            share_supports=generator_share_supports,
            conditional_supports=generator_conditional_supports,
        )
    except RuntimeError as error:
        return _write_infeasible(
            job,
            source_count,
            TargetInfeasible("candidate_support", str(error)),
        )

    emit({"type": "progress", "stage": "select", "candidateRows": len(pool.data)})
    try:
        selection = select_for_targets(
            source,
            pool.data,
            target_column=job.mean_target.column,
            final_count=job.final_count,
            target_mean=job.mean_target.value,
            target_min=job.mean_target.minimum,
            target_max=job.mean_target.maximum,
            count_targets=counts,
            share_targets=shares,
            conditional_share_targets=conditionals,
            extra_mean_targets=extra_mean_targets,
            primary_mean_id=job.mean_target.id,
        )
    except TargetInfeasible as issue:
        if counts and issue.code == "solver_infeasible":
            selection = select_for_targets(
                source,
                pool.data,
                target_column=job.mean_target.column,
                final_count=job.final_count,
                target_mean=job.mean_target.value,
                target_min=job.mean_target.minimum,
                target_max=job.mean_target.maximum,
                count_targets=counts,
                enforce_counts=False,
                share_targets=shares,
                conditional_share_targets=conditionals,
                extra_mean_targets=extra_mean_targets,
                primary_mean_id=job.mean_target.id,
            )
        else:
            return _write_infeasible(job, source_count, issue)

    synthetic = pool.data.iloc[selection.selected_indices].copy().reset_index(drop=True)
    synthetic.insert(
        0,
        job.id_column,
        [f"synthetic:{job.seed}:{index + 1}" for index in range(len(synthetic))],
    )
    synthetic["__origin"] = "synthetic"

    source_output = source.copy()
    source_output["__origin"] = "original"
    final = pandas.concat([source_output, synthetic], ignore_index=True)

    emit({"type": "progress", "stage": "evaluate", "rows": len(final)})
    evaluation = evaluate_result(
        source,
        synthetic,
        final,
        metadata=pool.metadata,
        id_column=job.id_column,
        target_column=job.mean_target.column,
        target_mean=job.mean_target.value,
        target_min=job.mean_target.minimum,
        target_max=job.mean_target.maximum,
        expected_final_count=job.final_count,
        timestamp_column=job.timestamp_column,
        timestamp_start=timestamp_start,
        timestamp_end=timestamp_end,
        mean_targets=tuple((target.id, target.column, target.value, target.minimum, target.maximum) for target in job.mean_targets),
    )

    share_support_by_id = {support.id: support for support in share_supports}
    share_achieved: list[dict[str, object]] = []
    selection_by_id = {share.id: share for share in selection.shares}
    for target in job.share_targets:
        actual = float(final[target.column].isin(target.member_values).mean())
        selected = selection_by_id[target.id]
        support = share_support_by_id[target.id]
        if abs(actual - selected.achieved_share) > 1e-9:
            raise RuntimeError(f"Share validation disagreed with MILP for target {target.id}")
        actual_error = abs(actual - target.value)
        if actual_error > support.absolute_error + 1e-9:
            raise RuntimeError(f"Share validation exceeded theoretical support for target {target.id}")
        share_achieved.append(
            {
                "id": target.id,
                "value": target.value,
                "share": actual,
                "absoluteError": actual_error,
                "exact": actual_error <= 1e-9,
                "bestPossibleShare": support.achieved_share,
                "bestPossibleAbsoluteError": support.absolute_error,
            }
        )

    conditional_selection_by_id = {
        target.id: target for target in selection.conditional_shares
    }
    conditional_achieved: list[dict[str, object]] = []
    for target, compiled in zip(job.conditional_share_targets, conditionals, strict=True):
        population, numerator = _conditional_vectors(final, compiled)
        denominator_count = int(population.sum())
        if denominator_count <= 0:
            raise RuntimeError(
                f"Conditional target {target.id} has an empty final eligible population"
            )
        numerator_count = int(numerator.sum())
        actual = numerator_count / denominator_count
        selected = conditional_selection_by_id[target.id]
        if (
            numerator_count != selected.numerator_count
            or denominator_count != selected.denominator_count
            or abs(actual - selected.achieved_share) > 1e-9
        ):
            raise RuntimeError(
                f"Conditional share validation disagreed with MILP for target {target.id}"
            )
        conditional_achieved.append(
            {
                "id": target.id,
                "value": target.value,
                "share": actual,
                "numeratorCount": numerator_count,
                "denominatorCount": denominator_count,
                "absoluteError": abs(actual - target.value),
                "exact": abs(actual - target.value) <= 1e-9,
            }
        )

    append_error = (
        sum(mean.absolute_error for mean in selection.means)
        + sum(target.absolute_error for target in selection.counts)
        + sum(target.absolute_error for target in selection.shares)
        + sum(target.absolute_error for target in selection.conditional_shares)
    )
    edit_plan_report: dict[str, object] = {
        "status": "not_required",
        "replacementCount": 0,
        "proposedReplacements": [],
        "appendOnlyOutcome": _target_outcome(selection),
    }
    if append_error > 1e-9:
        emit({"type": "progress", "stage": "plan_replacements"})
        replacement_plan = plan_replacements(
            source,
            pool.data,
            target_column=job.mean_target.column,
            final_count=job.final_count,
            target_mean=job.mean_target.value,
            target_min=job.mean_target.minimum,
            target_max=job.mean_target.maximum,
            count_targets=counts,
            share_targets=shares,
            conditional_share_targets=conditionals,
            append_only_outcome=selection,
            extra_mean_targets=extra_mean_targets,
            primary_mean_id=job.mean_target.id,
        )
        if any(target.absolute_error > 0 for target in selection.counts) and replacement_plan.status == "impossible":
            return _write_infeasible(
                job,
                source_count,
                TargetInfeasible("solver_infeasible", "Exact count targets cannot be satisfied by append-only or replacement selection"),
            )
        edit_plan_report["status"] = replacement_plan.status
        if replacement_plan.status == "available":
            if replacement_plan.replacement_outcome is None:
                raise RuntimeError("Available EditPlan is missing a replacement outcome")
            replacement_generated, replacement_final, proposed = _materialize_replacement(
                source,
                pool.data,
                replacement_plan,
                id_column=job.id_column,
                seed=job.seed,
            )
            replacement_evaluation = evaluate_result(
                source,
                replacement_generated,
                replacement_final,
                metadata=pool.metadata,
                id_column=job.id_column,
                target_column=job.mean_target.column,
                target_mean=job.mean_target.value,
                target_min=job.mean_target.minimum,
                target_max=job.mean_target.maximum,
                expected_final_count=job.final_count,
                timestamp_column=job.timestamp_column,
                timestamp_start=timestamp_start,
                timestamp_end=timestamp_end,
                mean_targets=tuple((target.id, target.column, target.value, target.minimum, target.maximum) for target in job.mean_targets),
            )
            if (
                abs(
                    replacement_evaluation.achieved_mean
                    - replacement_plan.replacement_outcome.achieved_mean
                )
                > 1e-9
            ):
                raise RuntimeError("Replacement preview disagreed with MILP mean outcome")
            replacement_path = _replacement_result_path(job.result_parquet)
            write_parquet(replacement_final, replacement_path)
            replacement_outcome = _target_outcome(replacement_plan.replacement_outcome)
            replacement_outcome["quality"] = _quality_payload(replacement_evaluation)
            replacement_outcome["duplicateRowCount"] = replacement_evaluation.duplicate_row_count
            edit_plan_report.update(
                {
                    "replacementCount": replacement_plan.replacement_count,
                    "proposedReplacements": proposed,
                    "replacementOutcome": replacement_outcome,
                }
            )

    emit({"type": "progress", "stage": "write_result", "rows": len(final)})
    write_parquet(final, job.result_parquet)

    report = {
        "status": "success",
        "kind": "synthesize",
        "sourceCount": source_count,
        "syntheticCount": len(synthetic),
        "finalCount": len(final),
        "candidatePoolCount": len(pool.data),
        "target": {
            "kind": "mean",
            "column": job.mean_target.column,
            "value": job.mean_target.value,
            "minimum": job.mean_target.minimum,
            "maximum": job.mean_target.maximum,
        },
        "shareTargets": [
            {"id": target.id, "column": target.column, "value": target.value}
            for target in job.share_targets
        ],
        "countTargets": [
            {"id": target.id, "column": target.column, "value": target.value}
            for target in job.count_targets
        ],
        "conditionalShareTargets": [
            {
                "id": target.id,
                "populationColumn": target.population_column,
                "optionColumn": target.option_column,
                "value": target.value,
            }
            for target in job.conditional_share_targets
        ],
        "achieved": {
            "means": [
                {"id": mean.id, "value": mean.requested, "mean": mean.achieved,
                 "absoluteError": mean.absolute_error, "exact": mean.absolute_error <= 1e-9}
                for mean in evaluation.means if has_public_means
            ],
            "mean": evaluation.achieved_mean,
            "absoluteError": evaluation.absolute_error,
            "exact": selection.mean_exact,
            "bestPossibleMean": mean_support.achieved_mean,
            "bestPossibleAbsoluteError": mean_support.absolute_error,
            "shares": share_achieved,
            "counts": [
                {"id": target.id, "value": target.value, "count": target.achieved_count, "absoluteError": target.absolute_error, "exact": target.absolute_error == 0}
                for target in selection.counts
            ],
            "conditionalShares": conditional_achieved,
        },
        "editPlan": edit_plan_report,
        "validation": {
            "finalCount": True,
            "targetDomain": True,
            "targetSupportOptimal": True,
            "categoricalSupport": True,
            "shareTargets": True,
            "conditionalShareTargets": True,
            "replacementApplied": False,
            "duplicateRowCount": evaluation.duplicate_row_count,
        },
        "quality": _quality_payload(evaluation),
        "dependencies": dependency_versions(),
    }
    write_report(job.report_json, report)
    emit({"type": "complete", "report": str(job.report_json), "status": "success"})
    return report


def run_selftest(work_dir: Path) -> dict[str, object]:
    work_dir.mkdir(parents=True, exist_ok=True)
    source_path = work_dir / "source.parquet"
    result_path = work_dir / "result.parquet"
    report_path = work_dir / "report.json"
    job_path = work_dir / "job.json"

    write_parquet(smoke_source(), source_path)
    job_path.write_text(
        json.dumps(
            {
                "protocol_version": 1,
                "kind": "smoke",
                "source_parquet": source_path.name,
                "result_parquet": result_path.name,
                "report_json": report_path.name,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return run_smoke(job_path)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="survey-synth-engine")
    commands = root.add_subparsers(dest="command", required=True)

    smoke = commands.add_parser("smoke")
    smoke.add_argument("--job", type=Path, required=True)

    synthesize = commands.add_parser("synthesize")
    synthesize.add_argument("--job", type=Path, required=True)

    selftest = commands.add_parser("selftest")
    selftest.add_argument("--work-dir", type=Path, required=True)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "smoke":
            run_smoke(args.job.resolve())
        elif args.command == "synthesize":
            run_synthesize(args.job.resolve())
        else:
            run_selftest(args.work_dir.resolve())
        return 0
    except (ValidationError, json.JSONDecodeError, ValueError) as error:
        print(
            json.dumps({"type": "error", "kind": "validation", "message": str(error)}),
            file=sys.stderr,
        )
        return 2
    except Exception as error:  # noqa: BLE001
        print(
            json.dumps(
                {"type": "error", "kind": "runtime", "message": str(error)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
