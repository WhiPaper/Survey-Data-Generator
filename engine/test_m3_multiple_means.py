from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from main import run_synthesize


class MultipleMeanEngineTest(unittest.TestCase):
    def test_multiple_means_are_reported_by_target_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pd.DataFrame(
                {
                    "response_id": ["r1", "r2", "r3", "r4"],
                    "score_a": [1, 2, 4, 5],
                    "score_b": [5, 4, 2, 1],
                }
            ).to_parquet(root / "source.parquet")
            (root / "job.json").write_text(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "kind": "synthesize",
                        "source_parquet": "source.parquet",
                        "result_parquet": "result.parquet",
                        "report_json": "report.json",
                        "final_count": 4,
                        "mean_targets": [
                            {
                                "id": "a",
                                "column": "score_a",
                                "value": 3,
                                "minimum": 1,
                                "maximum": 5,
                            },
                            {
                                "id": "b",
                                "column": "score_b",
                                "value": 3,
                                "minimum": 1,
                                "maximum": 5,
                            },
                        ],
                        "seed": 7,
                        "id_column": "response_id",
                        "candidate_pool_size": 20,
                    }
                ),
                encoding="utf-8",
            )
            report = run_synthesize(root / "job.json")
            self.assertEqual(report["status"], "success")
            self.assertEqual({mean["id"] for mean in report["achieved"]["means"]}, {"a", "b"})

    def test_multiple_means_generate_candidates_when_final_count_grows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pd.DataFrame(
                {
                    "response_id": ["r1", "r2", "r3", "r4", "r5"],
                    "score_a": [1, 2, 3, 4, 5],
                    "score_b": [5, 4, 3, 2, 1],
                }
            ).to_parquet(root / "source.parquet")
            (root / "job.json").write_text(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "kind": "synthesize",
                        "source_parquet": "source.parquet",
                        "result_parquet": "result.parquet",
                        "report_json": "report.json",
                        "final_count": 7,
                        "mean_targets": [
                            {
                                "id": "a",
                                "column": "score_a",
                                "value": 3,
                                "minimum": 1,
                                "maximum": 5,
                            },
                            {
                                "id": "b",
                                "column": "score_b",
                                "value": 3,
                                "minimum": 1,
                                "maximum": 5,
                            },
                        ],
                        "seed": 17,
                        "id_column": "response_id",
                        "candidate_pool_size": 40,
                    }
                ),
                encoding="utf-8",
            )
            report = run_synthesize(root / "job.json")
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["sourceCount"], 5)
            self.assertEqual(report["syntheticCount"], 2)
            self.assertEqual(report["finalCount"], 7)
            self.assertGreater(report["candidatePoolCount"], 0)
            self.assertEqual({mean["id"] for mean in report["achieved"]["means"]}, {"a", "b"})
            self.assertTrue(all(mean["denominatorCount"] == 7 for mean in report["achieved"]["means"]))

    def test_zero_mean_run_uses_no_public_mean_outcome(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.parquet"
            pd.DataFrame(
                {
                    "response_id": ["r1", "r2", "r3", "r4"],
                    "q_0": ["A", "B", "A", "B"],
                }
            ).to_parquet(source)
            job = root / "job.json"
            job.write_text(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "kind": "synthesize",
                        "source_parquet": "source.parquet",
                        "result_parquet": "result.parquet",
                        "report_json": "report.json",
                        "final_count": 5,
                        "mean_targets": [],
                        "count_targets": [
                            {
                                "id": "count-a",
                                "column": "q_0",
                                "member_values": ["A"],
                                "value": 2,
                            }
                        ],
                        "seed": 7,
                        "id_column": "response_id",
                        "categorical_columns": ["q_0"],
                        "candidate_pool_size": 20,
                    }
                ),
                encoding="utf-8",
            )
            report = run_synthesize(job)
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["achieved"]["means"], [])


if __name__ == "__main__":
    unittest.main()
