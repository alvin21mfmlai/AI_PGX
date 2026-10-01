import importlib.util
import math
import pathlib
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[1] / "scripts" / "benchmark.py"
SPEC = importlib.util.spec_from_file_location("benchmark", MODULE_PATH)
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class BenchmarkTests(unittest.TestCase):
    def test_percentile(self):
        self.assertEqual(benchmark.percentile([1, 2, 3], 0.5), 2)
        self.assertTrue(math.isnan(benchmark.percentile([], 0.5)))

    def test_strict_json_valid(self):
        ok, reason = benchmark.validate_expected('{"answer":290,"unit":"m3"}', {"answer": 290, "unit": "m3"})
        self.assertTrue(ok)
        self.assertEqual(reason, "ok")

    def test_markdown_fence_is_not_strict_json(self):
        ok, _ = benchmark.validate_expected('```json\n{"answer":290,"unit":"m3"}\n```', {"answer": 290, "unit": "m3"})
        self.assertFalse(ok)

    def test_type_constraint(self):
        ok, _ = benchmark.validate_expected('{"allowed":false,"explanation":"human approval required"}', {"allowed": False, "explanation_type": "string"})
        self.assertTrue(ok)

    def test_unexpected_keys_fail(self):
        ok, reason = benchmark.validate_expected('{"allowed":false,"explanation":"x","extra":1}', {"allowed": False, "explanation_type": "string"})
        self.assertFalse(ok)
        self.assertEqual(reason, "unexpected_keys")

    def test_prompt_file(self):
        path = pathlib.Path(__file__).parents[1] / "data" / "prompts.jsonl"
        rows = benchmark.load_prompts(path)
        self.assertEqual(len(rows), 8)
        self.assertEqual(len({row["id"] for row in rows}), 8)


if __name__ == "__main__":
    unittest.main()
