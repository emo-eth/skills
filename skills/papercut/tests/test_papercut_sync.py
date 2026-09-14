#!/usr/bin/env python3
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid

class TestPapercutSync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = Path(__file__).resolve().parent.parent.parent.parent
        cls.papercut_sh = cls.repo_root / "skills/papercut/scripts/papercut.sh"
        cls.migrate_py = cls.repo_root / "skills/papercut/scripts/migrate_papercuts.py"
        cls.reconcile_py = Path("/Users/jameswenzel/.local/share/chezmoi/private_dot_local/bin/executable_chezmoi-reconcile-logs.py")
        assert cls.papercut_sh.exists(), f"Missing {cls.papercut_sh}"
        assert cls.migrate_py.exists(), f"Missing {cls.migrate_py}"

    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="papercut-test-"))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_cli_flags_and_jsonl_output(self):
        out_jsonl = self.tmp_dir / "papercuts.jsonl"
        cmd = [
            "bash", str(self.papercut_sh),
            "--path", str(out_jsonl),
            "-m", "test-agent",
            "--file", "src/index.ts",
            "first friction note"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        self.assertIn(f"logged: {out_jsonl}", res.stdout)
        self.assertTrue(out_jsonl.exists())

        lines = [l for l in out_jsonl.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(lines), 1)
        record = json.loads(lines[0])
        self.assertEqual(record["schema"], "springfield.papercut.v3")
        self.assertEqual(record["agent"], "test-agent")
        self.assertEqual(record["message"], "first friction note")
        self.assertEqual(record["files"], ["src/index.ts"])
        self.assertIn("id", record)
        uuid.UUID(record["id"])

        dry_res = subprocess.run(
            ["bash", str(self.papercut_sh), "--path", str(out_jsonl), "--dry-run", "--json", "-m", "agent", "dry message"],
            capture_output=True, text=True, check=True
        )
        receipt = json.loads(dry_res.stdout)
        self.assertEqual(receipt["written"], False)
        self.assertEqual(receipt["schema"], "springfield.papercut.v3")
        lines_after_dry = [l for l in out_jsonl.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(lines_after_dry), 1)

    def test_cli_refusal_on_markdown_path(self):
        md_path = self.tmp_dir / "legacy.md"
        res = subprocess.run(
            ["bash", str(self.papercut_sh), "--path", str(md_path), "-m", "agent", "note"],
            capture_output=True, text=True
        )
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("output path ends in .md", res.stderr)

    def test_migration_lossless_and_deterministic(self):
        sample_md = self.tmp_dir / "sample.md"
        sample_md.write_text(
            "# Papercuts\n\n"
            "Small frictions agents hit while working in this repository. These are not full bug reports; they are sandpaper notes for later cleanup.\n\n"
            "## Entries\n\n"
            "- **2026-09-10T12:00:00Z** `agent1`\n"
            "  - repo: `myrepo` root: `/path/to/repo`\n"
            "  - worktree: `/path/to/repo`\n"
            "  - branch: `main` @ `abcdef1`\n"
            "  - cwd: `src`\n"
            "  - files: `file1.ts`, `file2.ts`\n"
            "  - note: first friction note\n"
            "- **2026-09-11T13:00:00Z** `agent2`\n"
            "  - cwd: `.`\n"
            "  - note: second note with\n"
            "    continuation line\n"
        )
        out1 = self.tmp_dir / "out1.jsonl"
        out2 = self.tmp_dir / "out2.jsonl"

        subprocess.run(["python3", str(self.migrate_py), str(sample_md), "--output", str(out1)], check=True)
        subprocess.run(["python3", str(self.migrate_py), str(sample_md), "--output", str(out2)], check=True)

        lines1 = out1.read_text(encoding="utf-8").splitlines()
        lines2 = out2.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines1, lines2)
        self.assertEqual(len(lines1), 2)

        r1 = json.loads(lines1[0])
        r2 = json.loads(lines1[1])
        self.assertEqual(r1["schema"], "springfield.papercut.v3")
        self.assertEqual(r2["schema"], "springfield.papercut.v3")
        self.assertEqual(r2["message"], "second note with\ncontinuation line")

        res_idemp = subprocess.run(["python3", str(self.migrate_py), str(sample_md), "--output", str(out1)], capture_output=True, text=True, check=True)
        self.assertIn("Migrated 0 new records", res_idemp.stdout)
        lines1_after = out1.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines1, lines1_after)

    def test_e2e_chezmoi_offline_sync_and_race_preservation(self):
        remote_git = self.tmp_dir / "remote.git"
        subprocess.run(["git", "init", "--bare", "-b", "main", str(remote_git)], check=True)

        seed_dir = self.tmp_dir / "seed"
        subprocess.run(["git", "init", "-b", "main", str(seed_dir)], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "config", "user.name", "Seed"], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "config", "user.email", "seed@example.com"], check=True)

        chezmoi_src = Path("/Users/jameswenzel/.local/share/chezmoi")

        # Copy essential chezmoi source templates and scripts
        shutil.copy2(chezmoi_src / ".chezmoiignore", seed_dir / ".chezmoiignore")
        shutil.copy2(chezmoi_src / ".gitattributes", seed_dir / ".gitattributes")
        shutil.copy2(chezmoi_src / "run_after_reconcile-logs.sh", seed_dir / "run_after_reconcile-logs.sh")
        (seed_dir / "run_after_reconcile-logs.sh").chmod(0o755)

        bin_dir = seed_dir / "private_dot_local/bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(chezmoi_src / "private_dot_local/bin/executable_chezmoi-assimilate.sh", bin_dir / "executable_chezmoi-assimilate.sh")
        shutil.copy2(chezmoi_src / "private_dot_local/bin/executable_chezmoi-update-post.sh", bin_dir / "executable_chezmoi-update-post.sh")
        shutil.copy2(chezmoi_src / "private_dot_local/bin/executable_chezmoi-reconcile-logs.py", bin_dir / "executable_chezmoi-reconcile-logs.py")
        (bin_dir / "executable_chezmoi-assimilate.sh").chmod(0o755)
        (bin_dir / "executable_chezmoi-update-post.sh").chmod(0o755)
        (bin_dir / "executable_chezmoi-reconcile-logs.py").chmod(0o755)

        # Initial logs in seed
        (seed_dir / "PAPERCUTS.jsonl").write_text(
            json.dumps({"schema": "springfield.papercut.v3", "id": "00000000-0000-0000-0000-000000000001", "timestamp": "2026-09-01T00:00:00Z", "agent": "init", "message": "initial papercut"}) + "\n"
        )
        dot_yearn = seed_dir / "dot_yearn"
        dot_yearn.mkdir(parents=True, exist_ok=True)
        (dot_yearn / "yearnings.ndjson").write_text(
            json.dumps({"schema": "yearn.v1", "id": "00000000-0000-0000-0000-000000000002", "recordedAt": "2026-09-01T00:00:00Z", "wish": "initial yearning"}) + "\n"
        )

        # Minimal chezmoi config template for hooks
        (seed_dir / ".chezmoi.toml.tmpl").write_text(
            '[hooks.apply.pre]\n'
            'command = "sh"\n'
            'args = ["-c", "! [ -x \\"$HOME/.local/bin/chezmoi-assimilate.sh\\" ] || \\"$HOME/.local/bin/chezmoi-assimilate.sh\\""]\n'
            '[hooks.update.pre]\n'
            'command = "sh"\n'
            'args = ["-c", "! [ -x \\"$HOME/.local/bin/chezmoi-assimilate.sh\\" ] || \\"$HOME/.local/bin/chezmoi-assimilate.sh\\""]\n'
            '[hooks.update.post]\n'
            'command = "sh"\n'
            'args = ["-c", "! [ -x \\"$HOME/.local/bin/chezmoi-update-post.sh\\" ] || \\"$HOME/.local/bin/chezmoi-update-post.sh\\""]\n'
        )

        subprocess.run(["git", "-C", str(seed_dir), "add", "."], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "commit", "-m", "init"], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "remote", "add", "origin", str(remote_git)], check=True)
        subprocess.run(["git", "-C", str(seed_dir), "push", "-u", "origin", "main"], check=True)

        home1 = self.tmp_dir / "home1"
        home2 = self.tmp_dir / "home2"
        home1.mkdir(parents=True, exist_ok=True)
        home2.mkdir(parents=True, exist_ok=True)

        env1 = os.environ.copy()
        env1["HOME"] = str(home1)
        env1["CHEZMOI_SOURCE_DIR"] = str(home1 / ".local/share/chezmoi")

        env2 = os.environ.copy()
        env2["HOME"] = str(home2)
        env2["CHEZMOI_SOURCE_DIR"] = str(home2 / ".local/share/chezmoi")

        # 1. Fresh-machine bootstrap on Machine 1:
        subprocess.run(["chezmoi", "init", "--apply", str(remote_git)], env=env1, check=True)
        self.assertTrue((home1 / "PAPERCUTS.jsonl").exists())
        self.assertTrue((home1 / ".yearn/yearnings.ndjson").exists())
        self.assertEqual(len((home1 / "PAPERCUTS.jsonl").read_text().splitlines()), 1)

        # 2. Fresh-machine bootstrap on Machine 2:
        subprocess.run(["chezmoi", "init", "--apply", str(remote_git)], env=env2, check=True)
        self.assertTrue((home2 / "PAPERCUTS.jsonl").exists())
        self.assertTrue((home2 / ".yearn/yearnings.ndjson").exists())
        self.assertEqual(len((home2 / "PAPERCUTS.jsonl").read_text().splitlines()), 1)

        # Configure git identity in clones
        for h in (home1, home2):
            s = h / ".local/share/chezmoi"
            subprocess.run(["git", "-C", str(s), "config", "user.name", f"User-{h.name}"], check=True)
            subprocess.run(["git", "-C", str(s), "config", "user.email", f"{h.name}@example.com"], check=True)

        # 3. Offline capture on Machine 1:
        subprocess.run(["bash", str(self.papercut_sh), "-m", "agent-m1", "note from machine 1"], env=env1, check=True)
        with open(home1 / ".yearn/yearnings.ndjson", "a", encoding="utf-8") as yf:
            yf.write(json.dumps({"schema": "yearn.v1", "id": "11111111-1111-1111-1111-111111111111", "wish": "yearn 1"}) + "\n")

        # 4. Offline capture on Machine 2:
        subprocess.run(["bash", str(self.papercut_sh), "-m", "agent-m2", "note from machine 2"], env=env2, check=True)
        with open(home2 / ".yearn/yearnings.ndjson", "a", encoding="utf-8") as yf:
            yf.write(json.dumps({"schema": "yearn.v1", "id": "22222222-2222-2222-2222-222222222222", "wish": "yearn 2"}) + "\n")

        # 5. Machine 1 updates and pushes:
        subprocess.run(["chezmoi", "update"], env=env1, check=True)

        # 6. Machine 2 updates and pushes (exercising union rebase and post-rebase apply):
        subprocess.run(["chezmoi", "update"], env=env2, check=True)

        # 7. Machine 1 updates to pull Machine 2's additions:
        subprocess.run(["chezmoi", "update"], env=env1, check=True)

        # 8. Check UUID set equality across Machine 1, Machine 2, and remote:
        m1_papercuts = [json.loads(l)["id"] for l in (home1 / "PAPERCUTS.jsonl").read_text().splitlines() if l.strip()]
        m2_papercuts = [json.loads(l)["id"] for l in (home2 / "PAPERCUTS.jsonl").read_text().splitlines() if l.strip()]
        self.assertEqual(sorted(m1_papercuts), sorted(m2_papercuts))
        self.assertEqual(len(m1_papercuts), 3) # 1 initial + 2 new

        m1_yearnings = [json.loads(l)["id"] for l in (home1 / ".yearn/yearnings.ndjson").read_text().splitlines() if l.strip()]
        m2_yearnings = [json.loads(l)["id"] for l in (home2 / ".yearn/yearnings.ndjson").read_text().splitlines() if l.strip()]
        self.assertEqual(sorted(m1_yearnings), sorted(m2_yearnings))
        self.assertEqual(len(m1_yearnings), 3)

        # 9. Repeated update (idempotence, no duplicate entries):
        subprocess.run(["chezmoi", "update"], env=env1, check=True)
        subprocess.run(["chezmoi", "update"], env=env2, check=True)
        m1_papercuts_repeat = [json.loads(l)["id"] for l in (home1 / "PAPERCUTS.jsonl").read_text().splitlines() if l.strip()]
        self.assertEqual(len(m1_papercuts_repeat), 3)

        # 10. Mid-sync write preservation (the race condition edge!):
        # We assimilate on Machine 1:
        subprocess.run(["bash", str(home1 / ".local/bin/chezmoi-assimilate.sh")], env=env1, check=True)
        # NOW, before chezmoi apply runs, simulate a concurrent capture:
        concurrent_id = "33333333-3333-3333-3333-333333333333"
        with open(home1 / "PAPERCUTS.jsonl", "a", encoding="utf-8") as pf:
            pf.write(json.dumps({"schema": "springfield.papercut.v3", "id": concurrent_id, "agent": "racer", "message": "racing write during sync"}) + "\n")

        # Now run chezmoi apply (which would overwrite destination in naive setups):
        subprocess.run(["chezmoi", "apply"], env=env1, check=True)

        # Verify that the concurrent write was NOT overwritten or wiped out:
        post_apply_ids = [json.loads(l)["id"] for l in (home1 / "PAPERCUTS.jsonl").read_text().splitlines() if l.strip()]
        self.assertIn(concurrent_id, post_apply_ids, "Concurrent write was wiped out by apply!")

        # Complete update to push:
        subprocess.run(["chezmoi", "update"], env=env1, check=True)

        # Machine 2 updates and receives the racing entry:
        subprocess.run(["chezmoi", "update"], env=env2, check=True)
        m2_final_ids = [json.loads(l)["id"] for l in (home2 / "PAPERCUTS.jsonl").read_text().splitlines() if l.strip()]
        self.assertIn(concurrent_id, m2_final_ids)

        print("All chezmoi e2e scenarios passed successfully!")

if __name__ == "__main__":
    unittest.main()
