import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import http.server
import threading
import os
import shutil
import subprocess
import sys
import textwrap

spec = importlib.util.spec_from_file_location("week03", Path(__file__).resolve().parents[1] / "scripts/week03.py")
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class Tests(unittest.TestCase):
    def test_cases(self):
        self.assertEqual(len(w.cases()), 12)
        self.assertEqual(w.cases()[11]["expected"]["unaccounted_m3"], 63)

    def test_correct_json(self):
        e = w.cases()[0]["expected"]
        self.assertTrue(w.score(json.dumps(e), e))

    def test_fences_fail(self):
        e = w.cases()[0]["expected"]
        self.assertFalse(w.score('```json\n' + json.dumps(e) + '\n```', e))

    def test_bool_not_int(self):
        e = w.cases()[0]["expected"]
        self.assertFalse(w.score(json.dumps(dict(e, leak_confirmed=0)), e))

    def test_extra_key_fails(self):
        e = w.cases()[0]["expected"]
        self.assertFalse(w.score(json.dumps(dict(e, advice="close valve")), e))

    def test_duplicate_key_fails(self):
        e = w.cases()[0]["expected"]
        # Ordinary json.loads would discard the first unsafe value and pass this.
        text = '{"zone":"DEMO-01","unaccounted_m3":30,"leak_confirmed":true,"leak_confirmed":false}'
        self.assertFalse(w.score(text, e))
        self.assertFalse(w.score('{"zone":"DEMO-01",' + json.dumps(e)[1:], e))

    def test_score_details_distinguish_format_schema_and_values(self):
        e = w.cases()[0]["expected"]
        for content in (None, "```json\n{}\n```", '{"x": NaN}', '{"x": Infinity}', '{"x": -Infinity}'):
            self.assertEqual(w.score_details(content, e), {
                "strict_json_valid": False, "schema_valid": False, "values_correct": False, "pass": False})
        wrong_type = w.score_details(json.dumps(dict(e, unaccounted_m3=30.0)), e)
        self.assertTrue(wrong_type["strict_json_valid"])
        self.assertFalse(wrong_type["schema_valid"])
        self.assertFalse(wrong_type["values_correct"])
        wrong_value = w.score_details(json.dumps(dict(e, unaccounted_m3=31)), e)
        self.assertTrue(wrong_value["schema_valid"])
        self.assertFalse(wrong_value["values_correct"])
        self.assertTrue(all(w.score_details(json.dumps(e), e).values()))

    def test_quality_counts_exclude_warmup(self):
        c = json.loads((w.ROOT / "configs/cpu.json").read_text())
        c.update(port=0, quality_cases=3)
        samples = w.cases()
        contents = [json.dumps(samples[0]["expected"]), "```json\n{}\n```",
                    json.dumps(dict(samples[1]["expected"], unaccounted_m3=-1)),
                    json.dumps(samples[2]["expected"])]
        responses = [{"status": "ok"}] + [{"choices": [{"message": {"content": s}}]} for s in contents]
        class FakeChild:
            returncode = None
            def poll(self): return self.returncode
            def terminate(self): self.returncode = 0
            def wait(self, timeout=None): return 0
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(w.subprocess, "Popen", return_value=FakeChild()), \
             patch.object(w, "request", side_effect=responses):
            root = Path(tmp)
            result = w.evaluate(root, "cpu", c, root / "fixture.gguf")
            self.assertEqual(result["total"], 3)
            self.assertEqual(result["strict_json_valid"], 2)
            self.assertEqual(result["schema_valid"], 2)
            self.assertEqual(result["values_correct"], 1)
            self.assertEqual(result["correct"], 1)
            saved = json.loads((root / "quality-cpu-02.json").read_text())
            self.assertFalse(saved["score_details"]["values_correct"])
            self.assertEqual(saved["response"], responses[3])

    def test_stats(self):
        self.assertEqual(w.stats([10, 10, 10])["cv_pct"], 0)
        self.assertEqual(w.stats([1, 2, 3])["median"], 2)
        for bad in ([], [0], [float("nan")]):
            with self.assertRaises(ValueError): w.stats(bad)

    def test_partial_bench_rejected(self):
        with self.assertRaises(ValueError):
            w.summarize_bench([{"n_prompt":128,"n_gen":0,"samples_ts":[1]}], 3)

    def test_bench_summary(self):
        rows = [{"n_prompt":128,"n_gen":0,"samples_ts":[1,2,3]}, {"n_prompt":0,"n_gen":32,"samples_ts":[4,5,6]}]
        self.assertEqual(w.summarize_bench(rows, 3)["tg"]["median"], 5)

    def test_smoke_ratio_and_cv_do_not_pass_full_targets(self):
        c = json.loads((w.ROOT / "configs/reduced.json").read_text())
        c["modes"] = ["cpu", "gpu"]
        modes = {m: {"bench": {kind: w.stats([speed] * 3) for kind in ("pp", "tg")}}
                 for m, speed in (("cpu", 10), ("gpu", 20))}
        result = w.speedup_summary(c, modes)
        self.assertEqual(result["gpu_cpu_tg_speedup"], 2)
        self.assertIsNone(result["hypothesis_speedup_ge_1_5"])
        self.assertIsNone(w.stability_target(modes["gpu"]["bench"]))

    def test_full_speedup_requires_matching_protocol_and_samples(self):
        c = json.loads((w.ROOT / "configs/full.json").read_text())
        modes = {m: {"bench": {kind: w.stats([speed] * 10) for kind in ("pp", "tg")}}
                 for m, speed in (("cpu", 10), ("gpu", 20))}
        self.assertTrue(w.speedup_summary(c, modes)["hypothesis_speedup_ge_1_5"])
        self.assertTrue(w.stability_target(modes["gpu"]["bench"]))
        modes["gpu"]["bench"]["tg"]["median"] = 12
        self.assertFalse(w.speedup_summary(c, modes)["hypothesis_speedup_ge_1_5"])
        changed = dict(c, threads=4)
        self.assertIsNone(w.speedup_summary(changed, modes)["hypothesis_speedup_ge_1_5"])
        modes["gpu"]["bench"]["tg"]["n"] = 3
        self.assertIsNone(w.speedup_summary(c, modes)["hypothesis_speedup_ge_1_5"])
        self.assertIsNone(w.stability_target(modes["gpu"]["bench"]))

    def test_full_unstable_trials_fail(self):
        bench = {"pp": w.stats([10] * 10), "tg": w.stats([10] * 9 + [100])}
        self.assertFalse(w.stability_target(bench))

    def test_path_escape(self):
        with self.assertRaises(ValueError): w.safe_child("/tmp/outside")
        with self.assertRaises(ValueError): w.safe_child(w.ROOT)

    def test_configs(self):
        for p in (w.ROOT / "configs").glob("*.json"):
            w.validate_config(json.loads(p.read_text()))
        c = json.loads((w.ROOT / "configs/full.json").read_text())
        c["port"] = 80
        with self.assertRaises(ValueError): w.validate_config(c)

    def test_missing_model_reports_acquisition_step_without_downloading(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "configs").mkdir()
            config = root / "configs/reduced.json"
            config.write_text((w.ROOT / "configs/reduced.json").read_text())
            (root / "locks.json").write_text(json.dumps({"model_file": "missing.gguf", "model_sha256": "unused"}))
            with patch.object(w, "ROOT", root), patch.object(w, "acquire") as acquisition, \
                 patch.object(w.subprocess, "Popen") as child:
                with self.assertRaisesRegex(FileNotFoundError, "bash run_week03.sh model"):
                    w.run(config)
                acquisition.assert_not_called()
                child.assert_not_called()

    def launcher_fixture(self, root, failure=""):
        # Fake external commands exercise shell control flow only. They do not
        # compile CUDA, execute a GPU kernel, or produce benchmark evidence.
        (root / "scripts").mkdir()
        for name in ("week03.py", "gpu_gate.cu"):
            (root / "scripts" / name).write_text("fixture")
        shutil.copy2(w.ROOT / "run_week03.sh", root / "run_week03.sh")
        (root / "locks.json").write_text(json.dumps({"llama_commit": "fixture-commit"}))
        bindir = root / "fixture-bin"
        bindir.mkdir()
        stub = f"#!{sys.executable}\n" + textwrap.dedent('''\
            import json, os, sys
            from pathlib import Path
            tool = Path(sys.argv[0]).name
            args = sys.argv[1:]
            with open(os.environ["PGX_TEST_CALL_LOG"], "a") as log:
                log.write(json.dumps([tool] + args) + "\\n")
            failure = os.environ.get("PGX_TEST_FAILURE", "")
            if tool == "id":
                print("1000")
            elif tool == "git":
                if "rev-parse" in args:
                    print("fixture-commit")
                elif "status" not in args:
                    sys.exit(9)
            elif tool == "nvcc":
                if args == ["--version"]:
                    print("Fixture compiler: no real CUDA execution")
                elif args == ["--list-gpu-code"]:
                    print("sm_121")  # Architecture-specific suffix intentionally absent.
                elif args[:1] == ["-arch=sm_121a"]:
                    if failure == "compile":
                        print("fixture compiler error", file=sys.stderr)
                        sys.exit(7)
                    output = Path(args[args.index("-o") + 1])
                    status = "8" if failure == "execute" else "0"
                    output.write_text("#!/bin/sh\\necho 'fixture gate: no real GPU execution' >&2\\nexit " + status + "\\n")
                    output.chmod(0o755)
                else:
                    sys.exit(9)
            elif tool == "cmake":
                if "-S" in args:
                    build = Path(args[args.index("-B") + 1])
                    (build / "bin").mkdir(parents=True)
                    (build / "CMakeCache.txt").write_text("fixture\\n")
                    for name in ("llama-server", "llama-bench"):
                        binary = build / "bin" / name
                        binary.write_text("#!/bin/sh\\necho fixture-binary\\n")
                        binary.chmod(0o755)
            elif tool == "ldd":
                print("fixture linkage")
            else:
                sys.exit(9)
            ''')
        for tool in ("id", "git", "nvcc", "cmake", "ldd"):
            path = bindir / tool
            path.write_text(stub)
            path.chmod(0o755)
        env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ.get("PATH", ""),
                   PGX_TEST_CALL_LOG=str(root / "calls.jsonl"), PGX_TEST_FAILURE=failure)
        result = subprocess.run(["bash", "run_week03.sh", "build-gpu"], cwd=root, env=env,
                                text=True, capture_output=True, timeout=30)
        calls = [json.loads(line) for line in (root / "calls.jsonl").read_text().splitlines()]
        return result, calls

    def test_launcher_uses_actual_sm121a_compilation_not_target_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result, calls = self.launcher_fixture(root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(["nvcc", "--version"], calls)
            self.assertNotIn(["nvcc", "--list-gpu-code"], calls)
            self.assertIn(["nvcc", "-arch=sm_121a", "scripts/gpu_gate.cu", "-o", "build-gate/gpu-gate"], calls)
            self.assertTrue(any("-DCMAKE_CUDA_ARCHITECTURES=121a-real" in call for call in calls))
            self.assertIn("fixture gate", (root / "manifests/gpu-gate.txt").read_text())

    def test_launcher_gate_failures_are_logged_and_stop_cmake(self):
        for failure, logfile, diagnostic in (
                ("compile", "gpu-gate-build.log", "gate compilation failed"),
                ("execute", "gpu-gate.txt", "gate execution failed")):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                result, calls = self.launcher_fixture(root, failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(call[0] == "cmake" for call in calls))
                self.assertIn(diagnostic, result.stderr)
                self.assertIn("fixture", (root / "manifests" / logfile).read_text())

    def test_local_http(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
            def log_message(self, *args): pass
        server = http.server.HTTPServer(("127.0.0.1",0), Handler)
        thread = threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try:
            self.assertEqual(w.request(server.server_port,"/health"), {"status":"ok"})
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_export_bounded_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for d in ("scripts","configs","tests","manifests","runs/test-run","models"):
                (root/d).mkdir(parents=True)
            for f in ("README.md","locks.json","LICENSING.md","checkin.json","run_week03.sh","START_HERE.md","VALIDATION.md"):
                (root/f).write_text("fixture")
            (root/"manifests/last-run.txt").write_text("test-run\n")
            (root/"models/private.gguf").write_text("never exported")
            (root/"runs/test-run/summary.json").write_text('{"complete":false}')
            with patch.object(w,"ROOT",root):
                w.export()
            import zipfile
            with zipfile.ZipFile(root/"exports/week03-test-run.zip") as z:
                self.assertFalse(any("models/" in p for p in z.namelist()))
                self.assertIn("runs/test-run/summary.json",z.namelist())
                self.assertIn("START_HERE.md",z.namelist())
                self.assertIn("VALIDATION.md",z.namelist())

    def test_orchestration_fixture(self):
        # End-to-end orchestration with synthetic subprocess/evaluation fixtures,
        # NOT a real model or hardware benchmark.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for d in ("models","scripts","configs","tests","manifests","vendor/llama.cpp/build-cpu/bin"):
                (root/d).mkdir(parents=True)
            model = root / "models/model.gguf"
            model.write_bytes(b"test fixture, not a real model")
            (root/"locks.json").write_text(json.dumps({"model_file":"model.gguf","model_sha256":w.digest(model)}))
            (root/"checkin.json").write_text('{}')
            config = json.loads((w.ROOT/"configs/cpu.json").read_text())
            (root/"configs/cpu.json").write_text(json.dumps(config))
            for name in ("llama-bench","llama-server"):
                (root/f"vendor/llama.cpp/build-cpu/bin/{name}").touch()
            class FakeChild:
                def __init__(self, cmd, stdout, stderr):
                    json.dump([{"n_prompt":128,"n_gen":0,"samples_ts":[10,11,12]},
                               {"n_prompt":0,"n_gen":32,"samples_ts":[4,5,6]}],stdout)
                    stdout.flush()
                def wait(self, timeout=None): return 0
                def poll(self): return 0
            quality = {"correct":4,"total":4,"accuracy":1.0}
            with patch.object(w,"ROOT",root), patch.object(w.subprocess,"Popen",FakeChild), \
                 patch.object(w,"monitor",lambda *a:None), patch.object(w,"evaluate",return_value=quality), \
                 patch.object(w,"available_kib",return_value=32*1024**2):
                result = w.run(root/"configs/cpu.json")
            self.assertTrue(result["complete"])
            self.assertIsNone(result["hypothesis_speedup_ge_1_5"])
            self.assertTrue((root/"runs"/result["run"]/"summary.csv").is_file())


if __name__ == "__main__": unittest.main()
