#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TEST_ROOT = Path(__file__).resolve().parent
SCRIPT = TEST_ROOT.parent / "scripts" / "smart_home.py"


def load_module():
    spec = importlib.util.spec_from_file_location("smart_home", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["smart_home"] = module
    spec.loader.exec_module(module)
    return module


sh = load_module()


class FakeTransport:
    def __init__(self, responses: list[tuple[int, str]]):
        self.responses = list(responses)
        self.calls: list[dict] = []

    def request(self, method, url, headers, body, timeout):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": json.loads(body.decode()) if body else None,
                "timeout": timeout,
            }
        )
        if not self.responses:
            raise AssertionError(f"no fake response for {method} {url}")
        return self.responses.pop(0)


def kasa_ok(result):
    return (200, json.dumps({"error_code": 0, "result": result}))


def passthrough(payload: dict):
    return kasa_ok({"responseData": json.dumps(payload)})


class TestDecodeKasaAlias(unittest.TestCase):
    def test_decodes_matter_base64_aliases(self):
        self.assertEqual(sh.decode_kasa_alias("U3Bhcmtz"), "Sparks")
        self.assertEqual(sh.decode_kasa_alias("UEM="), "PC")
        self.assertEqual(sh.decode_kasa_alias("NDA5MA=="), "4090")
        self.assertEqual(sh.decode_kasa_alias("TWVkaWEgUmFjaw=="), "Media Rack")
        self.assertEqual(sh.decode_kasa_alias("U1NEcw=="), "SSDs")

    def test_leaves_plain_aliases_alone(self):
        self.assertEqual(sh.decode_kasa_alias("Entertainment"), "Entertainment")
        self.assertEqual(sh.decode_kasa_alias("Mac Studio"), "Mac Studio")
        self.assertEqual(sh.decode_kasa_alias("PC"), "PC")
        self.assertEqual(sh.decode_kasa_alias("4090"), "4090")


class TestNormalizeEmeter(unittest.TestCase):
    def test_milliwatt_fields(self):
        energy = sh.normalize_emeter(
            {
                "emeter": {
                    "get_realtime": {
                        "voltage_mv": 121400,
                        "current_ma": 390,
                        "power_mw": 47200,
                        "total_wh": 1500,
                        "err_code": 0,
                    }
                }
            },
            on=True,
        )
        self.assertAlmostEqual(energy.watts, 47.2)
        self.assertAlmostEqual(energy.volts, 121.4)
        self.assertAlmostEqual(energy.amps, 0.39)
        self.assertAlmostEqual(energy.kwh, 1.5)
        self.assertTrue(energy.on)

    def test_legacy_watt_fields(self):
        energy = sh.normalize_emeter(
            {"power": 12.5, "voltage": 120.0, "current": 0.1, "total": 0.4}
        )
        self.assertAlmostEqual(energy.watts, 12.5)
        self.assertAlmostEqual(energy.kwh, 0.4)


class TestSecretsAndConfig(unittest.TestCase):
    def test_env_beats_op(self):
        value = sh.resolve_secret(
            inline="inline",
            env_name="CUSTOM",
            op_ref="op://x",
            keychain="kc",
            extra_env=("SMART_HOME_KASA_PASSWORD",),
            environ={"SMART_HOME_KASA_PASSWORD": "from-env"},
            run=lambda argv: "from-op",
        )
        self.assertEqual(value, "from-env")

    def test_op_used_when_env_empty(self):
        seen = []

        def run(argv):
            seen.append(argv)
            return "from-op"

        value = sh.resolve_secret(
            inline=None,
            env_name="CUSTOM",
            op_ref="op://vault/item/password",
            keychain=None,
            extra_env=("SMART_HOME_KASA_PASSWORD",),
            environ={},
            run=run,
        )
        self.assertEqual(value, "from-op")
        self.assertEqual(seen, [["op", "read", "op://vault/item/password"]])

    def test_inline_password_requires_chmod_600(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                '[kasa]\nusername = "a@b.c"\npassword = "secret"\n',
                encoding="utf-8",
            )
            path.chmod(0o644)
            with self.assertRaises(sh.ConfigError):
                sh.load_config(path, environ={})
            path.chmod(0o600)
            cfg = sh.load_config(path, environ={})
            self.assertEqual(cfg.kasa_password, "secret")

    def test_device_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                "\n".join(
                    [
                        'default_connector = "kasa"',
                        "[kasa]",
                        'username = "a@b.c"',
                        'password_env = "SMART_HOME_KASA_PASSWORD"',
                        "[[device]]",
                        'alias = "spark0"',
                        "allow_cycle = true",
                        'match = "spark0-psu"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            cfg = sh.load_config(
                path, environ={"SMART_HOME_KASA_PASSWORD": "pw"}
            )
            self.assertEqual(cfg.aliases["spark0"].match, "spark0-psu")
            self.assertTrue(cfg.aliases["spark0"].allow_cycle)

    def test_invalid_toml_is_config_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text("this is = not [ toml\n", encoding="utf-8")
            with self.assertRaises(sh.ConfigError) as ctx:
                sh.load_config(path, environ={})
            self.assertIn("TOML", str(ctx.exception))

    def test_run_capture_timeout_is_auth_error(self):
        def boom(*args, **kwargs):
            raise subprocess.TimeoutExpired(cmd=["op", "read"], timeout=10)

        original = sh.subprocess.run
        sh.subprocess.run = boom
        try:
            with self.assertRaises(sh.AuthError) as ctx:
                sh._run_capture(["op", "read", "op://x"])
        finally:
            sh.subprocess.run = original
        self.assertIn("timed out", str(ctx.exception))


class TestKasaCloud(unittest.TestCase):
    def _config(self, tmp: str) -> "sh.AppConfig":
        cfg = sh.AppConfig(path=Path(tmp) / "unused.toml", state_dir=Path(tmp))
        cfg.kasa_username = "user@example.com"
        cfg.kasa_password = "pw"
        return cfg

    def test_login_list_energy_over_https_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport(
                [
                    kasa_ok({"token": "tok-1"}),
                    kasa_ok(
                        {
                            "deviceList": [
                                {
                                    "deviceId": "dev1",
                                    "alias": "spark0-psu",
                                    "deviceModel": "KP125(US)",
                                    "status": 1,
                                    "appServerUrl": "https://use1-wap.tplinkcloud.com",
                                }
                            ]
                        }
                    ),
                    passthrough({"system": {"get_sysinfo": {"relay_state": 1}}}),
                    passthrough(
                        {
                            "emeter": {
                                "get_realtime": {
                                    "power_mw": 55100,
                                    "voltage_mv": 120100,
                                    "current_ma": 458,
                                    "total_wh": 2200,
                                    "err_code": 0,
                                }
                            }
                        }
                    ),
                    passthrough({"system": {"get_sysinfo": {"relay_state": 1}}}),
                ]
            )
            connector = sh.KasaCloudConnector(self._config(tmp), transport=transport)
            who = connector.whoami()
            self.assertEqual(who["account"], "user@example.com")
            self.assertEqual(who["device_count"], 1)
            device = connector.resolve("spark0-psu")
            reading = connector.energy(device)
            self.assertAlmostEqual(reading.watts, 55.1)
            self.assertAlmostEqual(reading.volts, 120.1)
            self.assertTrue(reading.on)
            for call in transport.calls:
                self.assertTrue(call["url"].startswith("https://"))
                self.assertNotIn("9999", call["url"])
            self.assertEqual(transport.calls[0]["body"]["method"], "login")
            self.assertEqual(transport.calls[1]["body"]["method"], "getDeviceList")

    def test_auth_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport(
                [(200, json.dumps({"error_code": -20600, "msg": "bad"}))]
            )
            connector = sh.KasaCloudConnector(self._config(tmp), transport=transport)
            with self.assertRaises(sh.AuthError):
                connector.login()

    def test_device_offline_not_auth_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport(
                [
                    kasa_ok({"token": "tok"}),
                    (200, json.dumps({"error_code": -20571, "msg": "Device is offline"})),
                ]
            )
            connector = sh.KasaCloudConnector(self._config(tmp), transport=transport)
            connector.login()
            device = sh.Device("kasa", "dev1", "spark0", extras={})
            with self.assertRaises(sh.DeviceOffline) as ctx:
                connector.set_power(device, False)
            self.assertNotIsInstance(ctx.exception, sh.AuthError)

    def test_skips_child_discovery_for_offline_parent(self):
        with tempfile.TemporaryDirectory() as tmp:
            live_sysinfo = {
                "system": {
                    "get_sysinfo": {
                        "alias": "live-strip",
                        "children": [{"id": "00", "alias": "live-outlet", "state": 1}],
                    }
                }
            }
            transport = FakeTransport(
                [
                    kasa_ok({"token": "tok"}),
                    kasa_ok(
                        {
                            "deviceList": [
                                {
                                    "deviceId": "dead",
                                    "alias": "dead-strip",
                                    "deviceModel": "HS300(US)",
                                    "status": 0,
                                },
                                {
                                    "deviceId": "live",
                                    "alias": "live-strip",
                                    "deviceModel": "HS300(US)",
                                    "status": 1,
                                },
                            ]
                        }
                    ),
                    passthrough(live_sysinfo),
                ]
            )
            connector = sh.KasaCloudConnector(self._config(tmp), transport=transport)
            devices = connector.list_devices()
            aliases = [d.alias for d in devices]
            self.assertEqual(aliases, ["dead-strip", "live-strip", "live-outlet"])
            dead = next(d for d in devices if d.alias == "dead-strip")
            self.assertFalse(dead.online)
            self.assertIsNone(dead.parent_id)
            passthrough_ids = [
                call["body"]["params"]["deviceId"]
                for call in transport.calls
                if call["body"] and call["body"].get("method") == "passthrough"
            ]
            self.assertEqual(passthrough_ids, ["live"])

    def test_list_devices_decodes_base64_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport(
                [
                    kasa_ok({"token": "tok"}),
                    kasa_ok(
                        {
                            "deviceList": [
                                {
                                    "deviceId": "kp1",
                                    "alias": "U3Bhcmtz",
                                    "deviceModel": "KP125M(US)",
                                    "status": 0,
                                }
                            ]
                        }
                    ),
                ]
            )
            connector = sh.KasaCloudConnector(self._config(tmp), transport=transport)
            devices = connector.list_devices()
            self.assertEqual(devices[0].alias, "Sparks")
            self.assertEqual(connector.resolve("Sparks").device_id, "kp1")

    def test_strip_child_cycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent_id = "parent"
            child_id = parent_id + "00"
            sysinfo_on = {
                "system": {
                    "get_sysinfo": {
                        "alias": "strip",
                        "children": [{"id": "00", "alias": "spark0", "state": 1}],
                    }
                }
            }
            sysinfo_off = {
                "system": {
                    "get_sysinfo": {
                        "alias": "strip",
                        "children": [{"id": "00", "alias": "spark0", "state": 0}],
                    }
                }
            }
            transport = FakeTransport(
                [
                    kasa_ok({"token": "tok"}),
                    kasa_ok(
                        {
                            "deviceList": [
                                {
                                    "deviceId": parent_id,
                                    "alias": "strip",
                                    "deviceModel": "HS300(US)",
                                    "status": 1,
                                }
                            ]
                        }
                    ),
                    passthrough(sysinfo_on),
                    passthrough(sysinfo_on),
                    passthrough({"system": {"set_relay_state": {"err_code": 0}}}),
                    passthrough({"system": {"set_relay_state": {"err_code": 0}}}),
                    passthrough(sysinfo_on),
                ]
            )
            connector = sh.KasaCloudConnector(self._config(tmp), transport=transport)
            device = connector.resolve("spark0")
            self.assertEqual(device.device_id, child_id)
            self.assertEqual(device.parent_id, parent_id)
            alias = sh.Alias("spark0", "kasa", "spark0", allow_cycle=True)
            slept = []
            result = sh.cycle_device(
                connector,
                device,
                alias=alias,
                confirm="cycle",
                off_seconds=8,
                allow_unmapped=False,
                even_if_off=False,
                sleep=slept.append,
            )
            self.assertEqual(slept, [8])
            self.assertTrue(result["on"])
            relay_calls = [
                call
                for call in transport.calls
                if call["body"]
                and call["body"].get("method") == "passthrough"
                and "set_relay_state" in json.dumps(call["body"])
            ]
            self.assertEqual(len(relay_calls), 2)
            off_req = json.loads(relay_calls[0]["body"]["params"]["requestData"])
            on_req = json.loads(relay_calls[1]["body"]["params"]["requestData"])
            self.assertEqual(off_req["system"]["set_relay_state"]["state"], 0)
            self.assertEqual(on_req["system"]["set_relay_state"]["state"], 1)
            self.assertEqual(off_req["context"]["child_ids"], [child_id])


class TestCycleSafety(unittest.TestCase):
    def test_requires_confirm(self):
        device = sh.Device("kasa", "id", "spark0")
        with self.assertRaises(sh.SafetyError):
            sh.cycle_device(
                connector=None,  # type: ignore[arg-type]
                device=device,
                alias=sh.Alias("spark0", "kasa", "spark0", allow_cycle=True),
                confirm=None,
                off_seconds=1,
                allow_unmapped=False,
                even_if_off=False,
            )

    def test_refuses_unmapped_without_flag(self):
        device = sh.Device("kasa", "id", "spark0")
        with self.assertRaises(sh.SafetyError) as ctx:
            sh.cycle_device(
                connector=None,  # type: ignore[arg-type]
                device=device,
                alias=None,
                confirm="cycle",
                off_seconds=1,
                allow_unmapped=False,
                even_if_off=False,
            )
        self.assertIn("allow-unmapped", str(ctx.exception))

    def test_refuses_when_already_off(self):
        class OffConnector:
            def get_power(self, device):
                return False

        device = sh.Device("kasa", "id", "spark0")
        with self.assertRaises(sh.SafetyError) as ctx:
            sh.cycle_device(
                connector=OffConnector(),  # type: ignore[arg-type]
                device=device,
                alias=sh.Alias("spark0", "kasa", "spark0", allow_cycle=True),
                confirm="cycle",
                off_seconds=1,
                allow_unmapped=False,
                even_if_off=False,
            )
        self.assertIn("already off", str(ctx.exception))

    def test_interrupt_during_off_window_restores_power(self):
        class Rec:
            def __init__(self):
                self.events = []
                self.power = True

            def get_power(self, device):
                return self.power

            def set_power(self, device, on):
                self.events.append(on)
                self.power = on

        def boom(_seconds):
            raise KeyboardInterrupt()

        device = sh.Device("kasa", "id", "spark0")
        rec = Rec()
        with self.assertRaises(KeyboardInterrupt):
            sh.cycle_device(
                connector=rec,  # type: ignore[arg-type]
                device=device,
                alias=sh.Alias("spark0", "kasa", "spark0", allow_cycle=True),
                confirm="cycle",
                off_seconds=8,
                allow_unmapped=False,
                even_if_off=False,
                sleep=boom,
            )
        self.assertEqual(rec.events, [False, True])
        self.assertTrue(rec.power)


class TestHomeAssistant(unittest.TestCase):
    def test_energy_and_toggle(self):
        cfg = sh.AppConfig(path=Path("/tmp/unused.toml"))
        cfg.ha_url = "http://ha.example:8123"
        cfg.ha_token = "token"
        transport = FakeTransport(
            [
                (
                    200,
                    json.dumps(
                        {
                            "entity_id": "switch.spark0",
                            "state": "on",
                            "attributes": {
                                "friendly_name": "spark0",
                                "current_power_w": 88.4,
                                "voltage": 121.0,
                            },
                        }
                    ),
                ),
                (
                    200,
                    json.dumps(
                        {
                            "entity_id": "switch.spark0",
                            "state": "on",
                            "attributes": {
                                "friendly_name": "spark0",
                                "current_power_w": 88.4,
                                "voltage": 121.0,
                            },
                        }
                    ),
                ),
                (
                    200,
                    json.dumps(
                        {
                            "entity_id": "switch.spark0",
                            "state": "on",
                            "attributes": {"current_power_w": 88.4, "voltage": 121.0},
                        }
                    ),
                ),
                (200, "[]"),
                (
                    200,
                    json.dumps({"entity_id": "switch.spark0", "state": "off"}),
                ),
            ]
        )
        connector = sh.HomeAssistantConnector(cfg, transport=transport)
        device = connector.resolve("switch.spark0")
        reading = connector.energy(device)
        self.assertAlmostEqual(reading.watts, 88.4)
        self.assertAlmostEqual(reading.volts, 121.0)
        self.assertTrue(reading.on)
        connector.set_power(device, False)
        self.assertFalse(connector.get_power(device))
        self.assertTrue(any(call["url"].endswith("/api/services/switch/turn_off") for call in transport.calls))


class TestSetup(unittest.TestCase):
    def test_writes_mode_600_and_preserves_devices(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                "\n".join(
                    [
                        'default_connector = "kasa"',
                        "[kasa]",
                        'username = "old@example.com"',
                        'password_env = "SMART_HOME_KASA_PASSWORD"',
                        "[[device]]",
                        'alias = "spark0"',
                        "allow_cycle = true",
                        'match = "spark0-psu"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            sh.write_local_config(
                path, username="new@example.com", password='p"w\\ord'
            )
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            cfg = sh.load_config(path, environ={})
            self.assertEqual(cfg.kasa_username, "new@example.com")
            self.assertEqual(cfg.kasa_password, 'p"w\\ord')
            self.assertEqual(cfg.aliases["spark0"].match, "spark0-psu")
            self.assertTrue(cfg.aliases["spark0"].allow_cycle)
            self.assertNotIn("password_env", path.read_text(encoding="utf-8"))

    def test_creates_fd_with_mode_600(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "config.toml"
            recorded = []
            real_open = sh.os.open

            def wrapped(name, flags, mode=0o777, *args, **kwargs):
                recorded.append((Path(name), flags, mode))
                return real_open(name, flags, mode, *args, **kwargs)

            sh.os.open = wrapped
            try:
                sh.write_local_config(path, username="a@b.c", password="secret")
            finally:
                sh.os.open = real_open
            match = [item for item in recorded if item[0] == path]
            self.assertEqual(len(match), 1)
            _name, flags, mode = match[0]
            self.assertTrue(flags & os.O_WRONLY)
            self.assertTrue(flags & os.O_CREAT)
            self.assertTrue(flags & os.O_TRUNC)
            self.assertEqual(mode, 0o600)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_preserves_homeassistant_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                "\n".join(
                    [
                        'default_connector = "homeassistant"',
                        "[kasa]",
                        'username = "old@example.com"',
                        'password_env = "SMART_HOME_KASA_PASSWORD"',
                        "[homeassistant]",
                        'url = "http://ha.example:8123"',
                        'token_env = "SMART_HOME_HA_TOKEN"',
                        "[[device]]",
                        'alias = "spark0"',
                        'connector = "homeassistant"',
                        "allow_cycle = true",
                        'match = "switch.spark0"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            sh.write_local_config(
                path, username="new@example.com", password="secret"
            )
            text = path.read_text(encoding="utf-8")
            self.assertIn("[homeassistant]", text)
            self.assertIn('url = "http://ha.example:8123"', text)
            self.assertIn('token_env = "SMART_HOME_HA_TOKEN"', text)
            self.assertIn('default_connector = "homeassistant"', text)
            cfg = sh.load_config(path, environ={"SMART_HOME_HA_TOKEN": "tok"})
            self.assertEqual(cfg.ha_url, "http://ha.example:8123")
            self.assertEqual(cfg.ha_token, "tok")
            self.assertEqual(cfg.kasa_username, "new@example.com")
            self.assertEqual(cfg.aliases["spark0"].connector, "homeassistant")

    def test_setup_cli_reads_stdin(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "config.toml"
            old_stdin = sys.stdin
            try:
                sys.stdin = __import__("io").StringIO("secret-from-stdin\n")
                code = sh.main(
                    [
                        "--config",
                        str(path),
                        "--json",
                        "setup",
                        "--username",
                        "kasa@example.com",
                        "--password-stdin",
                    ]
                )
            finally:
                sys.stdin = old_stdin
            self.assertEqual(code, 0)
            cfg = sh.load_config(path, environ={})
            self.assertEqual(cfg.kasa_password, "secret-from-stdin")
            self.assertEqual(
                [a.name for a in cfg.aliases.values()],
                ["spark0", "spark1", "emo-win", "emo-4090", "mac-studio"],
            )
            self.assertEqual(cfg.aliases["spark0"].match, "Sparks")
            self.assertEqual(cfg.aliases["spark1"].match, "Sparks")
            self.assertEqual(cfg.aliases["emo-win"].match, "PC")
            self.assertEqual(cfg.aliases["emo-4090"].match, "4090")
            self.assertFalse(cfg.aliases["mac-studio"].allow_cycle)

    def test_setup_password_stdin_reads_one_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            old_stdin = sys.stdin
            try:
                sys.stdin = __import__("io").StringIO(
                    "one-line-secret\nshould-not-be-included"
                )
                code = sh.main(
                    [
                        "--config",
                        str(path),
                        "--json",
                        "setup",
                        "--username",
                        "kasa@example.com",
                        "--password-stdin",
                    ]
                )
            finally:
                sys.stdin = old_stdin
            self.assertEqual(code, 0)
            cfg = sh.load_config(path, environ={})
            self.assertEqual(cfg.kasa_password, "one-line-secret")


class TestCliSafety(unittest.TestCase):
    def test_whoami_without_creds_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.toml"
            code = sh.main(["--config", str(cfg), "--json", "whoami"])
            self.assertEqual(code, 2)

    def test_cycle_without_confirm_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.toml"
            cfg.write_text(
                '[kasa]\nusername = "a@b.c"\npassword_env = "SMART_HOME_KASA_PASSWORD"\n',
                encoding="utf-8",
            )
            code = sh.main(
                ["--config", str(cfg), "cycle", "spark0"]
            )
            self.assertEqual(code, 2)

    def test_off_mapped_without_confirm_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.toml"
            cfg.write_text(
                "\n".join(
                    [
                        "[kasa]",
                        'username = "a@b.c"',
                        'password = "pw"',
                        "[[device]]",
                        'alias = "spark0"',
                        "allow_cycle = true",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            cfg.chmod(0o600)
            code = sh.main(["--config", str(cfg), "off", "spark0"])
            self.assertEqual(code, 2)

    def test_off_allow_cycle_false_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.toml"
            cfg.write_text(
                "\n".join(
                    [
                        "[kasa]",
                        'username = "a@b.c"',
                        'password = "pw"',
                        "[[device]]",
                        'alias = "spark0"',
                        "allow_cycle = false",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            cfg.chmod(0o600)
            code = sh.main(
                ["--config", str(cfg), "off", "spark0", "--confirm", "cycle"]
            )
            self.assertEqual(code, 2)


class TestWhoamiAggregation(unittest.TestCase):
    def test_skips_non_auth_connector_errors(self):
        cfg = sh.AppConfig(path=Path("/tmp/unused.toml"))
        original = sh.build_connector

        def fake(name, config, transport=None):
            class Conn:
                def whoami(self):
                    if name == "kasa":
                        return {"connector": "kasa", "account": "a@b.c"}
                    raise sh.SmartHomeError("HTTP request failed: timed out")

            return Conn()

        sh.build_connector = fake
        try:
            reports, errors = sh.collect_whoami(cfg)
        finally:
            sh.build_connector = original
        self.assertEqual(reports, [{"connector": "kasa", "account": "a@b.c"}])
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["connector"], "homeassistant")
        self.assertIn("timed out", errors[0]["error"])


class TestStatusIsolation(unittest.TestCase):
    def test_offline_alias_does_not_abort_fleet(self):
        cfg = sh.AppConfig(path=Path("/tmp/unused.toml"))
        cfg.aliases = {
            "dead": sh.Alias("dead", "kasa", "dead", allow_cycle=True),
            "live": sh.Alias("live", "kasa", "live", allow_cycle=True),
        }
        original = sh.resolve_target

        def fake(config, needle, transport=None):
            if needle == "dead":
                raise sh.DeviceOffline("Kasa device offline (error_code -20571)")
            device = sh.Device("kasa", "live1", "live", online=True)

            class Conn:
                def energy(self, device, alias=None):
                    return sh.Energy(
                        watts=10.0, volts=120.0, amps=0.08, kwh=0.001, on=True
                    )

            return Conn(), device, config.aliases.get(needle.lower())

        sh.resolve_target = fake
        try:
            rows = sh.status_rows_for_targets(cfg, ["dead", "live"])
        finally:
            sh.resolve_target = original
        self.assertEqual(rows[0]["alias"], "dead")
        self.assertIn("error", rows[0])
        self.assertIn("offline", rows[0]["error"].lower())
        self.assertEqual(rows[1]["alias"], "live")
        self.assertNotIn("error", rows[1])
        self.assertAlmostEqual(rows[1]["watts"], 10.0)
        self.assertTrue(rows[1]["on"])



if __name__ == "__main__":
    unittest.main()
