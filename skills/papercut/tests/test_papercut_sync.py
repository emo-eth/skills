#!/usr/bin/env python3
import concurrent.futures
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

TEST_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TEST_ROOT.parent.parent.parent
PAPERCUT_SH = TEST_ROOT.parent / "scripts" / "papercut.sh"
MIGRATE_PY = TEST_ROOT.parent / "scripts" / "migrate_papercuts.py"
CHEZMOI_SOURCE_DIR = Path.home() / ".local/share/chezmoi"
RECONCILE_PY = CHEZMOI_SOURCE_DIR / "private_dot_local/bin/executable_chezmoi-reconcile-logs.py"
RECORDS_PY = CHEZMOI_SOURCE_DIR / "private_dot_local/bin/papercut_records.py"
ASSIMILATE_SH = CHEZMOI_SOURCE_DIR / "private_dot_local/bin/executable_chezmoi-assimilate.sh"
UPDATE_POST_SH = CHEZMOI_SOURCE_DIR / "private_dot_local/bin/executable_chezmoi-update-post.sh"
RUN_AFTER_SH = CHEZMOI_SOURCE_DIR / "run_after_reconcile-logs.sh"

class TestPapercutSyncE2E(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="papercut-test-suite-")

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_cli_control_chars_and_escaping(self):
        """Verify papercut.sh properly handles escape codes, control chars, quotes, and newlines."""
        out_file = Path(self.temp_dir) / "test_ctrl.jsonl"
        msg = "Control test: \x1b[31mred\x1b[0m \x08backspace \x0cformfeed \t tab \"quoted\" and \nnewline"
        
        # Test file output
        cmd = [
            "bash", str(PAPERCUT_SH),
            "--path", str(out_file),
            "-m", "test-agent",
            "--file", "src/file1.ts",
            "--file", "src/file2.ts",
            msg
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        self.assertIn("logged:", res.stdout)
        
        # Verify file contents are valid single-line JSONL
        content = out_file.read_bytes()
        self.assertTrue(content.endswith(b"\n"))
        lines = content.decode("utf-8").split("\n")
        self.assertEqual(lines[-1], "")
        self.assertEqual(len(lines), 2) # one record + trailing empty from \n
        
        record = json.loads(lines[0])
        self.assertEqual(record["schema"], "springfield.papercut.v3")
        self.assertEqual(record["agent"], "test-agent")
        self.assertEqual(record["files"], ["src/file1.ts", "src/file2.ts"])
        self.assertIn("\x1b[31m", record["message"])
        self.assertIn("\x08", record["message"])
        self.assertIn("\x0c", record["message"])
        self.assertIn("newline", record["message"])
        self.assertIn('"quoted"', record["message"])
        uuid.UUID(record["id"]) # must be valid UUID

        # Test --json receipt output
        cmd_json = [
            "bash", str(PAPERCUT_SH),
            "--path", str(out_file),
            "--json",
            "-m", "test-agent",
            msg
        ]
        res_json = subprocess.run(cmd_json, capture_output=True, text=True, check=True)
        receipt = json.loads(res_json.stdout)
        self.assertEqual(receipt["schema"], "springfield.papercut.v3")
        self.assertEqual(receipt["written"], True)
        self.assertIn("\x1b[31m", receipt["message"])

    def test_concurrent_cli_appends(self):
        """Verify that 20 concurrent processes appending to the same file never corrupt or lose records."""
        out_file = Path(self.temp_dir) / "concurrent.jsonl"
        num_appends = 20

        def run_one(idx):
            msg = f"Concurrent append {idx} with control \x1b[33myellow\x1b[0m and \nline"
            cmd = [
                "bash", str(PAPERCUT_SH),
                "--path", str(out_file),
                "-m", f"agent-{idx}",
                msg
            ]
            subprocess.run(cmd, capture_output=True, text=True, check=True)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(run_one, range(num_appends)))

        lines = [l for l in out_file.read_text(encoding="utf-8").split("\n") if l.strip()]
        self.assertEqual(len(lines), num_appends)
        parsed_ids = set()
        for l in lines:
            rec = json.loads(l)
            parsed_ids.add(rec["id"])
        self.assertEqual(len(parsed_ids), num_appends)

    def test_reconcile_error_refusal_on_malformed_and_conflict(self):
        """Verify reconciler exits nonzero and refuses to touch files on corrupt JSON or conflicting UUIDs."""
        source_dir = Path(self.temp_dir) / "source"
        home_dir = Path(self.temp_dir) / "home"
        source_dir.mkdir(parents=True)
        home_dir.mkdir(parents=True)

        dest_jsonl = home_dir / "PAPERCUTS.jsonl"
        dest_jsonl.write_text("MALFORMED NOT JSON\n", encoding="utf-8")

        # Reconciler must fail with exit code != 0 and != 10
        res = subprocess.run(
            [sys.executable, str(RECONCILE_PY), "--source-dir", str(source_dir), "--dest-dir", str(home_dir)],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertNotEqual(res.returncode, 10)
        self.assertIn("Invalid JSON", res.stderr)

        # Conflicting record test
        test_id = str(uuid.uuid4())
        rec1 = {"schema": "springfield.papercut.v3", "id": test_id, "message": "Original"}
        rec2 = {"schema": "springfield.papercut.v3", "id": test_id, "message": "Conflicting payload"}
        
        source_jsonl = source_dir / "PAPERCUTS.jsonl"
        source_jsonl.write_text(json.dumps(rec1) + "\n", encoding="utf-8")
        dest_jsonl.write_text(json.dumps(rec2) + "\n", encoding="utf-8")

        res = subprocess.run(
            [sys.executable, str(RECONCILE_PY), "--source-dir", str(source_dir), "--dest-dir", str(home_dir)],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertNotEqual(res.returncode, 10)
        self.assertIn("Conflict", res.stderr)

    def test_old_machine_upgrade_rebase_and_migration(self):
        """Simulate an old machine running old assimilate + markdown append, pulling new remote with union attributes."""
        root = Path(self.temp_dir) / "upgrade_sim"
        remote_git = root / "remote.git"
        seed_dir = root / "seed"
        old_home = root / "old_home"
        root.mkdir()

        # Bare remote
        subprocess.run(["git", "init", "--bare", str(remote_git)], check=True, capture_output=True)

        # Seed with initial state
        subprocess.run(["git", "init", str(seed_dir)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(seed_dir), "config", "user.name", "Seed"], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "config", "user.email", "seed@example.com"], check=True)

        # Copy current chezmoi files into seed
        shutil.copy2(CHEZMOI_SOURCE_DIR / ".chezmoi.toml.tmpl", seed_dir / ".chezmoi.toml.tmpl")
        shutil.copy2(CHEZMOI_SOURCE_DIR / ".chezmoiignore", seed_dir / ".chezmoiignore")
        shutil.copy2(CHEZMOI_SOURCE_DIR / ".gitattributes", seed_dir / ".gitattributes")
        shutil.copy2(CHEZMOI_SOURCE_DIR / "PAPERCUTS.md", seed_dir / "PAPERCUTS.md")
        shutil.copy2(CHEZMOI_SOURCE_DIR / "PAPERCUTS.jsonl", seed_dir / "PAPERCUTS.jsonl")
        
        yearn_dir = seed_dir / "dot_yearn"
        yearn_dir.mkdir(parents=True)
        shutil.copy2(CHEZMOI_SOURCE_DIR / "dot_yearn/yearnings.ndjson", yearn_dir / "yearnings.ndjson")
        tenet_dir = seed_dir / "dot_tenet"
        tenet_dir.mkdir(parents=True)
        shutil.copy2(CHEZMOI_SOURCE_DIR / "dot_tenet/tenets.ndjson", tenet_dir / "tenets.ndjson")
        
        bin_dir = seed_dir / "private_dot_local/bin"
        bin_dir.mkdir(parents=True)
        shutil.copy2(ASSIMILATE_SH, bin_dir / "executable_chezmoi-assimilate.sh")
        shutil.copy2(RECONCILE_PY, bin_dir / "executable_chezmoi-reconcile-logs.py")
        shutil.copy2(RECORDS_PY, bin_dir / "papercut_records.py")
        shutil.copy2(UPDATE_POST_SH, bin_dir / "executable_chezmoi-update-post.sh")
        shutil.copy2(RUN_AFTER_SH, seed_dir / "run_after_reconcile-logs.sh")

        subprocess.run(["git", "-C", str(seed_dir), "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(seed_dir), "commit", "-m", "Seed remote"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(seed_dir), "remote", "add", "origin", str(remote_git)], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "push", "-u", "origin", "main"], check=True, capture_output=True)

        # Old machine clone
        old_source = old_home / ".local/share/chezmoi"
        subprocess.run(["git", "clone", str(remote_git), str(old_source)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(old_source), "config", "user.name", "OldMachine"], check=True)
        subprocess.run(["git", "-C", str(old_source), "config", "user.email", "old@example.com"], check=True)

        # In remote: advance with a new JSONL entry from a modern machine
        new_rec = {
            "schema": "springfield.papercut.v3",
            "id": str(uuid.uuid4()),
            "timestamp": "2026-09-13T22:00:00Z",
            "agent": "new-machine",
            "message": "New machine note",
        }
        with open(seed_dir / "PAPERCUTS.jsonl", "a") as f:
            f.write(json.dumps(new_rec) + "\n")
        subprocess.run(["git", "-C", str(seed_dir), "commit", "-am", "New machine append"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(seed_dir), "push"], check=True, capture_output=True)

        # Old machine: simulate local legacy markdown append before update
        legacy_append = (
            "- **2026-09-13T22:30:00Z** `old-agent`\n"
            "  - repo: `old-repo` root: `/path`\n"
            "  - worktree: `/path`\n"
            "  - branch: `main` @ `abcdef1`\n"
            "  - cwd: `.`\n"
            "  - note: Friction on old machine before migration\n"
        )
        old_dest_md = old_home / "PAPERCUTS.md"
        old_home.mkdir(parents=True, exist_ok=True)
        # copy seed PAPERCUTS.md
        shutil.copy2(CHEZMOI_SOURCE_DIR / "PAPERCUTS.md", old_dest_md)
        with open(old_dest_md, "a") as f:
            f.write(legacy_append)

        # Old machine runs assimilation: copies ~/PAPERCUTS.md to source and commits
        shutil.copy2(old_dest_md, old_source / "PAPERCUTS.md")
        subprocess.run(["git", "-C", str(old_source), "commit", "-am", "Old machine local markdown commit"], check=True, capture_output=True)

        # Old machine runs git pull --rebase (like chezmoi update does)
        # With PAPERCUTS.md merge=union in .gitattributes, rebase succeeds cleanly!
        pull_res = subprocess.run(["git", "-C", str(old_source), "pull", "--rebase"], capture_output=True, text=True)
        self.assertEqual(pull_res.returncode, 0, f"Git pull --rebase failed on old machine: {pull_res.stderr}")

        # Post-update reconciliation runs
        reconcile_res = subprocess.run(
            [sys.executable, str(RECONCILE_PY), "--source-dir", str(old_source), "--dest-dir", str(old_home)],
            capture_output=True,
            text=True,
        )
        # Reconciler should find the legacy entry, migrate it to JSONL, and exit with 10 (modified source)
        self.assertIn(reconcile_res.returncode, [0, 10])

        # Verify old machine's destination now has PAPERCUTS.jsonl with BOTH entries!
        dest_jsonl = old_home / "PAPERCUTS.jsonl"
        self.assertTrue(dest_jsonl.exists())
        dest_lines = [l for l in dest_jsonl.read_text().split("\n") if l.strip()]
        self.assertEqual(len(dest_lines), 133) # 131 initial + 1 new-machine + 1 old-machine legacy
        
        # Verify legacy backup created
        self.assertTrue((old_home / "PAPERCUTS.md.bak").exists())

    def test_full_two_machine_offline_sync_and_race_prevention(self):
        """Full end-to-end chezmoi lifecycle test with two machines and mid-sync append race."""
        root = Path(self.temp_dir) / "chezmoi_full_e2e"
        remote_git = root / "remote.git"
        seed_dir = root / "seed"
        home1 = root / "home1"
        home2 = root / "home2"
        root.mkdir()

        subprocess.run(["git", "init", "--bare", str(remote_git)], check=True, capture_output=True)

        # Initialize seed repo
        subprocess.run(["git", "init", str(seed_dir)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(seed_dir), "config", "user.name", "Seed"], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "config", "user.email", "seed@example.com"], check=True)
        shutil.copy2(CHEZMOI_SOURCE_DIR / ".chezmoi.toml.tmpl", seed_dir / ".chezmoi.toml.tmpl")
        (seed_dir / ".chezmoiignore").write_text("PAPERCUTS.jsonl\n.yearn\n.yearn/**\n.tenet\n.tenet/**\nPAPERCUTS.md\n.gitattributes\n")
        shutil.copy2(CHEZMOI_SOURCE_DIR / ".gitattributes", seed_dir / ".gitattributes")
        shutil.copy2(CHEZMOI_SOURCE_DIR / "PAPERCUTS.jsonl", seed_dir / "PAPERCUTS.jsonl")
        shutil.copy2(CHEZMOI_SOURCE_DIR / "PAPERCUTS.md", seed_dir / "PAPERCUTS.md")
        yearn_dir = seed_dir / "dot_yearn"
        yearn_dir.mkdir(parents=True)
        shutil.copy2(CHEZMOI_SOURCE_DIR / "dot_yearn/yearnings.ndjson", yearn_dir / "yearnings.ndjson")
        tenet_dir = seed_dir / "dot_tenet"
        tenet_dir.mkdir(parents=True)
        shutil.copy2(CHEZMOI_SOURCE_DIR / "dot_tenet/tenets.ndjson", tenet_dir / "tenets.ndjson")

        bin_dir = seed_dir / "private_dot_local/bin"
        bin_dir.mkdir(parents=True)
        shutil.copy2(ASSIMILATE_SH, bin_dir / "executable_chezmoi-assimilate.sh")
        shutil.copy2(RECONCILE_PY, bin_dir / "executable_chezmoi-reconcile-logs.py")
        shutil.copy2(RECORDS_PY, bin_dir / "papercut_records.py")
        shutil.copy2(UPDATE_POST_SH, bin_dir / "executable_chezmoi-update-post.sh")
        shutil.copy2(RUN_AFTER_SH, seed_dir / "run_after_reconcile-logs.sh")

        subprocess.run(["git", "-C", str(seed_dir), "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(seed_dir), "commit", "-m", "Init"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(seed_dir), "remote", "add", "origin", str(remote_git)], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "push", "-u", "origin", "main"], check=True, capture_output=True)

        # Clone to machine 1 and machine 2
        for h, name in [(home1, "MachineOne"), (home2, "MachineTwo")]:
            h.mkdir(parents=True)
            source = h / ".local/share/chezmoi"
            subprocess.run(["git", "clone", str(remote_git), str(source)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(source), "config", "user.name", name], check=True)
            subprocess.run(["git", "-C", str(source), "config", "user.email", f"{name.lower()}@example.com"], check=True)
            
            # Run initial bootstrap reconciliation
            env = os.environ.copy()
            env["HOME"] = str(h)
            env["CHEZMOI_SOURCE_DIR"] = str(source)
            cfg = h / ".config/chezmoi/chezmoi.toml"
            cfg.parent.mkdir(parents=True, exist_ok=True)
            cfg.write_text("")
            res = subprocess.run(["chezmoi", "--source", str(source), "--destination", str(h), "--config", str(cfg), "apply"], env=env, capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, f"chezmoi apply failed: {res.stderr}")
        m1_papercuts = home1 / "PAPERCUTS.jsonl"
        m2_papercuts = home2 / "PAPERCUTS.jsonl"
        m1_yearnings = home1 / ".yearn/yearnings.ndjson"
        m2_yearnings = home2 / ".yearn/yearnings.ndjson"
        m1_tenets = home1 / ".tenet/tenets.ndjson"
        m2_tenets = home2 / ".tenet/tenets.ndjson"

        rec_m1_p = {"schema": "springfield.papercut.v3", "id": str(uuid.uuid4()), "message": "M1 Papercut"}
        rec_m2_p = {"schema": "springfield.papercut.v3", "id": str(uuid.uuid4()), "message": "M2 Papercut"}
        rec_m1_y = {"schema": "yearn.v1", "id": str(uuid.uuid4()), "wish": "M1 Wish"}
        rec_m2_y = {"schema": "yearn.v1", "id": str(uuid.uuid4()), "wish": "M2 Wish"}
        rec_m1_t = {"schema": "tenet.v1", "id": str(uuid.uuid4()), "tenet": "M1 Tenet"}
        rec_m2_t = {"schema": "tenet.v1", "id": str(uuid.uuid4()), "tenet": "M2 Tenet"}

        with open(m1_papercuts, "a") as f:
            f.write(json.dumps(rec_m1_p) + "\n")
        with open(m1_yearnings, "a") as f:
            f.write(json.dumps(rec_m1_y) + "\n")
        m1_tenets.parent.mkdir(parents=True, exist_ok=True)
        with open(m1_tenets, "a") as f:
            f.write(json.dumps(rec_m1_t) + "\n")

        with open(m2_papercuts, "a") as f:
            f.write(json.dumps(rec_m2_p) + "\n")
        with open(m2_yearnings, "a") as f:
            f.write(json.dumps(rec_m2_y) + "\n")
        m2_tenets.parent.mkdir(parents=True, exist_ok=True)
        with open(m2_tenets, "a") as f:
            f.write(json.dumps(rec_m2_t) + "\n")

        # Machine 1 syncs and pushes
        env1 = os.environ.copy()
        env1["HOME"] = str(home1)
        env1["CHEZMOI_SOURCE_DIR"] = str(home1 / ".local/share/chezmoi")
        src1 = home1 / ".local/share/chezmoi"
        subprocess.run(["bash", str(src1 / "private_dot_local/bin/executable_chezmoi-assimilate.sh")], env=env1, check=True, capture_output=True)
        subprocess.run(["git", "-C", str(src1), "push"], check=True, capture_output=True)

        # Machine 2: simulate race - append written right before update/apply
        rec_race = {"schema": "springfield.papercut.v3", "id": str(uuid.uuid4()), "message": "Race Papercut"}
        with open(m2_papercuts, "a") as f:
            f.write(json.dumps(rec_race) + "\n")

        # Machine 2 syncs
        env2 = os.environ.copy()
        env2["HOME"] = str(home2)
        env2["CHEZMOI_SOURCE_DIR"] = str(home2 / ".local/share/chezmoi")
        src2 = home2 / ".local/share/chezmoi"
        cfg2 = home2 / ".config/chezmoi/chezmoi.toml"
        cfg1 = home1 / ".config/chezmoi/chezmoi.toml"
        subprocess.run(["bash", str(src2 / "private_dot_local/bin/executable_chezmoi-assimilate.sh")], env=env2, check=True, capture_output=True)
        subprocess.run(["git", "-C", str(src2), "pull", "--rebase"], check=True, capture_output=True)
        subprocess.run(["chezmoi", "--source", str(src2), "--destination", str(home2), "--config", str(cfg2), "apply"], env=env2, check=True, capture_output=True)
        subprocess.run(["bash", str(src2 / "private_dot_local/bin/executable_chezmoi-update-post.sh")], env=env2, check=True, capture_output=True)

        # Machine 1 pulls and applies
        subprocess.run(["git", "-C", str(src1), "pull", "--rebase"], check=True, capture_output=True)
        subprocess.run(["chezmoi", "--source", str(src1), "--destination", str(home1), "--config", str(cfg1), "apply"], env=env1, check=True, capture_output=True)
        subprocess.run(["bash", str(src1 / "private_dot_local/bin/executable_chezmoi-update-post.sh")], env=env1, check=True, capture_output=True)
        m1_p_ids = {json.loads(l)["id"] for l in m1_papercuts.read_text().splitlines() if l.strip()}
        m2_p_ids = {json.loads(l)["id"] for l in m2_papercuts.read_text().splitlines() if l.strip()}
        self.assertEqual(m1_p_ids, m2_p_ids)
        self.assertIn(rec_race["id"], m1_p_ids)

        m1_y_ids = {json.loads(l)["id"] for l in m1_yearnings.read_text().splitlines() if l.strip()}
        m2_y_ids = {json.loads(l)["id"] for l in m2_yearnings.read_text().splitlines() if l.strip()}
        self.assertEqual(m1_y_ids, m2_y_ids)
        self.assertIn(rec_m1_y["id"], m1_y_ids)
        self.assertIn(rec_m2_y["id"], m2_y_ids)

        m1_t_ids = {json.loads(l)["id"] for l in m1_tenets.read_text().splitlines() if l.strip()}
        m2_t_ids = {json.loads(l)["id"] for l in m2_tenets.read_text().splitlines() if l.strip()}
        self.assertEqual(m1_t_ids, m2_t_ids)
        self.assertIn(rec_m1_t["id"], m1_t_ids)
        self.assertIn(rec_m2_t["id"], m2_t_ids)

        y_dir_mode = oct((home1 / ".yearn").stat().st_mode & 0o777)
        self.assertEqual(y_dir_mode, "0o700")
        t_dir_mode = oct((home1 / ".tenet").stat().st_mode & 0o777)
        self.assertEqual(t_dir_mode, "0o700")

    def test_spark_chezmoiignore_rules(self):
        """Verify .chezmoiignore rules for Spark and Darwin."""
        content = (CHEZMOI_SOURCE_DIR / ".chezmoiignore").read_text()
        self.assertIn("PAPERCUTS.jsonl", content)
        self.assertIn(".yearn/yearnings.ndjson", content)
        self.assertIn(".tenet/tenets.ndjson", content)
        self.assertIn("PAPERCUTS.md", content)
        self.assertIn(".gitattributes", content)
        self.assertIn("!run_after_reconcile-logs.sh", content)
if __name__ == "__main__":
    unittest.main()
