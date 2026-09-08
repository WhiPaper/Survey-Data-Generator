from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from main import run_synthesize


class TargetlessGenerationEngineTest(unittest.TestCase):
    def test_targetless_generation_adds_rows_without_public_target_outcomes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pd.DataFrame(
                {
                    "response_id": ["r1", "r2", "r3", "r4"],
                    "q_0": ["A", "B", "A", "B"],
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
                        "final_count": 6,
                        "mean_targets": [],
                        "count_targets": [],
                        "share_targets": [],
                        "conditional_share_targets": [],
                        "seed": 17,
                        "id_column": "response_id",
                        "categorical_columns": ["q_0"],
                        "candidate_pool_size": 30,
                    }
                ),
                encoding="utf-8",
            )

            report = run_synthesize(root / "job.json")

            self.assertEqual(report["status"], "success")
            self.assertEqual(report["sourceCount"], 4)
            self.assertEqual(report["syntheticCount"], 2)
            self.assertEqual(report["finalCount"], 6)
            self.assertEqual(report["achieved"]["means"], [])
            self.assertEqual(report["achieved"]["counts"], [])
            self.assertEqual(report["achieved"]["shares"], [])
            self.assertEqual(report["achieved"]["conditionalShares"], [])


if __name__ == "__main__":
    unittest.main()
