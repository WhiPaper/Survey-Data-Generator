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

        (
            duplicate_row_count,
            max_fingerprint_count,
            max_fingerprint_share,
            source_clone_count,
            source_clone_rate,
        ) = _row_diagnostics(source, synthetic, final, id_column="response_id")

        self.assertEqual(duplicate_row_count, 5)
        self.assertEqual(max_fingerprint_count, 3)
        self.assertAlmostEqual(max_fingerprint_share, 0.75)
        self.assertEqual(source_clone_count, 1)
        self.assertAlmostEqual(source_clone_rate, 0.25)


if __name__ == "__main__":
    unittest.main()
