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

    def test_synthesize_does_not_infer_unique_categorical_column_as_primary_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            source_path = work_dir / "source.parquet"
            scores = [1, 2, 3, 4, 5, 1, 2, 3, 4]
            source = pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(9)],
                    "submitted_at": pd.date_range(
                        "2026-09-05T17:09:00Z", periods=9, freq="1min"
                    ),
                    "score": scores,
                    "q_2": [json.dumps({"state": "answered", "value": index}) for index in range(9)],
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
                        "final_count": 9,
                        "mean_target": {
                            "column": "score",
                            "value": sum(scores) / len(scores),
                            "minimum": 1,
                            "maximum": 5,
                        },
                        "seed": 42,
                        "categorical_columns": ["q_2"],
                        "timestamp_column": "submitted_at",
                        "candidate_pool_size": 40,
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
            self.assertNotIn("SingleTableMetadata", result.stderr)
            report = json.loads((work_dir / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["sourceCount"], 9)
            self.assertEqual(report["finalCount"], 9)
            self.assertTrue(report["validation"]["categoricalSupport"])

    def test_synthesize_generates_target_directed_candidate_support(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            source_path = work_dir / "source.parquet"
            scores = [5] + [4] * 79
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
                            "value": 4.3,
                            "minimum": 1,
                            "maximum": 5,
                        },
                        "seed": 20260906,
                        "categorical_columns": ["segment"],
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
            self.assertTrue(report["validation"]["targetSupportOptimal"])
            self.assertTrue(report["validation"]["categoricalSupport"])
            self.assertAlmostEqual(report["achieved"]["mean"], 4.3)
            self.assertAlmostEqual(report["achieved"]["bestPossibleMean"], 4.3)

            output = pd.read_parquet(work_dir / "result.parquet")
            synthetic = output.loc[output["__origin"] == "synthetic"]
            self.assertEqual(len(output), 120)
            self.assertAlmostEqual(float(output["score"].mean()), 4.3)
            self.assertEqual((output["__origin"] == "original").sum(), 80)
            self.assertEqual(len(synthetic), 40)
            self.assertEqual(int((synthetic["score"] == 5).sum()), 35)
            self.assertEqual(int((synthetic["score"] == 4).sum()), 5)
            self.assertTrue(set(synthetic["segment"]) <= {"A", "B"})

    def test_synthesize_directs_rare_share_support_and_solves_jointly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            source_path = work_dir / "source.parquet"
            source = pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(80)],
                    "submitted_at": pd.date_range(
                        "2026-08-01T00:00:00Z", periods=80, freq="20min"
                    ),
                    "score": [5] * 44 + [4] * 36,
                    "segment": ["A"] + ["B"] * 79,
                }
            )
            source.to_parquet(source_path, index=False)
            job_path = work_dir / "job.json"
            target_share = 41 / 120
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
                        "share_targets": [
                            {
                                "id": "group-1",
                                "column": "segment",
                                "member_values": ["A"],
                                "value": target_share,
                            }
                        ],
                        "seed": 20260906,
                        "categorical_columns": ["segment"],
                        "timestamp_column": "submitted_at",
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
            self.assertTrue(report["validation"]["targetSupportOptimal"])
            self.assertAlmostEqual(report["achieved"]["mean"], 4.7)
            self.assertEqual(len(report["achieved"]["shares"]), 1)
            share = report["achieved"]["shares"][0]
            self.assertAlmostEqual(share["share"], target_share)
            self.assertAlmostEqual(share["absoluteError"], 0.0)
            self.assertAlmostEqual(share["bestPossibleShare"], target_share)

            output = pd.read_parquet(work_dir / "result.parquet")
            synthetic = output.loc[output["__origin"] == "synthetic"]
            self.assertEqual(len(output), 120)
            self.assertAlmostEqual(float(output["score"].mean()), 4.7)
            self.assertAlmostEqual(float((output["segment"] == "A").mean()), target_share)
            self.assertEqual(int((synthetic["segment"] == "A").sum()), 40)

    def test_synthesize_solves_overlapping_conditional_checkbox_shares(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            source_path = work_dir / "source.parquet"
            population = ["P"] * 20 + ["O"] * 60
            checkbox = ["AB"] * 2 + ["A"] * 3 + ["B"] * 5 + ["NONE"] * 10
            checkbox += ["AB", "A", "B", "NONE"] * 15
            source = pd.DataFrame(
                {
                    "response_id": [f"source-{index + 1}" for index in range(80)],
                    "submitted_at": pd.date_range(
                        "2026-08-01T00:00:00Z", periods=80, freq="20min"
                    ),
                    "score": [5] * 44 + [4] * 36,
                    "population": population,
                    "checkbox": checkbox,
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
                        "share_targets": [
                            {
                                "id": "population-P",
                                "column": "population",
                                "member_values": ["P"],
                                "value": 0.5,
                            }
                        ],
                        "conditional_share_targets": [
                            {
                                "id": "option-A",
                                "population_column": "population",
                                "population_member_values": ["P"],
                                "option_column": "checkbox",
                                "option_values": ["A", "AB"],
                                "value": 0.75,
                            },
                            {
                                "id": "option-B",
                                "population_column": "population",
                                "population_member_values": ["P"],
                                "option_column": "checkbox",
                                "option_values": ["B", "AB"],
                                "value": 0.5,
                            },
                        ],
                        "seed": 20260906,
                        "categorical_columns": ["population", "checkbox"],
                        "timestamp_column": "submitted_at",
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
            self.assertAlmostEqual(report["achieved"]["mean"], 4.7)
            self.assertAlmostEqual(report["achieved"]["shares"][0]["share"], 0.5)
            conditional = {item["id"]: item for item in report["achieved"]["conditionalShares"]}
            self.assertAlmostEqual(conditional["option-A"]["share"], 0.75)
            self.assertAlmostEqual(conditional["option-B"]["share"], 0.5)
            self.assertEqual(conditional["option-A"]["denominatorCount"], 60)
            self.assertEqual(conditional["option-A"]["numeratorCount"], 45)
            self.assertEqual(conditional["option-B"]["denominatorCount"], 60)
            self.assertEqual(conditional["option-B"]["numeratorCount"], 30)

            output = pd.read_parquet(work_dir / "result.parquet")
            synthetic = output.loc[output["__origin"] == "synthetic"]
            self.assertEqual(len(synthetic), 40)
            self.assertTrue((synthetic["score"] == 5).all())
            self.assertTrue((synthetic["population"] == "P").all())
            self.assertEqual(int(synthetic["checkbox"].isin(["A", "AB"]).sum()), 40)
            self.assertEqual(int(synthetic["checkbox"].isin(["B", "AB"]).sum()), 23)


if __name__ == "__main__":
    unittest.main()
