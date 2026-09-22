import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('week02', Path(__file__).parents[1] / 'scripts/week02.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class Tests(unittest.TestCase):
    def test_constant_power(self):
        e = w.energy([{'mono': i, 'power_w': 100} for i in range(12)], 0.5, 10.5)
        self.assertAlmostEqual(e['energy_j'], 1000)

    def test_missing_is_not_zero(self):
        self.assertIsNone(w.energy([{'mono': i, 'power_w': None} for i in range(12)], 0, 11)['energy_j'])

    def test_gap_rejected(self):
        rows = [{'mono': i, 'power_w': 100} for i in range(20)]
        rows[7]['power_w'] = None
        self.assertIsNone(w.energy(rows, 0, 19)['energy_j'])

    def test_short_trace_rejected(self):
        self.assertIsNone(w.energy([{'mono': i, 'power_w': 100} for i in range(5)], 0, 4)['energy_j'])

    def test_no_extrapolation(self):
        self.assertIsNone(w.energy([{'mono': i, 'power_w': 100} for i in range(12)], 0, 12)['energy_j'])

    def test_numeric_parser(self):
        for x in ('[N/A]', 'NaN', 'inf', '-1', None):
            self.assertIsNone(w.number(x))
        self.assertEqual(w.number('37.5'), 37.5)

    def test_reject_huge_matrix(self):
        import json
        c = json.loads((Path(__file__).parents[1] / 'configs/full.json').read_text())
        c['n'] = 100000
        with self.assertRaises(AssertionError):
            w.validate(c)


if __name__ == '__main__':
    unittest.main()
