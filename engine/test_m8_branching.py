from __future__ import annotations

import json
import unittest

import pandas as pd

from answer_slots import answer_cell_eligible
from candidate_selection import ConditionalShareTarget, plan_conditional_support, select_for_targets


def _slot(state: str, option_keys: list[str] | None = None) -> str:
    if state == "answered":
        return json.dumps(
            {
                "state": "answered",
                "value": {"kind": "multi_choice", "optionKeys": option_keys or []},
            },
            separators=(",", ":"),
        )
    return json.dumps({"state": state}, separators=(",", ":"))


class BranchingEligibilityTest(unittest.TestCase):
    def test_not_reached_and_indeterminate_rows_do_not_enter_conditional_denominator(self) -> None:
        selected = _slot("answered", ["A"])
        skipped = _slot("skipped")
        not_reached = _slot("not_reached")
        indeterminate = _slot("indeterminate")
        source = pd.DataFrame(
            {
                "score": [3, 3, 3, 3],
                "population": ["P", "P", "P", "P"],
                "checkbox": [selected, skipped, not_reached, indeterminate],
            }
        )
        target = ConditionalShareTarget(
            id="option-A",
            population_column="population",
            population_member_values=frozenset({"P"}),
            option_column="checkbox",
            option_values=frozenset({selected}),
            value=0.5,
        )

        self.assertTrue(answer_cell_eligible(selected))
        self.assertTrue(answer_cell_eligible(skipped))
        self.assertFalse(answer_cell_eligible(not_reached))
        self.assertFalse(answer_cell_eligible(indeterminate))

        support = plan_conditional_support(
            source,
            targets=(target,),
            final_count=4,
        )
        self.assertEqual(support.denominator_count, 2)
        self.assertAlmostEqual(support.total_absolute_error, 0.0)

        selection = select_for_targets(
            source,
            source.iloc[0:0].copy(),
            target_column="score",
            final_count=4,
            target_mean=3.0,
            target_min=1,
            target_max=5,
            conditional_share_targets=(target,),
        )
        achieved = selection.conditional_shares[0]
        self.assertEqual(achieved.denominator_count, 2)
        self.assertEqual(achieved.numerator_count, 1)
        self.assertAlmostEqual(achieved.achieved_share, 0.5)
        self.assertAlmostEqual(achieved.absolute_error, 0.0)

    def test_different_checkbox_questions_keep_independent_eligible_denominators(self) -> None:
        selected_a = _slot("answered", ["A"])
        selected_b = _slot("answered", ["B"])
        skipped = _slot("skipped")
        not_reached = _slot("not_reached")
        source = pd.DataFrame(
            {
                "score": [3, 3],
                "population": ["P", "P"],
                "checkbox_a": [selected_a, selected_a],
                "checkbox_b": [selected_b, not_reached],
            }
        )
        candidates = pd.DataFrame(
            {
                "score": [3],
                "population": ["P"],
                "checkbox_a": [skipped],
                "checkbox_b": [not_reached],
            }
        )
        target_a = ConditionalShareTarget(
            id="option-A",
            population_column="population",
            population_member_values=frozenset({"P"}),
            option_column="checkbox_a",
            option_values=frozenset({selected_a}),
            value=2 / 3,
        )
        target_b = ConditionalShareTarget(
            id="option-B",
            population_column="population",
            population_member_values=frozenset({"P"}),
            option_column="checkbox_b",
            option_values=frozenset({selected_b}),
            value=1.0,
        )

        selection = select_for_targets(
            source,
            candidates,
            target_column="score",
            final_count=3,
            target_mean=3.0,
            target_min=1,
            target_max=5,
            conditional_share_targets=(target_a, target_b),
        )
        by_id = {target.id: target for target in selection.conditional_shares}
        self.assertEqual(by_id["option-A"].denominator_count, 3)
        self.assertEqual(by_id["option-A"].numerator_count, 2)
        self.assertAlmostEqual(by_id["option-A"].absolute_error, 0.0)
        self.assertEqual(by_id["option-B"].denominator_count, 1)
        self.assertEqual(by_id["option-B"].numerator_count, 1)
        self.assertAlmostEqual(by_id["option-B"].absolute_error, 0.0)


if __name__ == "__main__":
    unittest.main()
