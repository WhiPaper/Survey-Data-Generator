from __future__ import annotations

import subprocess
import sys
import textwrap
import unittest


class OptionalNeuralDependencyTests(unittest.TestCase):
    def test_gaussian_copula_runs_without_neural_stack(self) -> None:
        script = textwrap.dedent(
            r'''
            import importlib.abc
            import sys

            blocked_roots = {"ctgan", "deepecho", "torch", "triton", "nvidia", "cuda"}

            class BlockOptionalNeuralModules(importlib.abc.MetaPathFinder):
                def find_spec(self, fullname, path=None, target=None):
                    if fullname.split(".", 1)[0] in blocked_roots:
                        raise ModuleNotFoundError(f"blocked optional neural module: {fullname}")
                    return None

            sys.meta_path.insert(0, BlockOptionalNeuralModules())

            import pandas as pd
            from sdv.metadata import Metadata
            from sdv.single_table import GaussianCopulaSynthesizer

            data = pd.DataFrame(
                {
                    "score": [1, 2, 3, 4, 5, 3, 4, 2],
                    "segment": ["a", "a", "b", "b", "b", "a", "b", "a"],
                }
            )
            metadata = Metadata.detect_from_dataframe(
                data=data,
                table_name="table",
                infer_keys=None,
            )
            metadata.update_column(
                column_name="score",
                sdtype="numerical",
                table_name="table",
            )
            metadata.update_column(
                column_name="segment",
                sdtype="categorical",
                table_name="table",
            )
            metadata.validate()

            synthesizer = GaussianCopulaSynthesizer(
                metadata,
                enforce_min_max_values=False,
            )
            synthesizer.fit(data)
            sampled = synthesizer.sample(num_rows=3)
            assert len(sampled) == 3
            assert list(sampled.columns) == list(data.columns)
            print("GAUSSIAN_WITHOUT_NEURAL_STACK_OK")
            '''
        )

        completed = subprocess.run(
            [sys.executable, "-c", script],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("GAUSSIAN_WITHOUT_NEURAL_STACK_OK", completed.stdout)


if __name__ == "__main__":
    unittest.main()
