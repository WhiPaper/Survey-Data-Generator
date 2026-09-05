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
from pydantic import BaseModel, ConfigDict, ValidationError  # noqa: E402
from scipy.optimize import milp  # noqa: E402,F401
from sdmetrics.reports import QualityReport  # noqa: E402,F401
from sdv.single_table import GaussianCopulaSynthesizer  # noqa: E402,F401

from evaluate import evaluate_result  # noqa: E402
from generate import generate_candidates  # noqa: E402
from prepare import read_source, smoke_source, write_parquet  # noqa: E402
from select import TargetInfeasible, select_for_mean  # noqa: E402


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

    column: str
    value: float
    minimum: int
    maximum: int


class SynthesizeJob(JobPaths):
    kind: Literal["synthesize"]
    final_count: int
    mean_target: MeanTargetSpec
    seed: int
    id_column: str = "response_id"
    timestamp_column: str | None = None
    timestamp_start: str | None = None
    timestamp_end: str | None = None
    candidate_pool_size: int | None = None


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
        "issues": [{"code": issue.code, "message": issue.message}],
    }


def run_synthesize(job_path: Path) -> dict[str, object]:
    job = load_job(job_path, SynthesizeJob)
    if not job.source_parquet.is_file():
        raise FileNotFoundError(f"source parquet does not exist: {job.source_parquet}")
    if job.final_count <= 0:
        raise ValueError("final_count must be positive")
    if job.mean_target.minimum > job.mean_target.maximum:
        raise ValueError("mean target minimum must not exceed maximum")
    if job.candidate_pool_size is not None and job.candidate_pool_size <= 0:
        raise ValueError("candidate_pool_size must be positive")

    emit({"type": "progress", "stage": "read_source"})
    source = read_source(job.source_parquet).copy()
    if job.id_column not in source.columns:
        raise ValueError(f"source is missing id column: {job.id_column}")
    if job.mean_target.column not in source.columns:
        raise ValueError(f"source is missing mean target column: {job.mean_target.column}")

    source_scores = pandas.to_numeric(source[job.mean_target.column], errors="coerce")
    if source_scores.notna().any():
        rounded = source_scores.round()
        invalid_score = source_scores.notna() & (
            ~np.isclose(source_scores, rounded, atol=1e-9)
            | ~rounded.between(job.mean_target.minimum, job.mean_target.maximum)
        )
        if invalid_score.any():
            raise ValueError("source contains invalid ordinal target values")
        source.loc[source_scores.notna(), job.mean_target.column] = rounded[source_scores.notna()].astype(int)

    timestamp_start = _timestamp_bound(job.timestamp_start)
    timestamp_end = _timestamp_bound(job.timestamp_end)
    if timestamp_start is not None and timestamp_end is not None and timestamp_start > timestamp_end:
        raise ValueError("timestamp_start must not be after timestamp_end")
    if job.timestamp_column is not None:
        if job.timestamp_column not in source.columns:
            raise ValueError(f"source is missing timestamp column: {job.timestamp_column}")
        source[job.timestamp_column] = pandas.to_datetime(
            source[job.timestamp_column], utc=True, errors="raise"
        )

    source_count = len(source)
    additions = job.final_count - source_count

    try:
        if additions < 0:
            raise TargetInfeasible(
                "final_count_below_source",
                f"Final response count {job.final_count} is below immutable source count {source_count}",
            )

        emit({"type": "progress", "stage": "generate_candidates", "rows": additions})
        pool_size = job.candidate_pool_size or max(additions * 20, 200)
        pool = generate_candidates(
            source,
            id_column=job.id_column,
            target_column=job.mean_target.column,
            target_min=job.mean_target.minimum,
            target_max=job.mean_target.maximum,
            pool_size=pool_size,
            seed=job.seed,
            timestamp_column=job.timestamp_column,
            timestamp_start=timestamp_start,
            timestamp_end=timestamp_end,
        )

        emit({"type": "progress", "stage": "select", "candidateRows": len(pool.data)})
        selection = select_for_mean(
            source,
            pool.data,
            target_column=job.mean_target.column,
            final_count=job.final_count,
            target_mean=job.mean_target.value,
            target_min=job.mean_target.minimum,
            target_max=job.mean_target.maximum,
        )
    except TargetInfeasible as issue:
        report = _infeasible_report(job, issue)
        report["sourceCount"] = source_count
        write_report(job.report_json, report)
        emit({"type": "complete", "report": str(job.report_json), "status": "infeasible"})
        return report
    except RuntimeError as error:
        issue = TargetInfeasible("candidate_support", str(error))
        report = _infeasible_report(job, issue)
        report["sourceCount"] = source_count
        write_report(job.report_json, report)
        emit({"type": "complete", "report": str(job.report_json), "status": "infeasible"})
        return report

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
        "achieved": {
            "mean": evaluation.achieved_mean,
            "absoluteError": evaluation.absolute_error,
            "exact": selection.exact_target,
        },
        "validation": {
            "finalCount": True,
            "targetDomain": True,
            "duplicateRowCount": evaluation.duplicate_row_count,
        },
        "quality": {
            "sdmetricsScore": evaluation.quality_score,
            "warning": evaluation.quality_warning,
        },
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
        print(json.dumps({"type": "error", "kind": "validation", "message": str(error)}), file=sys.stderr)
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
