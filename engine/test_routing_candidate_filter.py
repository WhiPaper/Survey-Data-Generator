from __future__ import annotations

import json
import unittest

import pandas as pd

from candidate_selection import select_for_targets


def _choice(option_key: str) -> str:
    return json.dumps(
        {
            "state": "answered",
            "value": {
                "kind": "single_choice",
                "optionKey": option_key,
                "label": option_key,
            },
        },
        separators=(",", ":"),
    )


def _text(value: str) -> str:
    return json.dumps(
        {"state": "answered", "value": {"kind": "text", "value": value}},
        separators=(",", ":"),
    )


def _skipped() -> str:
    return json.dumps({"state": "skipped"}, separators=(",", ":"))


class RoutingCandidateFilterRegressionTest(unittest.TestCase):
    def test_invalid_candidate_is_removed_before_milp_when_valid_solution_exists(self) -> None:
        rules = json.dumps(
            [
                {
                    "sourceColumn": "branch",
                    "optionKey": "submit",
                    "forbidden": [{"column": "downstream", "kind": "answer_slot"}],
                }
            ],
            separators=(",", ":"),
        )
        source = pd.DataFrame(
            {
                "response_id": ["source-1"],
                "score": [0],
                "branch": [_choice("continue")],
                "downstream": [_text("source")],
                "__confirmed_routing_rules": [rules],
            }
        )
        candidates = pd.DataFrame(
            {
                "score": [0, 0],
                "branch": [_choice("submit"), _choice("continue")],
                "downstream": [_text("invalid"), _text("valid")],
                "__confirmed_routing_rules": [rules, rules],
            }
        )

        selection = select_for_targets(
            source,
            candidates,
            target_column="score",
            final_count=2,
            target_mean=0.0,
            target_min=0,
            target_max=0,
            primary_mean_id="mean",
        )

        self.assertEqual(selection.selected_indices.tolist(), [1])
        self.assertEqual(candidates.iloc[selection.selected_indices[0]]["downstream"], _text("valid"))

    def test_required_reached_candidate_is_removed_before_milp_when_blank(self) -> None:
        rules = json.dumps(
            [
                {
                    "sourceColumn": "branch",
                    "optionKey": "continue",
                    "forbidden": [],
                    "required": [{"column": "downstream", "kind": "answer_slot"}],
                }
            ],
            separators=(",", ":"),
        )
        source = pd.DataFrame(
            {
                "response_id": ["source-1"],
                "score": [0],
                "branch": [_choice("continue")],
                "downstream": [_text("source")],
                "__confirmed_routing_rules": [rules],
            }
        )
        candidates = pd.DataFrame(
            {
                "score": [0, 0],
                "branch": [_choice("continue"), _choice("continue")],
                "downstream": [_skipped(), _text("valid")],
                "__confirmed_routing_rules": [rules, rules],
            }
        )

        selection = select_for_targets(
            source,
            candidates,
            target_column="score",
            final_count=2,
            target_mean=0.0,
            target_min=0,
            target_max=0,
            primary_mean_id="mean",
        )

        self.assertEqual(selection.selected_indices.tolist(), [1])
        self.assertEqual(candidates.iloc[selection.selected_indices[0]]["downstream"], _text("valid"))


if __name__ == "__main__":
    unittest.main()
