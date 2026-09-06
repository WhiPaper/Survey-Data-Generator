from __future__ import annotations

import unittest

import pandas as pd

from evaluate import _row_diagnostics


class RowQualityDiagnosticsTest(unittest.TestCase):
    def test_reports_duplicate_concentration_and_exact_source_clones(self) -> None:
        source = pd.DataFrame(
            {
                "response_id": ["source-1", "source-2", "source-3"],
                "score": [1, 2, 3],
                "segment": ["A", "B", "C"],
            }
        )
        synthetic = pd.DataFrame(
            {
                "response_id": ["synthetic-1", "synthetic-2", "synthetic-3", "synthetic-4"],
                "score": [1, 4, 4, 4],
                "segment": ["A", "D", "D", "D"],
                "__origin": ["synthetic"] * 4,
            }
        )
        source_output = source.copy()
        source_output["__origin"] = "original"
        final = pd.concat([source_output, synthetic], ignore_index=True)

        diagnostics = _row_diagnostics(source, synthetic, final, id_column="response_id")

        self.assertEqual(diagnostics[0], 5)
        self.assertEqual(diagnostics[1], 3)
        self.assertAlmostEqual(diagnostics[2], 0.75)
        self.assertEqual(diagnostics[3], 1)
        self.assertAlmostEqual(diagnostics[4], 0.25)

    def test_scales_exact_clone_and_concentration_counts_on_larger_fixture(self) -> None:
        source_count, synthetic_count = 5_000, 1_500
        clone_count, concentration_count = 120, 100
        source = pd.DataFrame(
            {
                "response_id": [f"source-{i}" for i in range(source_count)],
                "score": [(i % 5) + 1 for i in range(source_count)],
                "segment": [f"source-segment-{i}" for i in range(source_count)],
            }
        )
        clones = source.iloc[:clone_count].copy()
        clones["response_id"] = [f"synthetic-clone-{i}" for i in range(clone_count)]
        concentrated = pd.DataFrame(
            {
                "response_id": [f"synthetic-repeat-{i}" for i in range(concentration_count)],
                "score": [5] * concentration_count,
                "segment": ["novel-repeat"] * concentration_count,
            }
        )
        unique_count = synthetic_count - clone_count - concentration_count
        unique = pd.DataFrame(
            {
                "response_id": [f"synthetic-unique-{i}" for i in range(unique_count)],
                "score": [(i % 5) + 1 for i in range(unique_count)],
                "segment": [f"novel-{i}" for i in range(unique_count)],
            }
        )
        synthetic = pd.concat([clones, concentrated, unique], ignore_index=True)
        synthetic["__origin"] = "synthetic"
        source_output = source.copy()
        source_output["__origin"] = "original"
        final = pd.concat([source_output, synthetic], ignore_index=True)

        diagnostics = _row_diagnostics(source, synthetic, final, id_column="response_id")

        self.assertEqual(diagnostics[0], clone_count * 2 + concentration_count)
        self.assertEqual(diagnostics[1], concentration_count)
        self.assertAlmostEqual(diagnostics[2], concentration_count / synthetic_count)
        self.assertEqual(diagnostics[3], clone_count)
        self.assertAlmostEqual(diagnostics[4], clone_count / synthetic_count)


if __name__ == "__main__":
    unittest.main()
