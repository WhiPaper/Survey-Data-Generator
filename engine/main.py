from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Literal

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

from prepare import read_source, smoke_source, write_parquet  # noqa: E402


class SmokeJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: Literal[1] = 1
    kind: Literal["smoke"]
    source_parquet: Path
    result_parquet: Path
    report_json: Path


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def resolve_job_paths(job: SmokeJob, job_path: Path) -> SmokeJob:
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


def load_job(job_path: Path) -> SmokeJob:
    raw = json.loads(job_path.read_text(encoding="utf-8"))
    return resolve_job_paths(SmokeJob.model_validate(raw), job_path)


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
    job = load_job(job_path)
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

    selftest = commands.add_parser("selftest")
    selftest.add_argument("--work-dir", type=Path, required=True)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "smoke":
            run_smoke(args.job.resolve())
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
