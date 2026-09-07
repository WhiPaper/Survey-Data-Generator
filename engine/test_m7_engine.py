from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from generate import CandidatePool
from main import run_synthesize


class M7EngineEditPlanTest(unittest.TestCase):
    def test_replacement_preview_never_overwrites_append_only_result(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work_dir = Path(directory)
            source_path = work_dir / "source.parquet"
            result_path = work_dir / "result.parquet"
            report_path = work_dir / "report.json"
            job_path = work_dir / "job.json"

            pd.DataFrame(
                {
                    "response_id": ["source-1", "source-2", "source-3"],
                    "score": [5, 5, 5],
                }
            ).to_parquet(source_path, index=False)
            job_path.write_text(
                json.dumps(
                    {
                        "protocol_version": 1,
                        "kind": "synthesize",
                        "source_parquet": source_path.name,
                        "result_parquet": result_path.name,
                        "report_json": report_path.name,
                        "final_count": 4,
                        "mean_targets": [{"id": "mean",
                            "column": "score",
                            "value": 3.0,
                            "minimum": 1,
                            "maximum": 5,
                        }],
                        "seed": 7,
                        "candidate_pool_size": 4,
                    }
                ),
                encoding="utf-8",
            )
            pool = CandidatePool(
                data=pd.DataFrame({"score": [1, 1, 1, 5]}),
                metadata={},
            )

            with patch("main.generate_candidates", return_value=pool):
                report = run_synthesize(job_path)

            self.assertEqual(report["status"], "success")
            self.assertEqual(report["editPlan"]["status"], "available")
            self.assertEqual(report["editPlan"]["replacementCount"], 1)
            self.assertFalse(report["validation"]["replacementApplied"])

            append_only = pd.read_parquet(result_path)
            self.assertEqual(len(append_only), 4)
            self.assertEqual(int((append_only["__origin"] == "original").sum()), 3)
            self.assertAlmostEqual(float(append_only["score"].mean()), 4.0)

            replacement_path = work_dir / "result.replacement.parquet"
            self.assertTrue(replacement_path.is_file())
            replacement = pd.read_parquet(replacement_path)
            self.assertEqual(len(replacement), 4)
            self.assertEqual(int((replacement["__origin"] == "original").sum()), 2)
            self.assertAlmostEqual(float(replacement["score"].mean()), 3.0)
            self.assertAlmostEqual(
                report["editPlan"]["replacementOutcome"]["mean"],
                3.0,
            )
            self.assertEqual(len(report["editPlan"]["proposedReplacements"]), 1)


if __name__ == "__main__":
    unittest.main()
