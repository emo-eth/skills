#!/usr/bin/env python3
import io
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import Mock, patch

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


class TestUrlLibTransport(unittest.TestCase):
    def test_tplink_requests_use_default_verification_plus_vendor_ca(self):
        transport = sh.UrlLibTransport()
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.status = 200
        response.read.return_value = b"{}"
        with patch.object(sh.ssl, "create_default_context", return_value=Mock()) as context_factory, patch.object(
            sh.urllib.request, "urlopen", return_value=response
        ) as urlopen:
            self.assertEqual(transport.request("GET", "https://api.tplinkcloud.com/x", {}, None, 5), (200, "{}"))
        context_factory.assert_called_once_with()
        context_factory.return_value.load_verify_locations.assert_called_once()
        ca_path = context_factory.return_value.load_verify_locations.call_args.kwargs["cafile"]
        self.assertTrue(Path(ca_path).is_file())
        self.assertTrue(urlopen.call_args.kwargs["context"] is context_factory.return_value)

    def test_non_tplink_requests_keep_system_verification(self):
        transport = sh.UrlLibTransport()
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.status = 200
        response.read.return_value = b"{}"
        with patch.object(sh.ssl, "create_default_context", return_value=Mock()) as context_factory, patch.object(
            sh.urllib.request, "urlopen", return_value=response
        ):
            transport.request("GET", "https://example.com/x", {}, None, 5)
        context_factory.assert_called_once_with()
        context_factory.return_value.load_verify_locations.assert_not_called()


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


class TestKasaAppServer(unittest.TestCase):
    def _connector(self, tmp, responses):
        config = sh.AppConfig(path=Path(tmp) / "config.toml", state_dir=Path(tmp))
        transport = FakeTransport([(200, json.dumps(row)) for row in responses])
        connector = sh.KasaCloudConnector(config, transport=transport)
        connector._app_login = lambda: {"app_host": "https://app.test", "token": "test-token"}
        return connector, transport

    def test_inventory_parses_top_level_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            connector, transport = self._connector(tmp, [{"data": [
                {"thingName": "plug-device", "alias": "Plug", "status": 1}
            ]}])
            rows = connector._app_inventory()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["alias"], "Plug")
            self.assertEqual(transport.calls[0]["method"], "GET")
            self.assertIn("/v2/things?", transport.calls[0]["url"])

    def test_shadow_reported_bool_and_unknown_fallback(self):
        device = sh.Device("kasa", "plug-device", "Plug", model="KP125M",
                           extras={"deviceType": "SMART.KASAPLUG"})
        for reported, expected in ((True, True), (False, False)):
            with self.subTest(reported=reported), tempfile.TemporaryDirectory() as tmp:
                response = {"shadows": [{"thingName": device.device_id, "version": 1,
                                      "state": {"reported": {"on": reported}}}]}
                connector, transport = self._connector(tmp, [response])
                connector._app_inventory = lambda: [{"thingName": device.device_id,
                                                     "status": 1}]
                self.assertIs(connector.get_power(device), expected)
                self.assertEqual(transport.calls[0]["method"], "GET")
                self.assertIn("/shadows?", transport.calls[0]["url"])

        with tempfile.TemporaryDirectory() as tmp:
            unknown = {"shadows": [{"thingName": device.device_id, "version": 1,
                                 "state": {"reported": {"on": "false"}}}]}
            response = {"shadows": [{"thingName": device.device_id, "version": 1,
                                  "state": {"reported": {"on": False}}}]}
            connector, transport = self._connector(tmp, [unknown, response])
            connector._app_inventory = lambda: [{"thingName": device.device_id,
                                                 "status": 1}]
            self.assertIs(connector.get_power(device), False)
            self.assertEqual(len(transport.calls), 2)
            self.assertIn("/matter/shadows?", transport.calls[0]["url"])
            self.assertIn("/things/shadows?", transport.calls[1]["url"])

        with tempfile.TemporaryDirectory() as tmp:
            connector, transport = self._connector(tmp, [unknown, {"shadows": []}])
            connector._app_inventory = lambda: [{"thingName": device.device_id,
                                                 "status": 1}]
            with self.assertRaises(sh.SmartHomeError):
                connector.get_power(device)
            self.assertEqual(len(transport.calls), 2)

    def test_desired_write_readback_mismatch_is_error(self):
        device = sh.Device("kasa", "plug-device", "Plug", model="KP125M",
                           extras={"deviceType": "SMART.KASAPLUG"})
        shadow = {"shadows": [{"thingName": device.device_id, "version": 7,
                            "state": {"reported": {"on": False}}}]}
        with tempfile.TemporaryDirectory() as tmp:
            connector, transport = self._connector(tmp, [shadow, {}, shadow])
            connector._app_inventory = lambda: [{"thingName": device.device_id,
                                                 "status": 1}]
            with self.assertRaises(sh.SmartHomeError):
                connector.set_power(device, True)
            calls = transport.calls
            self.assertEqual([call["method"] for call in calls], ["GET", "PATCH", "GET"])
            self.assertEqual(calls[1]["body"]["state"]["desired"], {"on": True})
            self.assertEqual(calls[1]["body"]["version"], 8)

    def test_cli_mac_studio_off_and_cycle_are_denied(self):
        device = sh.Device("kasa", "studio-device", "Mac Studio")
        alias = sh.Alias("studio", "kasa", "Mac Studio", allow_cycle=True)
        connector = Mock()
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.toml"
            cfg.write_text(
                '[[device]]\nalias = "studio"\nmatch = "Mac Studio"\n'
                'allow_cycle = true\n', encoding="utf-8"
            )
            for action in ("off", "cycle"):
                with self.subTest(action=action), patch.object(
                    sh, "resolve_target", return_value=(connector, device, alias)
                ):
                    code = sh.main(
                        ["--config", str(cfg), action, "studio", "--confirm", "cycle"]
                    )
                    self.assertEqual(code, 2)
                    connector.set_power.assert_not_called()

    def test_cli_confirmation_and_allow_cycle_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.toml"
            cfg.write_text(
                '[[device]]\nalias = "plug"\nmatch = "Plug"\n'
                'allow_cycle = false\n', encoding="utf-8"
            )
            device = sh.Device("kasa", "plug-device", "Plug")
            connector = Mock()
            for action, confirmation, allowed in (
                ("off", [], True), ("cycle", [], True),
                ("off", ["--confirm", "cycle"], False),
                ("cycle", ["--confirm", "cycle"], False),
            ):
                alias = sh.Alias("plug", "kasa", "Plug", allow_cycle=allowed)
                with self.subTest(action=action, confirmation=confirmation), patch.object(
                    sh, "load_config", return_value=sh.AppConfig(
                        path=cfg, aliases={"plug": alias}
                    )
                ), patch.object(
                    sh, "resolve_target", return_value=(connector, device, alias)
                ):
                    code = sh.main(["--config", str(cfg), action, "plug", *confirmation])
                    self.assertEqual(code, 2)
                    connector.set_power.assert_not_called()


class KasaCloudRouter:
    """Fake TP-Link legacy cloud + app-server. Counts logins; rejects listed tokens."""

    def __init__(self):
        self.calls: list[dict] = []
        self.rejected: set[str] = set()
        self.logins = 0
        self.app_logins = 0
        self.login_terms: list[str] = []

    def request(self, method, url, headers, body, timeout):
        payload = json.loads(body.decode()) if body else None
        self.calls.append({"method": method, "url": url, "headers": headers, "body": payload})
        parsed = sh.urllib.parse.urlparse(url)
        query = sh.urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/v2/account/getAccountStatusAndUrl":
            return kasa_ok({"appServerUrl": "https://region.test"})
        if parsed.path == "/api/v2/account/login":
            self.app_logins += 1
            self.login_terms.append(payload["terminalUUID"])
            return kasa_ok({"token": f"app-{self.app_logins}",
                            "refreshToken": f"refresh-{self.app_logins}"})
        if parsed.path == "/api/v2/common/getAppServiceUrl":
            return kasa_ok({"serviceUrls": {sh.APP_SERVER_SERVICE_ID: "https://app.test"}})
        if parsed.hostname == "app.test":
            token = headers["Authorization"].removeprefix("ut|")
            if token in self.rejected:
                return (401, "")
            if parsed.path == "/v2/things":
                return (200, json.dumps({"data": [{"thingName": "kp1", "status": 1}]}))
            return (200, json.dumps({"shadows": [{"thingName": "kp1", "version": 3,
                                                  "state": {"reported": {"on": True}}}]}))
        if payload and payload.get("method") == "login":
            self.logins += 1
            self.login_terms.append(payload["params"]["terminalUUID"])
            return kasa_ok({"token": f"cloud-{self.logins}"})
        if query.get("token", [None])[0] in self.rejected:
            return (200, json.dumps({"error_code": -20651, "msg": "Token expired"}))
        return kasa_ok({"deviceList": [{"deviceId": "kp1", "alias": "Plug",
                                        "deviceModel": "KP125M(US)", "status": 0}]})


class TestKasaSessionCache(unittest.TestCase):
    def _connector(self, tmp, router):
        cfg = sh.AppConfig(path=Path(tmp) / "config.toml", state_dir=Path(tmp))
        cfg.kasa_username = "user@example.com"
        cfg.kasa_password = "pw"
        cfg.aliases = {"plug": sh.Alias("plug", "kasa", "Plug")}
        return sh.KasaCloudConnector(cfg, transport=router)

    def _status(self, connector):
        devices = connector.list_devices()
        return [connector.energy(device).on for device in devices]

    def _cache(self, tmp):
        return json.loads((Path(tmp) / "kasa-session-cache.json").read_text())

    def test_terminal_uuid_is_persisted_and_reused_for_app_login(self):
        with tempfile.TemporaryDirectory() as tmp:
            router = KasaCloudRouter()
            first = self._connector(tmp, router)
            term_file = Path(tmp) / "kasa-terminal-uuid"
            self.assertEqual(term_file.stat().st_mode & 0o777, 0o600)
            first._app_login()
            second = self._connector(tmp, router)
            second._app_login()
            self.assertEqual(first._terminal, second._terminal)
            self.assertEqual(router.login_terms, [first._terminal, first._terminal])
            self.assertEqual(term_file.read_text().strip(), first._terminal)

    def test_second_process_reuses_both_cached_sessions_with_zero_logins(self):
        with tempfile.TemporaryDirectory() as tmp:
            router = KasaCloudRouter()
            self.assertEqual(self._status(self._connector(tmp, router)), [True])
            self.assertEqual((router.logins, router.app_logins), (1, 1))
            path = Path(tmp) / "kasa-session-cache.json"
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            [entry] = self._cache(tmp).values()
            self.assertEqual(entry["cloud"]["token"], "cloud-1")
            self.assertEqual(entry["app"]["token"], "app-1")
            self.assertEqual(entry["app"]["refresh_token"], "refresh-1")
            self.assertEqual(entry["app"]["app_host"], "https://app.test")
            self.assertEqual(entry["app"]["regional_url"], "https://region.test")
            self.assertNotIn("pw", path.read_text())

            router.calls.clear()
            self.assertEqual(self._status(self._connector(tmp, router)), [True])
            self.assertEqual((router.logins, router.app_logins), (1, 1))
            paths = [sh.urllib.parse.urlparse(call["url"]).path for call in router.calls]
            self.assertNotIn("/api/v2/account/login", paths)
            self.assertFalse(any(
                call["body"] and call["body"].get("method") == "login" for call in router.calls
            ))

    def test_rejected_cached_tokens_relogin_once_and_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            router = KasaCloudRouter()
            self._status(self._connector(tmp, router))
            term = router.login_terms[0]
            router.rejected = {"cloud-1", "app-1"}
            self.assertEqual(self._status(self._connector(tmp, router)), [True])
            self.assertEqual((router.logins, router.app_logins), (2, 2))
            self.assertEqual(set(router.login_terms), {term})
            [entry] = self._cache(tmp).values()
            self.assertEqual(entry["cloud"]["token"], "cloud-2")
            self.assertEqual(entry["app"]["token"], "app-2")

    def test_retry_after_relogin_failure_does_not_loop(self):
        with tempfile.TemporaryDirectory() as tmp:
            router = KasaCloudRouter()
            self._status(self._connector(tmp, router))
            router.rejected = {"cloud-1", "cloud-2"}
            with self.assertRaises(sh.AuthError):
                self._connector(tmp, router).list_devices()
            self.assertEqual(router.logins, 2)

    def test_corrupt_cache_recovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "kasa-session-cache.json").write_text("{not json")
            router = KasaCloudRouter()
            self.assertEqual(self._status(self._connector(tmp, router)), [True])
            self.assertEqual((router.logins, router.app_logins), (1, 1))
            [entry] = self._cache(tmp).values()
            self.assertEqual(entry["cloud"]["token"], "cloud-1")

    def test_cache_is_keyed_by_account(self):
        with tempfile.TemporaryDirectory() as tmp:
            router = KasaCloudRouter()
            self._connector(tmp, router).list_devices()
            other = self._connector(tmp, router)
            other.config.kasa_username = "other@example.com"
            other.list_devices()
            self.assertEqual(router.logins, 2)
            self.assertEqual(len(self._cache(tmp)), 2)


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

    class _OffFails:
        """Off raises after the relay is (maybe) cut; on behaviour configurable."""

        def __init__(self, on_raises=False, readback=True):
            self.events = []
            self.on_raises = on_raises
            self.readback = readback
            self.reads = 0

        def get_power(self, device):
            self.reads += 1
            return True if self.reads == 1 else self.readback

        def set_power(self, device, on):
            self.events.append(on)
            if not on:
                raise TimeoutError("read timed out")
            if self.on_raises:
                raise sh.SmartHomeError("on rejected")

    def _cycle(self, connector, alias=None, confirm="cycle", slept=None):
        return sh.cycle_device(
            connector=connector,  # type: ignore[arg-type]
            device=sh.Device("kasa", "dev-1234", "spark0"),
            alias=alias or sh.Alias("spark0", "kasa", "spark0", allow_cycle=True),
            confirm=confirm,
            off_seconds=8,
            allow_unmapped=False,
            even_if_off=False,
            sleep=(slept.append if slept is not None else lambda _s: None),
        )

    def test_off_error_attempts_recovery_on_success(self):
        conn = self._OffFails()
        slept = []
        with self.assertRaises(sh.CycleFailed) as ctx:
            self._cycle(conn, slept=slept)
        self.assertEqual(conn.events, [False, True])
        self.assertEqual(slept, [sh.CYCLE_RECOVERY_DELAY_SECONDS])
        payload = ctx.exception.payload
        self.assertFalse(payload["ok"])
        self.assertIn("timed out", payload["off_error"])
        self.assertEqual(payload["recovery"], {"attempted": True, "on": True})
        self.assertIn("recovery on succeeded", str(ctx.exception))

    def test_off_error_recovery_on_also_fails(self):
        conn = self._OffFails(on_raises=True, readback=False)
        with self.assertRaises(sh.CycleFailed) as ctx:
            self._cycle(conn)
        self.assertEqual(conn.events, [False, True])
        recovery = ctx.exception.payload["recovery"]
        self.assertEqual(recovery["on_error"], "on rejected")
        self.assertIs(recovery["on"], False)
        self.assertIn("did not verify", str(ctx.exception))

    def test_off_error_recovery_readback_fails(self):
        conn = self._OffFails()
        conn.get_power = Mock(side_effect=[True, sh.SmartHomeError("offline")])
        with self.assertRaises(sh.CycleFailed) as ctx:
            self._cycle(conn)
        recovery = ctx.exception.payload["recovery"]
        self.assertIsNone(recovery["on"])
        self.assertEqual(recovery["readback_error"], "offline")

    def test_policy_refusals_never_touch_power(self):
        cases = [
            ("mac studio name", sh.Alias("x", "kasa", "Mac Studio", allow_cycle=True), "cycle"),
            ("allow_cycle false", sh.Alias("spark0", "kasa", "spark0", allow_cycle=False), "cycle"),
            ("missing confirm", None, None),
        ]
        for label, alias, confirm in cases:
            with self.subTest(label):
                conn = Mock()
                with self.assertRaises(sh.SafetyError):
                    self._cycle(conn, alias=alias, confirm=confirm)
                conn.set_power.assert_not_called()
                conn.get_power.assert_not_called()

    def test_normal_cycle_reads_back(self):
        conn = Mock()
        conn.get_power.side_effect = [True, True]
        slept = []
        result = self._cycle(conn, slept=slept)
        self.assertEqual([c.args[1] for c in conn.set_power.call_args_list], [False, True])
        self.assertEqual(slept, [8])
        self.assertTrue(result["was_on"])
        self.assertTrue(result["on"])
        self.assertEqual(conn.get_power.call_count, 2)

    def test_cli_cycle_off_error_exits_nonzero_with_json(self):
        conn = self._OffFails()
        device = sh.Device("kasa", "dev-1234", "spark0")
        alias = sh.Alias("spark0", "kasa", "spark0", allow_cycle=True)
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.toml"
            cfg.write_text("", encoding="utf-8")
            out = io.StringIO()
            with patch.object(sh, "load_config", return_value=sh.AppConfig(
                path=cfg, aliases={"spark0": alias}
            )), patch.object(
                sh, "resolve_target", return_value=(conn, device, alias)
            ), patch.object(sh, "CYCLE_RECOVERY_DELAY_SECONDS", 0), redirect_stdout(out), redirect_stderr(io.StringIO()):
                code = sh.main(["--config", str(cfg), "--json", "cycle", "spark0", "--confirm", "cycle"])
        self.assertEqual(code, 2)
        self.assertEqual(conn.events, [False, True])
        payload = json.loads(out.getvalue())
        self.assertFalse(payload["ok"])
        self.assertTrue(payload["recovery"]["on"])


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
                [
                    "spark0",
                    "spark1",
                    "emo-win",
                    "emo-4090",
                    "mac-studio",
                    "media-rack",
                ],
            )
            self.assertEqual(cfg.aliases["spark0"].match, "Sparks")
            self.assertEqual(cfg.aliases["spark1"].match, "Sparks")
            self.assertEqual(cfg.aliases["emo-win"].match, "PC")
            self.assertEqual(cfg.aliases["emo-4090"].match, "4090")
            self.assertFalse(cfg.aliases["mac-studio"].allow_cycle)
            self.assertEqual(cfg.aliases["media-rack"].match, "Media Rack")
            self.assertEqual(cfg.aliases["media-rack"].host, "192.168.50.152")
            self.assertFalse(cfg.aliases["media-rack"].allow_cycle)

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


    def test_preserves_scan_via(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                "\n".join(
                    [
                        "[kasa]",
                        'username = "old@b.c"',
                        'password = "old"',
                        'scan_via = ["spark0"]',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            path.chmod(0o600)
            sh.write_local_config(path, username="new@b.c", password="new")
            again = sh.load_config(path, environ={})
            self.assertEqual(again.kasa_username, "new@b.c")
            self.assertEqual(again.scan_via, ["spark0"])


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

        def fake(config, needle, transport=None, connectors=None):
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



KLAP_STATE = {
    "get_device_info": {
        "device_id": "803ABE5ED92F38252F2968C06265A37F2430D06F",
        "nickname": "TWVkaWEgUmFjaw==",
        "model": "KP125M",
        "type": "SMART.KASAPLUG",
        "device_on": True,
        "ip": "192.168.50.152",
    },
    "get_emeter_data": {
        "current_ma": 1815,
        "voltage_mv": 124510,
        "power_mw": 213765,
        "energy_wh": 215100,
    },
    "get_energy_usage": {
        "today_energy": 4424,
        "current_power": 213765,
    },
}


class FakeLocal:
    def __init__(self, energy=None):
        self.reads = []
        self.powers = []
        self.energy = energy or sh.Energy(
            watts=206.6, volts=124.3, amps=1.74, kwh=4.399, on=True
        )

    def read(self, host, username, password):
        self.reads.append({"host": host, "username": username, "password": password})
        device = sh.Device(
            connector="kasa",
            device_id="local-id",
            alias="Media Rack",
            model="KP125M",
            online=True,
            extras={
                "host": host,
                "deviceType": "SMART.KASAPLUG",
                "path": "klap",
            },
        )
        return device, self.energy

    def set_power(self, host, username, password, on):
        self.powers.append(
            {"host": host, "username": username, "password": password, "on": on}
        )


class TestKlapSmart(unittest.TestCase):
    def _config(self, tmp: str) -> "sh.AppConfig":
        cfg = sh.AppConfig(path=Path(tmp) / "unused.toml", state_dir=Path(tmp))
        cfg.kasa_username = "user@example.com"
        cfg.kasa_password = "pw"
        return cfg

    def _media_list(self, status=0):
        return kasa_ok(
            {
                "deviceList": [
                    {
                        "deviceId": "803ABE5ED92F38252F2968C06265A37F2430D06F",
                        "alias": "TWVkaWEgUmFjaw==",
                        "deviceModel": "KP125M(US)",
                        "deviceType": "SMART.KASAPLUG",
                        "status": status,
                    }
                ]
            }
        )

    def test_parse_klap_state_milliwatt_fields(self):
        device, energy = sh.parse_klap_state(KLAP_STATE)
        self.assertEqual(device.alias, "Media Rack")
        self.assertEqual(device.model, "KP125M")
        self.assertEqual(device.extras["deviceType"], "SMART.KASAPLUG")
        self.assertAlmostEqual(energy.watts, 213.765)
        self.assertAlmostEqual(energy.volts, 124.51)
        self.assertAlmostEqual(energy.amps, 1.815)
        self.assertAlmostEqual(energy.kwh, 215.1)
        self.assertTrue(energy.on)

    def test_smart_with_host_uses_local_not_passthrough(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport(
                [kasa_ok({"token": "tok"}), self._media_list()]
            )
            local = FakeLocal()
            connector = sh.KasaCloudConnector(
                self._config(tmp), transport=transport, local=local
            )
            device = connector.resolve("Media Rack")
            self.assertEqual(device.extras.get("host"), "192.168.50.152")
            self.assertTrue(device.online)
            reading = connector.energy(device)
            self.assertAlmostEqual(reading.watts, 206.6)
            self.assertAlmostEqual(reading.volts, 124.3)
            self.assertTrue(reading.on)
            self.assertEqual(connector.get_power(device), True)
            connector.set_power(device, False)
            self.assertEqual(local.reads[0]["host"], "192.168.50.152")
            self.assertEqual(local.powers[0]["on"], False)
            passthrough = [
                call
                for call in transport.calls
                if call["body"] and call["body"].get("method") == "passthrough"
            ]
            self.assertEqual(passthrough, [])

    def test_smart_without_host_is_offline_not_passthrough(self):
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
                                    "deviceType": "SMART.KASAPLUG",
                                    "status": 0,
                                }
                            ]
                        }
                    ),
                ]
            )
            local = FakeLocal()
            connector = sh.KasaCloudConnector(
                self._config(tmp), transport=transport, local=local
            )
            device = connector.resolve("Sparks")
            with self.assertRaises(sh.DeviceOffline) as ctx:
                connector.energy(device)
            self.assertIn("host", str(ctx.exception))
            self.assertEqual(local.reads, [])
            passthrough = [
                call
                for call in transport.calls
                if call["body"] and call["body"].get("method") == "passthrough"
            ]
            self.assertEqual(passthrough, [])

    def test_resolve_media_rack_alias_without_cloud_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport(
                [kasa_ok({"token": "tok"}), kasa_ok({"deviceList": []})]
            )
            connector = sh.KasaCloudConnector(self._config(tmp), transport=transport)
            device = connector.resolve("media-rack")
            self.assertEqual(device.extras.get("host"), "192.168.50.152")
            self.assertEqual(device.alias, "Media Rack")
            self.assertTrue(sh.is_smart_kasa_device(device))

    def test_load_and_write_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                "\n".join(
                    [
                        "[kasa]",
                        'username = "a@b.c"',
                        'password = "secret"',
                        "[[device]]",
                        'alias = "media-rack"',
                        'match = "Media Rack"',
                        'host = "192.168.50.152"',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            path.chmod(0o600)
            cfg = sh.load_config(path, environ={})
            self.assertEqual(cfg.aliases["media-rack"].host, "192.168.50.152")
            sh.write_local_config(
                path,
                username="a@b.c",
                password="secret",
                devices=list(cfg.aliases.values()),
            )
            text = path.read_text(encoding="utf-8")
            self.assertIn('host = "192.168.50.152"', text)
            again = sh.load_config(path, environ={})
            self.assertEqual(again.aliases["media-rack"].host, "192.168.50.152")

    def test_uvx_keeps_password_in_env(self):
        seen = []

        def run(argv, timeout=None, environ=None):
            seen.append({"argv": argv, "environ": environ, "timeout": timeout})
            return json.dumps(KLAP_STATE)

        backend = sh.PythonKasaBackend(run=run)

        def boom(host, username, password):
            raise ImportError("no kasa")

        backend._read_library = boom
        device, energy = backend.read("192.168.50.152", "user@example.com", "s3cret")
        self.assertAlmostEqual(energy.watts, 213.765)
        self.assertEqual(device.alias, "Media Rack")
        call = seen[0]
        self.assertNotIn("s3cret", call["argv"])
        self.assertEqual(call["environ"]["KASA_PASSWORD"], "s3cret")
        self.assertEqual(call["environ"]["KASA_USERNAME"], "user@example.com")
        self.assertIn("--host", call["argv"])
        self.assertIn("192.168.50.152", call["argv"])
        self.assertIn("user@example.com", call["argv"])

    def test_parse_local_iot_sysinfo(self):
        device, energy = sh.parse_local_state(
            {
                "system": {
                    "get_sysinfo": {
                        "alias": "Mix Cubes",
                        "model": "HS103(US)",
                        "relay_state": 0,
                        "mac": "84:D8:1B:8E:24:25",
                        "deviceId": "hs103",
                    }
                },
                "emeter": {"get_realtime": {"err_code": -1}},
            },
            host="192.168.50.10",
        )
        self.assertEqual(device.alias, "Mix Cubes")
        self.assertEqual(device.extras["host"], "192.168.50.10")
        self.assertFalse(energy.on)
        self.assertEqual(energy.watts, 0)

    def test_host_cache_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            hosts = {}
            sh.index_host(hosts, "192.168.50.152", "Media Rack", "a82948234ed5")
            sh.save_host_index(state, hosts)
            loaded = sh.load_host_index(state)
            self.assertEqual(loaded["media rack"], "192.168.50.152")
            self.assertEqual(loaded["a82948234ed5"], "192.168.50.152")

    def test_scan_persists_and_attaches_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._config(tmp)
            transport = FakeTransport(
                [kasa_ok({"token": "tok"}), self._media_list(status=0)]
            )

            class ScanningLocal(FakeLocal):
                def discover(self, username, password):
                    device = sh.Device(
                        connector="kasa",
                        device_id="803ABE5ED92F38252F2968C06265A37F2430D06F",
                        alias="Media Rack",
                        model="KP125M",
                        online=True,
                        extras={
                            "host": "192.168.50.152",
                            "deviceMac": "A82948234ED5",
                            "deviceType": "SMART.KASAPLUG",
                        },
                    )
                    return [(device, self.energy)]

            local = ScanningLocal()
            connector = sh.KasaCloudConnector(cfg, transport=transport, local=local)
            found = connector.scan()
            self.assertEqual(found[0].extras["host"], "192.168.50.152")
            self.assertEqual(cfg.hosts["media rack"], "192.168.50.152")
            self.assertEqual(cfg.hosts["a82948234ed5"], "192.168.50.152")
            device = connector.resolve("Media Rack")
            self.assertEqual(device.extras.get("host"), "192.168.50.152")

    def test_hs103_energy_returns_on_without_emeter(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeTransport(
                [
                    kasa_ok({"token": "tok"}),
                    kasa_ok(
                        {
                            "deviceList": [
                                {
                                    "deviceId": "hs1",
                                    "alias": "Mix Cubes",
                                    "deviceModel": "HS103(US)",
                                    "deviceType": "IOT.SMARTPLUGSWITCH",
                                    "status": 1,
                                }
                            ]
                        }
                    ),
                    passthrough({"system": {"get_sysinfo": {"relay_state": 0}}}),
                    passthrough({"emeter": {"get_realtime": {"err_code": -1}}}),
                    passthrough({"system": {"get_sysinfo": {"relay_state": 0}}}),
                ]
            )
            connector = sh.KasaCloudConnector(
                self._config(tmp), transport=transport, local=FakeLocal()
            )
            device = connector.resolve("Mix Cubes")
            reading = connector.energy(device)
            self.assertFalse(reading.on)
            self.assertEqual(reading.watts, 0.0)



class TestScanCidrs(unittest.TestCase):
    def test_ips_from_ifconfig(self):
        macos = "\n".join(
            [
                "en0: flags=8863",
                "\tinet 192.168.50.221 netmask 0xffffff00 broadcast 192.168.50.255",
                "en1: flags=8863",
                "\tinet 192.168.101.14 netmask 0xffffff00 broadcast 192.168.101.255",
            ]
        )
        linux = "2: wlP9s9    inet 192.168.102.20/24 brd 192.168.102.255"
        self.assertEqual(
            sh.ips_from_ifconfig(macos),
            ["192.168.50.221", "192.168.101.14"],
        )
        self.assertEqual(sh.ips_from_ifconfig(linux), ["192.168.102.20"])

    def test_extra_and_default_guest_cidrs(self):
        cidrs = sh.local_ipv4_cidrs(extra=["192.168.77.0/24"])
        self.assertIn("192.168.77.0/24", cidrs)
        cfg = sh.AppConfig(path=Path("/tmp/unused.toml"), state_dir=Path("/tmp"))
        cfg.scan_cidrs = ["10.9.9.0/24"]
        scanned = sh.scan_cidrs_for(cfg)
        self.assertIn("10.9.9.0/24", scanned)
        self.assertIn("192.168.101.0/24", scanned)
        self.assertIn("192.168.102.0/24", scanned)

    def test_load_scan_cidrs_from_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                "\n".join(
                    [
                        "[kasa]",
                        'username = "a@b.c"',
                        'password = "secret"',
                        'scan_cidrs = ["192.168.88.0/24"]',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            path.chmod(0o600)
            cfg = sh.load_config(path, environ={})
            self.assertEqual(cfg.scan_cidrs, ["192.168.88.0/24"])

    def test_cidr_broadcasts(self):
        bcasts = sh.cidr_broadcasts(["192.168.50.0/24", "192.168.101.0/24"])
        self.assertEqual(bcasts[0], "255.255.255.255")
        self.assertIn("192.168.50.255", bcasts)
        self.assertIn("192.168.101.255", bcasts)



class TestScanVia(unittest.TestCase):
    def test_load_scan_via_from_config_and_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.toml"
            path.write_text(
                "\n".join(
                    [
                        "[kasa]",
                        'username = "a@b.c"',
                        'password = "secret"',
                        'scan_via = ["spark0"]',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            path.chmod(0o600)
            cfg = sh.load_config(path, environ={"SMART_HOME_SCAN_VIA": "edge,spark0"})
            self.assertEqual(cfg.scan_via, ["spark0", "edge"])
            hops = sh.scan_via_for(cfg)
            self.assertEqual(hops, ["spark0", "edge"])

    def test_host_is_directly_reachable_uses_local_ifaces_only(self):
        cidrs = sh.local_ipv4_cidrs()
        self.assertTrue(any(c.endswith("/24") for c in cidrs))
        self.assertFalse(sh.host_is_directly_reachable("not-an-ip"))
        # Guest scan CIDRs are not automatically local just because we probe them.
        if "192.168.101.0/24" not in cidrs:
            self.assertFalse(sh.host_is_directly_reachable("192.168.101.20"))

    def test_scan_merges_via_discover(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = sh.AppConfig(path=Path(tmp) / "unused.toml", state_dir=Path(tmp))
            cfg.kasa_username = "user@example.com"
            cfg.kasa_password = "pw"
            cfg.scan_via = ["spark0"]

            class ViaLocal(FakeLocal):
                def discover(self, username, password, cidrs=None):
                    return []

                def discover_via(self, hop, username, password, cidrs=None):
                    self.reads.append({"via": hop, "cidrs": cidrs})
                    device = sh.Device(
                        connector="kasa",
                        device_id="sparks-id",
                        alias="Sparks",
                        model="KP125M",
                        online=True,
                        extras={
                            "host": "192.168.101.20",
                            "deviceMac": "A82948235757",
                            "deviceType": "SMART.KASAPLUG",
                        },
                    )
                    return [(device, self.energy)]

            local = ViaLocal()
            connector = sh.KasaCloudConnector(cfg, transport=FakeTransport([]), local=local)
            found = connector.scan()
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0].extras["host"], "192.168.101.20")
            loaded = sh.load_host_index(Path(tmp))
            self.assertEqual(loaded["sparks"], "192.168.101.20")
            self.assertEqual(local.reads[0]["via"], "spark0")

    def test_energy_uses_via_when_host_not_local(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = sh.AppConfig(path=Path(tmp) / "unused.toml", state_dir=Path(tmp))
            cfg.kasa_username = "user@example.com"
            cfg.kasa_password = "pw"
            cfg.scan_via = ["spark0"]
            sh.index_host(cfg.hosts, "192.168.101.20", "Sparks")

            class ViaLocal(FakeLocal):
                def read(self, host, username, password):
                    raise AssertionError("local read should be skipped for guest IP")

                def read_via(self, hop, host, username, password):
                    self.reads.append({"via": hop, "host": host})
                    device = sh.Device(
                        connector="kasa",
                        device_id="sparks-id",
                        alias="Sparks",
                        model="KP125M",
                        online=True,
                        extras={"host": host, "deviceType": "SMART.KASAPLUG"},
                    )
                    return device, self.energy

            local = ViaLocal()
            original = sh.host_is_directly_reachable
            sh.host_is_directly_reachable = lambda ip, extra=None: False
            try:
                connector = sh.KasaCloudConnector(
                    cfg, transport=FakeTransport([]), local=local
                )
                device = sh.Device(
                    "kasa",
                    "sparks-id",
                    "Sparks",
                    model="KP125M",
                    extras={"deviceType": "SMART.KASAPLUG"},
                )
                reading = connector.energy(device)
            finally:
                sh.host_is_directly_reachable = original
            self.assertAlmostEqual(reading.watts, 206.6)
            self.assertEqual(local.reads[0]["via"], "spark0")
            self.assertEqual(local.reads[0]["host"], "192.168.101.20")

    def test_ssh_klap_json_keeps_password_on_stdin(self):
        seen = []

        def fake_run(argv, input=None, capture_output=None, text=None, timeout=None):
            seen.append({"argv": argv, "input": input, "timeout": timeout})

            class Result:
                returncode = 0
                stdout = 'RESULT:{"host":"192.168.101.20","state":{"ok":true}}\n'
                stderr = ""

            return Result()

        original = sh.subprocess.run
        sh.subprocess.run = fake_run
        try:
            payload = sh.ssh_klap_json(
                "spark0",
                {"cmd": "read", "host": "192.168.101.20", "username": "u", "password": "s3cret"},
            )
        finally:
            sh.subprocess.run = original
        self.assertEqual(payload["host"], "192.168.101.20")
        call = seen[0]
        self.assertEqual(call["argv"][0], "ssh")
        self.assertIn("spark0", call["argv"])
        self.assertNotIn("s3cret", call["argv"])
        self.assertIn("s3cret", call["input"])
        self.assertIn("bash", call["argv"])
        self.assertTrue(any("venv/bin/python" in str(a) for a in call["argv"]))



if __name__ == "__main__":
    unittest.main()
