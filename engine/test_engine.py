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


if __name__ == "__main__":
    unittest.main()
