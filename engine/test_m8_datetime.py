from __future__ import annotations

import unittest

import pandas as pd

from evaluate import _timestamp_diagnostics


class DatetimeDistributionSanityTest(unittest.TestCase):
    def test_ks_statistic_distinguishes_uniform_from_uneven_temporal_density(self) -> None:
        early = pd.date_range("2026-08-01T00:00:00Z", periods=10, freq="1min")
        late = pd.date_range("2026-08-01T23:50:00Z", periods=10, freq="1min")
        source = pd.DataFrame({"submitted_at": [*early, *late]})
        matched = source.copy()
        uniform = pd.DataFrame(
            {
                "submitted_at": pd.date_range(
                    "2026-08-01T00:00:00Z",
                    "2026-08-01T23:59:00Z",
                    periods=20,
                )
            }
        )

        matched_ks, matched_median_delta = _timestamp_diagnostics(
            source,
            matched,
            pd.concat([source, matched], ignore_index=True),
            timestamp_column="submitted_at",
        )
        uniform_ks, _ = _timestamp_diagnostics(
            source,
            uniform,
            pd.concat([source, uniform], ignore_index=True),
            timestamp_column="submitted_at",
        )

        self.assertAlmostEqual(matched_ks or 0.0, 0.0)
        self.assertAlmostEqual(matched_median_delta or 0.0, 0.0)
        self.assertIsNotNone(uniform_ks)
        assert uniform_ks is not None
        self.assertGreater(uniform_ks, 0.3)

    def test_rejects_final_timestamp_outside_frozen_scope(self) -> None:
        source = pd.DataFrame(
            {"submitted_at": pd.to_datetime(["2026-08-01T12:00:00Z"], utc=True)}
        )
        synthetic = pd.DataFrame(
            {"submitted_at": pd.to_datetime(["2026-08-02T00:00:00Z"], utc=True)}
        )
        final = pd.concat([source, synthetic], ignore_index=True)

        with self.assertRaisesRegex(RuntimeError, "after the frozen time scope"):
            _timestamp_diagnostics(
                source,
                synthetic,
                final,
                timestamp_column="submitted_at",
                timestamp_start=pd.Timestamp("2026-08-01T00:00:00Z"),
                timestamp_end=pd.Timestamp("2026-08-01T23:59:59Z"),
            )


if __name__ == "__main__":
    unittest.main()
