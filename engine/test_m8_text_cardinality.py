from __future__ import annotations

import json
import unittest

import pandas as pd

from generate import generate_candidates


def _text_slot(value: str) -> str:
    return json.dumps(
        {"state": "answered", "value": {"kind": "text", "value": value}},
        ensure_ascii=False,
        separators=(",", ":"),
    )


class TextCardinalityBehaviorTest(unittest.TestCase):
    def _source(self, text_values: list[str]) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "response_id": [f"source-{index + 1}" for index in range(len(text_values))],
                "score": [2, 3, 4, 3] * (len(text_values) // 4),
                "comment": text_values,
                "aux": [float(index % 7) for index in range(len(text_values))],
            }
        )

    def test_low_cardinality_repeated_text_is_modeled_as_observed_categorical_support(self) -> None:
        positive = _text_slot("좋아요")
        negative = _text_slot("아쉬워요")
        source = self._source(([positive] * 30) + ([negative] * 10))

        pool = generate_candidates(
            source,
            id_column="response_id",
            target_column="score",
            target_min=1,
            target_max=5,
            target_score_counts={3: 8},
            pool_size=80,
            seed=20260906,
            categorical_columns=["comment"],
        )

        columns = pool.metadata.get("columns")
        self.assertIsInstance(columns, dict)
        assert isinstance(columns, dict)
        self.assertEqual(columns["comment"]["sdtype"], "categorical")
        generated = set(pool.data["comment"])
        self.assertTrue(generated <= {positive, negative})
        self.assertEqual(generated, {positive, negative})

    def test_high_cardinality_free_text_reuses_observed_slots_without_authoring_new_text(self) -> None:
        observed = [_text_slot(f"자유 응답 {index + 1}") for index in range(80)]
        source = self._source(observed)

        pool = generate_candidates(
            source,
            id_column="response_id",
            target_column="score",
            target_min=1,
            target_max=5,
            target_score_counts={3: 12},
            pool_size=120,
            seed=20260906,
            categorical_columns=["comment"],
        )

        observed_set = set(observed)
        generated = pool.data["comment"].tolist()
        self.assertEqual(len(generated), 120)
        self.assertTrue(set(generated) <= observed_set)
        for cell in generated:
            parsed = json.loads(cell)
            self.assertEqual(parsed["state"], "answered")
            self.assertEqual(parsed["value"]["kind"], "text")
            self.assertIn(cell, observed_set)


if __name__ == "__main__":
    unittest.main()
