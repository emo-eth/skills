#!/usr/bin/env python3
"""API-only smart home CLI. No local UDP discovery."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import stat
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlencode

DEFAULT_CONFIG = Path.home() / ".config" / "smart-home" / "config.toml"
KASA_CLOUD_URL = "https://wap.tplinkcloud.com"
CONFIRM_CYCLE = "cycle"
DEFAULT_OFF_SECONDS = 8.0
KASA_DEVICE_OFFLINE_CODE = -20571
KASA_AUTH_ERROR_CODES = {-20651, -20600, -20004}


class SmartHomeError(Exception):
    pass


class AuthError(SmartHomeError):
    pass


class ConfigError(SmartHomeError):
    pass


class SafetyError(SmartHomeError):
    pass


class DeviceNotFound(SmartHomeError):
    pass


class EnergyUnsupported(SmartHomeError):
    pass


class DeviceOffline(SmartHomeError):
    pass


@dataclass(frozen=True)
class Energy:
    watts: float
    volts: float
    amps: float
    kwh: float
    on: bool | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "watts": self.watts,
            "volts": self.volts,
            "amps": self.amps,
            "kwh": self.kwh,
            "on": self.on,
        }


@dataclass(frozen=True)
class Device:
    connector: str
    device_id: str
    alias: str
    model: str = ""
    online: bool | None = None
    parent_id: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Alias:
    name: str
    connector: str
    match: str
    allow_cycle: bool = False
    entity_id: str | None = None
    power_entity: str | None = None
    voltage_entity: str | None = None
    energy_entity: str | None = None


@dataclass
class AppConfig:
    path: Path
    default_connector: str = "kasa"
    kasa_username: str | None = None
    kasa_password: str | None = None
    kasa_password_encoding: str = "plain"
    kasa_url: str = KASA_CLOUD_URL
    ha_url: str | None = None
    ha_token: str | None = None
    aliases: dict[str, Alias] = field(default_factory=dict)
    state_dir: Path = field(default_factory=lambda: Path.home() / ".config" / "smart-home")


class HttpTransport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
        timeout: float,
    ) -> tuple[int, str]:
        ...


class UrlLibTransport:
    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
        timeout: float,
    ) -> tuple[int, str]:
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            return exc.code, payload
        except urllib.error.URLError as exc:
            raise SmartHomeError(f"HTTP request failed: {exc.reason}") from exc


def _run_capture(argv: list[str]) -> str:
    result = subprocess.run(argv, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise AuthError(f"{argv[0]} failed: {err or result.returncode}")
    return result.stdout.rstrip("\n")


def resolve_secret(
    *,
    inline: str | None,
    env_name: str | None,
    op_ref: str | None,
    keychain: str | None,
    extra_env: tuple[str, ...] = (),
    environ: dict[str, str] | None = None,
    run: Callable[[list[str]], str] = _run_capture,
) -> str | None:
    env = os.environ if environ is None else environ
    for name in extra_env:
        value = env.get(name)
        if value:
            return value
    if env_name:
        value = env.get(env_name)
        if value:
            return value
    if op_ref:
        return run(["op", "read", op_ref])
    if keychain:
        return run(["security", "find-generic-password", "-w", "-s", keychain])
    if inline:
        return inline
    return None


def _require_private_file(path: Path, reason: str) -> None:
    mode = path.stat().st_mode
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise ConfigError(f"{path} {reason}; chmod 600 it (group/other bits are set)")


def _toml_string(value: str) -> str:
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'


def _bool_toml(value: bool) -> str:
    return "true" if value else "false"



def _read_toml_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def _toml_scalar(value: Any) -> str | None:
    if isinstance(value, bool):
        return _bool_toml(value)
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return _toml_string(value)
    return None


def _toml_table_lines(name: str, mapping: dict[str, Any]) -> list[str]:
    lines = [f"[{name}]"]
    for key, value in mapping.items():
        rendered = _toml_scalar(value)
        if rendered is None:
            continue
        lines.append(f"{key} = {rendered}")
    lines.append("")
    return lines

def write_local_config(
    path: Path,
    *,
    username: str,
    password: str,
    devices: list[Alias] | None = None,
) -> None:
    if not username.strip() or not password:
        raise ConfigError("Kasa username and password are required")
    existing = _read_toml_file(path)
    existing_devices = devices
    if existing_devices is None and path.is_file():
        try:
            existing_devices = list(load_config(path, environ={}).aliases.values())
        except (SmartHomeError, OSError, tomllib.TOMLDecodeError):
            existing_devices = []
    if not existing_devices:
        existing_devices = [
            Alias("spark0", "kasa", "spark0", allow_cycle=True),
            Alias("emo-win", "kasa", "emo-win", allow_cycle=True),
        ]
    default_connector = existing.get("default_connector") or "kasa"
    if not isinstance(default_connector, str) or not default_connector.strip():
        default_connector = "kasa"
    ha = existing.get("homeassistant")
    if not isinstance(ha, dict):
        ha = {}
    lines = [
        "# Written by `smart-home setup`. chmod 600. Do not commit.",
        f"default_connector = {_toml_string(default_connector.strip())}",
        "",
        "[kasa]",
        f"username = {_toml_string(username.strip())}",
        f"password = {_toml_string(password)}",
        'password_encoding = "plain"',
        "",
    ]
    if ha:
        lines.extend(_toml_table_lines("homeassistant", ha))
    for alias in existing_devices:
        lines.extend(
            [
                "[[device]]",
                f"alias = {_toml_string(alias.name)}",
                f"connector = {_toml_string(alias.connector)}",
                f"match = {_toml_string(alias.match)}",
                f"allow_cycle = {_bool_toml(alias.allow_cycle)}",
            ]
        )
        if alias.entity_id:
            lines.append(f"entity_id = {_toml_string(alias.entity_id)}")
        if alias.power_entity:
            lines.append(f"power_entity = {_toml_string(alias.power_entity)}")
        if alias.voltage_entity:
            lines.append(f"voltage_entity = {_toml_string(alias.voltage_entity)}")
        if alias.energy_entity:
            lines.append(f"energy_entity = {_toml_string(alias.energy_entity)}")
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    path.chmod(0o600)


def read_setup_password(*, password: str | None, password_stdin: bool) -> str:
    if password and password_stdin:
        raise ConfigError("pass --password or --password-stdin, not both")
    if password:
        return password
    if password_stdin and sys.stdin.isatty():
        value = getpass.getpass("Kasa password: ")
        if not value:
            raise ConfigError("empty password")
        return value
    if password_stdin or not sys.stdin.isatty():
        value = sys.stdin.readline()
        if value.endswith("\n"):
            value = value[:-1]
        if value.endswith("\r"):
            value = value[:-1]
        if not value:
            raise ConfigError("no password on stdin")
        return value
    value = getpass.getpass("Kasa password: ")
    if not value:
        raise ConfigError("empty password")
    return value


def run_setup(args: argparse.Namespace) -> int:
    password = read_setup_password(
        password=args.password, password_stdin=args.password_stdin
    )
    write_local_config(args.config, username=args.username, password=password)
    loaded = load_config(args.config)
    payload = {
        "config": str(args.config),
        "mode": oct(args.config.stat().st_mode & 0o777),
        "username": loaded.kasa_username,
        "devices": [alias.name for alias in loaded.aliases.values()],
    }
    if args.verify:
        who = KasaCloudConnector(loaded).whoami()
        payload["whoami"] = who
    _print(payload, args.json)
    return 0


def load_config(
    path: Path,
    *,
    environ: dict[str, str] | None = None,
    run: Callable[[list[str]], str] = _run_capture,
) -> AppConfig:
    env = os.environ if environ is None else environ
    cfg = AppConfig(path=path, state_dir=path.parent)
    if not path.is_file():
        cfg.kasa_username = env.get("SMART_HOME_KASA_USERNAME") or env.get("KASA_USERNAME")
        cfg.kasa_password = resolve_secret(
            inline=None,
            env_name=None,
            op_ref=None,
            keychain=None,
            extra_env=("SMART_HOME_KASA_PASSWORD", "KASA_PASSWORD"),
            environ=env,
            run=run,
        )
        cfg.ha_url = env.get("SMART_HOME_HA_URL") or env.get("HASS_URL")
        cfg.ha_token = resolve_secret(
            inline=None,
            env_name=None,
            op_ref=None,
            keychain=None,
            extra_env=("SMART_HOME_HA_TOKEN", "HASS_TOKEN"),
            environ=env,
            run=run,
        )
        return cfg

    data = tomllib.loads(path.read_text(encoding="utf-8"))
    cfg.default_connector = str(data.get("default_connector") or "kasa")
    kasa = data.get("kasa") or {}
    ha = data.get("homeassistant") or {}
    if kasa.get("password") or ha.get("token"):
        _require_private_file(path, "contains an inline secret")

    cfg.kasa_username = (
        env.get("SMART_HOME_KASA_USERNAME")
        or env.get("KASA_USERNAME")
        or kasa.get("username")
    )
    cfg.kasa_password_encoding = str(kasa.get("password_encoding") or "plain")
    cfg.kasa_url = str(kasa.get("url") or KASA_CLOUD_URL)
    cfg.kasa_password = resolve_secret(
        inline=kasa.get("password"),
        env_name=kasa.get("password_env"),
        op_ref=kasa.get("password_op"),
        keychain=kasa.get("password_keychain"),
        extra_env=("SMART_HOME_KASA_PASSWORD", "KASA_PASSWORD"),
        environ=env,
        run=run,
    )
    cfg.ha_url = env.get("SMART_HOME_HA_URL") or env.get("HASS_URL") or ha.get("url")
    cfg.ha_token = resolve_secret(
        inline=ha.get("token"),
        env_name=ha.get("token_env"),
        op_ref=ha.get("token_op"),
        keychain=ha.get("token_keychain"),
        extra_env=("SMART_HOME_HA_TOKEN", "HASS_TOKEN"),
        environ=env,
        run=run,
    )

    for item in data.get("device") or []:
        name = str(item.get("alias") or "").strip()
        if not name:
            raise ConfigError("[[device]] entries need alias")
        connector = str(item.get("connector") or cfg.default_connector)
        match = str(item.get("match") or item.get("device_id") or item.get("entity_id") or name)
        cfg.aliases[name.lower()] = Alias(
            name=name,
            connector=connector,
            match=match,
            allow_cycle=bool(item.get("allow_cycle", False)),
            entity_id=item.get("entity_id"),
            power_entity=item.get("power_entity"),
            voltage_entity=item.get("voltage_entity"),
            energy_entity=item.get("energy_entity"),
        )
    return cfg


def normalize_emeter(payload: dict[str, Any], on: bool | None = None) -> Energy:
    data = payload
    if "emeter" in data and isinstance(data["emeter"], dict):
        inner = data["emeter"]
        data = inner.get("get_realtime", inner)
    err = data.get("err_code", 0)
    if err:
        raise EnergyUnsupported(f"emeter error {err}")
    if "power_mw" in data or "voltage_mv" in data or "current_ma" in data:
        watts = float(data.get("power_mw") or 0) / 1000.0
        volts = float(data.get("voltage_mv") or 0) / 1000.0
        amps = float(data.get("current_ma") or 0) / 1000.0
        kwh = float(data.get("total_wh") or 0) / 1000.0
    else:
        watts = float(data.get("power") or 0)
        volts = float(data.get("voltage") or 0)
        amps = float(data.get("current") or 0)
        kwh = float(data.get("total") or 0)
    return Energy(watts=watts, volts=volts, amps=amps, kwh=kwh, on=on, raw=data)


def decode_passthrough(result: dict[str, Any]) -> dict[str, Any]:
    response = result.get("responseData", result)
    if isinstance(response, str):
        return json.loads(response)
    if isinstance(response, dict):
        return response
    raise SmartHomeError("passthrough response was not JSON")


def _hash_password(password: str, encoding: str) -> str:
    if encoding == "plain":
        return password
    if encoding == "md5":
        return hashlib.md5(password.encode("utf-8")).hexdigest().upper()
    raise ConfigError(f"unknown kasa.password_encoding {encoding!r}")


class KasaCloudConnector:
    name = "kasa"

    def __init__(
        self,
        config: AppConfig,
        transport: HttpTransport | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.config = config
        self.transport = transport or UrlLibTransport()
        self.timeout = timeout
        self._token: str | None = None
        self._devices: list[Device] | None = None
        self._terminal = self._load_terminal_uuid()

    def _load_terminal_uuid(self) -> str:
        path = self.config.state_dir / "kasa-terminal-uuid"
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
        return str(uuid.uuid4())

    def _persist_terminal_uuid(self) -> None:
        path = self.config.state_dir / "kasa-terminal-uuid"
        if path.is_file():
            return
        self.config.state_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(self._terminal + "\n", encoding="utf-8")
        path.chmod(0o600)

    def _cloud(self, payload: dict[str, Any], url: str | None = None) -> dict[str, Any]:
        target = url or self.config.kasa_url
        if self._token:
            sep = "&" if "?" in target else "?"
            target = f"{target}{sep}{urlencode({'token': self._token})}"
        body = json.dumps(payload).encode("utf-8")
        status, text = self.transport.request(
            "POST",
            target,
            {"Content-Type": "application/json"},
            body,
            self.timeout,
        )
        try:
            data = json.loads(text) if text else {}
        except json.JSONDecodeError as exc:
            raise SmartHomeError(f"Kasa cloud returned HTTP {status} non-JSON") from exc
        if status >= 400:
            raise SmartHomeError(f"Kasa cloud HTTP {status}: {text[:200]}")
        code = data.get("error_code", 0)
        if code == KASA_DEVICE_OFFLINE_CODE:
            raise DeviceOffline(f"Kasa device offline (error_code {code})")
        if code in KASA_AUTH_ERROR_CODES:
            raise AuthError(f"Kasa auth failed (error_code {code})")
        if code:
            raise SmartHomeError(f"Kasa cloud error_code {code}: {data.get('msg') or data}")
        return data.get("result") or {}

    def login(self) -> dict[str, Any]:
        if not self.config.kasa_username or not self.config.kasa_password:
            raise AuthError(
                "Kasa credentials missing. Set SMART_HOME_KASA_USERNAME and "
                "SMART_HOME_KASA_PASSWORD, or ~/.config/smart-home/config.toml "
                "with password_env / password_op / password_keychain."
            )
        self._token = None
        result = self._cloud(
            {
                "method": "login",
                "params": {
                    "appType": "Kasa_Android",
                    "cloudUserName": self.config.kasa_username,
                    "cloudPassword": _hash_password(
                        self.config.kasa_password,
                        self.config.kasa_password_encoding,
                    ),
                    "terminalUUID": self._terminal,
                },
            }
        )
        token = result.get("token")
        if not token:
            raise AuthError("Kasa login succeeded without a token")
        self._persist_terminal_uuid()
        self._token = str(token)
        self._devices = None
        return {"account": self.config.kasa_username, "connector": self.name}

    def whoami(self) -> dict[str, Any]:
        info = self.login()
        devices = self.list_devices()
        info["device_count"] = len(devices)
        return info

    def _ensure_login(self) -> None:
        if not self._token:
            self.login()

    def list_devices(self) -> list[Device]:
        self._ensure_login()
        if self._devices is not None:
            return self._devices
        result = self._cloud({"method": "getDeviceList"})
        devices: list[Device] = []
        for item in result.get("deviceList") or []:
            parent = Device(
                connector=self.name,
                device_id=str(item.get("deviceId") or ""),
                alias=str(item.get("alias") or item.get("deviceName") or ""),
                model=str(item.get("deviceModel") or ""),
                online=item.get("status") == 1,
                extras={
                    "appServerUrl": item.get("appServerUrl"),
                    "deviceType": item.get("deviceType"),
                },
            )
            devices.append(parent)
            if parent.online:
                devices.extend(self._expand_children(parent))
        self._devices = devices
        return devices

    def _passthrough(self, device: Device, request: dict[str, Any]) -> dict[str, Any]:
        self._ensure_login()
        url = device.extras.get("appServerUrl") or self.config.kasa_url
        payload = {
            "method": "passthrough",
            "params": {
                "deviceId": device.parent_id or device.device_id,
                "requestData": json.dumps(request),
            },
        }
        result = self._cloud(payload, url=url)
        return decode_passthrough(result)

    def _expand_children(self, parent: Device) -> list[Device]:
        if parent.online is False:
            return []
        try:
            info = self._passthrough(parent, {"system": {"get_sysinfo": {}}})
        except SmartHomeError:
            return []
        sysinfo = (info.get("system") or {}).get("get_sysinfo") or {}
        children = sysinfo.get("children") or []
        out: list[Device] = []
        for child in children:
            cid = str(child.get("id") or "")
            full_id = cid if cid.startswith(parent.device_id) else parent.device_id + cid
            out.append(
                Device(
                    connector=self.name,
                    device_id=full_id,
                    alias=str(child.get("alias") or full_id),
                    model=parent.model + "-outlet",
                    online=parent.online,
                    parent_id=parent.device_id,
                    extras={
                        **parent.extras,
                        "child": True,
                        "relay_state": child.get("state"),
                    },
                )
            )
        return out

    def _find(self, devices: list[Device], needle: str) -> Device:
        lowered = needle.lower()
        exact = [
            d for d in devices if d.alias.lower() == lowered or d.device_id.lower() == lowered
        ]
        if len(exact) == 1:
            return exact[0]
        if len(exact) > 1:
            raise DeviceNotFound(f"ambiguous device {needle!r}")
        partial = [d for d in devices if lowered in d.alias.lower()]
        if len(partial) == 1:
            return partial[0]
        raise DeviceNotFound(f"no Kasa device matching {needle!r}")

    def resolve(self, needle: str) -> Device:
        return self._find(self.list_devices(), needle)

    def get_power(self, device: Device) -> bool:
        request: dict[str, Any] = {"system": {"get_sysinfo": {}}}
        if device.parent_id:
            request["context"] = {"child_ids": [device.device_id]}
        info = self._passthrough(device, request)
        sysinfo = (info.get("system") or {}).get("get_sysinfo") or {}
        if device.parent_id:
            for child in sysinfo.get("children") or []:
                cid = str(child.get("id") or "")
                full_id = cid if cid.startswith(device.parent_id) else device.parent_id + cid
                if full_id == device.device_id:
                    return bool(child.get("state"))
        return bool(sysinfo.get("relay_state"))

    def set_power(self, device: Device, on: bool) -> None:
        request: dict[str, Any] = {"system": {"set_relay_state": {"state": 1 if on else 0}}}
        if device.parent_id:
            request["context"] = {"child_ids": [device.device_id]}
        self._passthrough(device, request)

    def energy(self, device: Device) -> Energy:
        request: dict[str, Any] = {"emeter": {"get_realtime": {}}}
        if device.parent_id:
            request["context"] = {"child_ids": [device.device_id]}
        payload = self._passthrough(device, request)
        on = None
        try:
            on = self.get_power(device)
        except SmartHomeError:
            on = None
        return normalize_emeter(payload, on=on)


class HomeAssistantConnector:
    name = "homeassistant"

    def __init__(
        self,
        config: AppConfig,
        transport: HttpTransport | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.config = config
        self.transport = transport or UrlLibTransport()
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        if not self.config.ha_url or not self.config.ha_token:
            raise AuthError(
                "Home Assistant credentials missing. Set SMART_HOME_HA_URL and "
                "SMART_HOME_HA_TOKEN, or [homeassistant] in config.toml."
            )
        return {
            "Authorization": f"Bearer {self.config.ha_token}",
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        self._headers()
        assert self.config.ha_url is not None
        return self.config.ha_url.rstrip("/") + path

    def _get(self, path: str) -> Any:
        status, text = self.transport.request(
            "GET", self._url(path), self._headers(), None, self.timeout
        )
        if status in (401, 403):
            raise AuthError(f"Home Assistant auth failed (HTTP {status})")
        if status >= 400:
            raise SmartHomeError(f"Home Assistant HTTP {status}: {text[:200]}")
        return json.loads(text) if text else None

    def _post(self, path: str, payload: dict[str, Any]) -> Any:
        body = json.dumps(payload).encode("utf-8")
        status, text = self.transport.request(
            "POST", self._url(path), self._headers(), body, self.timeout
        )
        if status in (401, 403):
            raise AuthError(f"Home Assistant auth failed (HTTP {status})")
        if status >= 400:
            raise SmartHomeError(f"Home Assistant HTTP {status}: {text[:200]}")
        return json.loads(text) if text else None

    def whoami(self) -> dict[str, Any]:
        config = self._get("/api/config")
        return {
            "connector": self.name,
            "location": config.get("location_name") if isinstance(config, dict) else None,
            "version": config.get("version") if isinstance(config, dict) else None,
        }

    def list_devices(self) -> list[Device]:
        states = self._get("/api/states")
        devices: list[Device] = []
        for item in states or []:
            entity_id = str(item.get("entity_id") or "")
            domain = entity_id.split(".", 1)[0]
            if domain not in {"switch", "plug", "fan", "input_boolean"}:
                continue
            attrs = item.get("attributes") or {}
            devices.append(
                Device(
                    connector=self.name,
                    device_id=entity_id,
                    alias=str(attrs.get("friendly_name") or entity_id),
                    model=str(attrs.get("device_class") or domain),
                    online=item.get("state") not in {None, "unavailable", "unknown"},
                    extras={"state": item.get("state")},
                )
            )
        return devices

    def resolve(self, needle: str, alias: Alias | None = None) -> Device:
        entity_id = (alias.entity_id if alias else None) or needle
        try:
            item = self._get(f"/api/states/{entity_id}")
        except SmartHomeError:
            item = None
        if isinstance(item, dict) and item.get("entity_id"):
            attrs = item.get("attributes") or {}
            return Device(
                connector=self.name,
                device_id=str(item["entity_id"]),
                alias=str(attrs.get("friendly_name") or item["entity_id"]),
                extras={"state": item.get("state")},
            )
        devices = self.list_devices()
        lowered = needle.lower()
        matches = [
            d for d in devices if d.device_id.lower() == lowered or d.alias.lower() == lowered
        ]
        if len(matches) == 1:
            return matches[0]
        raise DeviceNotFound(f"no Home Assistant entity matching {needle!r}")

    def get_power(self, device: Device) -> bool:
        item = self._get(f"/api/states/{device.device_id}")
        return str(item.get("state") or "").lower() in {"on", "true", "1"}

    def set_power(self, device: Device, on: bool) -> None:
        service = "turn_on" if on else "turn_off"
        domain = device.device_id.split(".", 1)[0]
        self._post(f"/api/services/{domain}/{service}", {"entity_id": device.device_id})

    def _sensor_float(self, entity_id: str | None) -> float | None:
        if not entity_id:
            return None
        item = self._get(f"/api/states/{entity_id}")
        try:
            return float(item.get("state"))
        except (TypeError, ValueError):
            return None

    def energy(self, device: Device, alias: Alias | None = None) -> Energy:
        attrs: dict[str, Any] = {}
        item = self._get(f"/api/states/{device.device_id}")
        if isinstance(item, dict):
            attrs = item.get("attributes") or {}
        on = self.get_power(device)
        watts = None
        volts = None
        kwh = None
        if alias:
            watts = self._sensor_float(alias.power_entity)
            volts = self._sensor_float(alias.voltage_entity)
            kwh = self._sensor_float(alias.energy_entity)
        if watts is None:
            for key in ("current_power_w", "power", "current_consumption"):
                if key in attrs:
                    try:
                        watts = float(attrs[key])
                        break
                    except (TypeError, ValueError):
                        continue
        if volts is None and "voltage" in attrs:
            try:
                volts = float(attrs["voltage"])
            except (TypeError, ValueError):
                volts = None
        if watts is None:
            raise EnergyUnsupported(
                f"{device.device_id} has no power reading; set power_entity on the alias"
            )
        amps = 0.0
        if volts:
            amps = watts / volts
        return Energy(
            watts=float(watts),
            volts=float(volts or 0),
            amps=amps,
            kwh=float(kwh or 0),
            on=on,
            raw=attrs,
        )


def build_connector(
    name: str,
    config: AppConfig,
    transport: HttpTransport | None = None,
) -> KasaCloudConnector | HomeAssistantConnector:
    if name in {"kasa", "tplink"}:
        return KasaCloudConnector(config, transport=transport)
    if name in {"homeassistant", "ha", "hass"}:
        return HomeAssistantConnector(config, transport=transport)
    raise ConfigError(f"unknown connector {name!r}")


def resolve_target(
    config: AppConfig, needle: str, transport: HttpTransport | None = None
) -> tuple[KasaCloudConnector | HomeAssistantConnector, Device, Alias | None]:
    alias = config.aliases.get(needle.lower())
    connector_name = alias.connector if alias else config.default_connector
    connector = build_connector(connector_name, config, transport=transport)
    match = alias.match if alias else needle
    if isinstance(connector, HomeAssistantConnector):
        device = connector.resolve(match, alias=alias)
    else:
        device = connector.resolve(match)
    return connector, device, alias


def require_power_cut_permission(
    *,
    name: str,
    alias: Alias | None,
    confirm: str | None,
    allow_unmapped: bool,
    action: str = "cycle",
) -> None:
    if confirm != CONFIRM_CYCLE:
        raise SafetyError(f"refusing to {action} {name!r}; pass --confirm {CONFIRM_CYCLE}")
    if alias is None and not allow_unmapped:
        raise SafetyError(
            f"{name!r} is not in ~/.config/smart-home/config.toml; "
            "add [[device]] allow_cycle = true, or pass --allow-unmapped"
        )
    if alias is not None and not alias.allow_cycle:
        raise SafetyError(f"{alias.name} has allow_cycle = false")


def cycle_device(
    connector: KasaCloudConnector | HomeAssistantConnector,
    device: Device,
    *,
    alias: Alias | None,
    confirm: str | None,
    off_seconds: float,
    allow_unmapped: bool,
    even_if_off: bool,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    require_power_cut_permission(
        name=device.alias,
        alias=alias,
        confirm=confirm,
        allow_unmapped=allow_unmapped,
        action="cycle",
    )
    was_on = connector.get_power(device)
    if not was_on and not even_if_off:
        raise SafetyError(
            f"{device.alias!r} is already off; pass --even-if-off to power it on after"
        )
    connector.set_power(device, False)
    sleep(off_seconds)
    connector.set_power(device, True)
    now_on = connector.get_power(device)
    if not now_on:
        raise SmartHomeError(f"{device.alias!r} did not come back on after cycle")
    return {
        "alias": device.alias,
        "id": device.device_id,
        "off_seconds": off_seconds,
        "was_on": was_on,
        "on": now_on,
    }


def _print(data: Any, as_json: bool) -> None:
    if as_json:
        json.dump(data, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                alias = item.get("alias") or item.get("name")
                extras = {k: v for k, v in item.items() if k != "alias"}
                print(f"{alias}\t{json.dumps(extras, sort_keys=True)}")
            else:
                print(item)
        return
    if isinstance(data, dict):
        for key, value in data.items():
            print(f"{key}: {value}")
        return
    print(data)


def _device_row(device: Device) -> dict[str, Any]:
    return {
        "alias": device.alias,
        "id": device.device_id,
        "connector": device.connector,
        "model": device.model,
        "online": device.online,
        "parent_id": device.parent_id,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="smart-home",
        description="Control smart plugs over authenticated APIs (no LAN broadcast).",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.environ.get("SMART_HOME_CONFIG", str(DEFAULT_CONFIG))),
    )
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("whoami", help="Verify API authentication")
    sub.add_parser("devices", help="List devices from the API")
    energy = sub.add_parser("energy", help="Live watts / volts / amps / kWh")
    energy.add_argument("target")
    for name in ("on", "off"):
        p = sub.add_parser(name, help=f"Turn a device {name}")
        p.add_argument("target")
        p.add_argument("--confirm", default=None)
    cycle = sub.add_parser("cycle", help="Hard-reboot: off, wait, on")
    cycle.add_argument("target")
    cycle.add_argument("--confirm", default=None)
    cycle.add_argument("--off-seconds", type=float, default=DEFAULT_OFF_SECONDS)
    cycle.add_argument("--allow-unmapped", action="store_true")
    cycle.add_argument("--even-if-off", action="store_true")
    status = sub.add_parser("status", help="List devices and energy where available")
    status.add_argument("target", nargs="?")
    setup = sub.add_parser(
        "setup",
        help="Write Kasa credentials to a mode-600 config (not the keychain)",
    )
    setup.add_argument("--username", required=True, help="TP-Link / Kasa account email")
    setup.add_argument(
        "--password",
        default=None,
        help="Kasa password (prefer --password-stdin so it stays out of argv)",
    )
    setup.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read the password from stdin (one line, no prompt)",
    )
    setup.add_argument(
        "--verify",
        action="store_true",
        help="Call Kasa Cloud whoami after writing the file",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "setup":
            return run_setup(args)
        config = load_config(args.config)
        if args.command == "whoami":
            reports = []
            errors = []
            for name in ("kasa", "homeassistant"):
                try:
                    reports.append(build_connector(name, config).whoami())
                except AuthError as exc:
                    errors.append({"connector": name, "error": str(exc)})
            if not reports:
                raise AuthError(
                    "; ".join(item["error"] for item in errors) or "no connectors configured"
                )
            payload: dict[str, Any] = {"ok": reports}
            if errors:
                payload["skipped"] = errors
            _print(payload if args.json else reports, args.json)
            return 0

        if args.command == "devices":
            connector = build_connector(config.default_connector, config)
            rows = [_device_row(d) for d in connector.list_devices()]
            _print(rows, args.json)
            return 0

        if args.command == "energy":
            connector, device, alias = resolve_target(config, args.target)
            if isinstance(connector, HomeAssistantConnector):
                reading = connector.energy(device, alias=alias)
            else:
                reading = connector.energy(device)
            payload = {**_device_row(device), **reading.as_dict()}
            _print(payload, args.json)
            return 0

        if args.command in {"on", "off"}:
            if args.command == "off":
                alias = config.aliases.get(args.target.lower())
                require_power_cut_permission(
                    name=args.target,
                    alias=alias,
                    confirm=args.confirm,
                    allow_unmapped=True,
                    action="turn off",
                )
            connector, device, _alias = resolve_target(config, args.target)
            connector.set_power(device, args.command == "on")
            on = connector.get_power(device)
            _print({**_device_row(device), "on": on}, args.json)
            return 0

        if args.command == "cycle":
            if args.confirm != CONFIRM_CYCLE:
                raise SafetyError(
                    f"refusing to cycle {args.target!r}; pass --confirm {CONFIRM_CYCLE}"
                )
            connector, device, alias = resolve_target(config, args.target)
            result = cycle_device(
                connector,
                device,
                alias=alias,
                confirm=args.confirm,
                off_seconds=args.off_seconds,
                allow_unmapped=args.allow_unmapped,
                even_if_off=args.even_if_off,
            )
            _print(result, args.json)
            return 0

        if args.command == "status":
            if args.target:
                targets = [args.target]
            elif config.aliases:
                targets = [alias.name for alias in config.aliases.values()]
            else:
                connector = build_connector(config.default_connector, config)
                rows = []
                for device in connector.list_devices():
                    row = _device_row(device)
                    try:
                        if isinstance(connector, HomeAssistantConnector):
                            reading = connector.energy(device)
                        else:
                            reading = connector.energy(device)
                        row.update(reading.as_dict())
                    except SmartHomeError as exc:
                        row["energy_error"] = str(exc)
                    rows.append(row)
                _print(rows, args.json)
                return 0
            rows = []
            for target in targets:
                connector, device, alias = resolve_target(config, target)
                row = _device_row(device)
                try:
                    if isinstance(connector, HomeAssistantConnector):
                        reading = connector.energy(device, alias=alias)
                    else:
                        reading = connector.energy(device)
                    row.update(reading.as_dict())
                except SmartHomeError as exc:
                    row["energy_error"] = str(exc)
                rows.append(row)
            _print(rows, args.json)
            return 0

        raise SmartHomeError(f"unhandled command {args.command}")
    except (SmartHomeError, FileNotFoundError) as exc:
        print(f"smart-home: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
