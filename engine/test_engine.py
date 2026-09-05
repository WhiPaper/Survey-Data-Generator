from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd


ENGINE_DIR = Path(__file__).resolve().parent
MAIN = ENGINE_DIR / "main.py"


class EngineSmokeTest(unittest.TestCase):
    def test_selftest_round_trips_parquet_and_reports_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            result = subprocess.run(
                [sys.executable, str(MAIN), "selftest", "--work-dir", str(work_dir)],
                cwd=ENGINE_DIR,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((work_dir / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "ok")
            self.assertEqual(report["rowCount"], 2)
            self.assertTrue(report["capabilities"]["sdvGaussianCopula"])
            self.assertTrue(report["capabilities"]["scipyMilp"])
            self.assertTrue(report["capabilities"]["sdmetricsQualityReport"])

            output = pd.read_parquet(work_dir / "result.parquet")
            self.assertEqual(output["response_id"].tolist(), ["smoke-1", "smoke-2"])

    def test_job_rejects_unknown_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            source = work_dir / "source.parquet"
            pd.DataFrame({"value": [1]}).to_parquet(source, index=False)
            job = work_dir / "job.json"
            job.write_text(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "kind": "smoke",
                        "source_parquet": "source.parquet",
                        "result_parquet": "result.parquet",
                        "report_json": "report.json",
                        "unexpected": True,
                    }
                ),
                encoding="utf-8",
            )

            result = subprocess.run(
                [sys.executable, str(MAIN), "smoke", "--job", str(job)],
                cwd=ENGINE_DIR,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn('"kind": "validation"', result.stderr)

    def test_synthesize_reaches_final_count_and_exact_mean(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            source_path = work_dir / "source.parquet"
            scores = [5] * 44 + [4] * 36
            source = pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(80)],
                    "submitted_at": pd.date_range(
                        "2026-08-01T00:00:00Z", periods=80, freq="20min"
                    ),
                    "score": scores,
                    "segment": ["A" if index % 2 == 0 else "B" for index in range(80)],
                }
            )
            source.to_parquet(source_path, index=False)

            job_path = work_dir / "job.json"
            job_path.write_text(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "kind": "synthesize",
                        "source_parquet": "source.parquet",
                        "result_parquet": "result.parquet",
                        "report_json": "report.json",
                        "final_count": 120,
                        "mean_target": {
                            "column": "score",
                            "value": 4.7,
                            "minimum": 1,
                            "maximum": 5,
                        },
                        "seed": 20260906,
                        "timestamp_column": "submitted_at",
                        "timestamp_start": "2026-08-01T00:00:00Z",
                        "timestamp_end": "2026-08-02T23:59:59Z",
                        "candidate_pool_size": 400,
                    }
                ),
                encoding="utf-8",
            )

            result = subprocess.run(
                [sys.executable, str(MAIN), "synthesize", "--job", str(job_path)],
                cwd=ENGINE_DIR,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((work_dir / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["sourceCount"], 80)
            self.assertEqual(report["syntheticCount"], 40)
            self.assertEqual(report["finalCount"], 120)
            self.assertTrue(report["achieved"]["exact"])
            self.assertAlmostEqual(report["achieved"]["mean"], 4.7)

            output = pd.read_parquet(work_dir / "result.parquet")
            self.assertEqual(len(output), 120)
            self.assertAlmostEqual(float(output["score"].mean()), 4.7)
            self.assertEqual((output["__origin"] == "original").sum(), 80)
            self.assertEqual((output["__origin"] == "synthetic").sum(), 40)


if __name__ == "__main__":
    unittest.main()
