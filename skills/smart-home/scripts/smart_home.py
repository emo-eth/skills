#!/usr/bin/env python3
"""Smart home CLI: Kasa Cloud (IOT) plus unicast KLAP for SMART.KASAPLUG."""

from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import fcntl
import ipaddress
import getpass
import hmac
import hashlib
import json
import os
import re
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
import uuid
import ssl
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlencode

DEFAULT_CONFIG = Path.home() / ".config" / "smart-home" / "config.toml"
KASA_CLOUD_URL = "https://wap.tplinkcloud.com"
APP_SERVER_REGION_URL = "https://n-wap.i.tplinkcloud.com"
APP_SERVER_SERVICE_ID = "nbu.iot-app-server.app-v2"
APP_SERVER_APP = "Kasa_Android_Mix"
APP_SERVER_VERSION = "3.4.703"
APP_SERVER_ACCESS_KEY = "e37525375f8845999bcc56d5e6faa76d"
APP_SERVER_SECRET_KEY = "314bc6700b3140ca80bc655e527cb062"
CONFIRM_CYCLE = "cycle"
DEFAULT_OFF_SECONDS = 8.0
KASA_DEVICE_OFFLINE_CODE = -20571
KASA_AUTH_ERROR_CODES = {-20651, -20600, -20004}
SECRET_SUBPROCESS_TIMEOUT = 10.0
LOCAL_KASA_TIMEOUT = 25.0
_B64_ALIAS = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
_SMART_FAMILY_PREFIX = "SMART."
_INET_RE = re.compile(r"\binet(?:\s+addr:)?\s+(\d+\.\d+\.\d+\.\d+)")
# ASUS guest VLANs for the isolated IoT SSID.
DEFAULT_SCAN_CIDRS = ("192.168.101.0/24", "192.168.102.0/24")


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
    host: str | None = None
    entity_id: str | None = None
    power_entity: str | None = None
    voltage_entity: str | None = None
    energy_entity: str | None = None


# Human host names -> Kasa app aliases. spark0 and spark1 share plug "Sparks".
# SMART.KASAPLUG (KP125M) needs a unicast host for local KLAP; cloud passthrough
# returns -20571 because TP-Link does not tunnel the IOT XOR protocol for them.
DEFAULT_ALIASES = (
    Alias("spark0", "kasa", "Sparks", allow_cycle=True),
    Alias("spark1", "kasa", "Sparks", allow_cycle=True),
    Alias("emo-win", "kasa", "PC", allow_cycle=True),
    Alias("emo-4090", "kasa", "4090", allow_cycle=True),
    Alias("mac-studio", "kasa", "Mac Studio", allow_cycle=False),
    Alias(
        "media-rack",
        "kasa",
        "Media Rack",
        allow_cycle=False,
        host="192.168.50.152",
    ),
)


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
    hosts: dict[str, str] = field(default_factory=dict)
    scan_cidrs: list[str] = field(default_factory=list)
    scan_via: list[str] = field(default_factory=list)
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
            hostname = urllib.parse.urlparse(url).hostname or ""
            context = ssl.create_default_context()
            if hostname.endswith("tplinkcloud.com"):
                ca_bundle = Path(__file__).resolve().parent.parent / "references" / "tplink-ca-chain.pem"
                context.load_verify_locations(cafile=str(ca_bundle))
            with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            return exc.code, payload
        except urllib.error.URLError as exc:
            raise SmartHomeError(f"HTTP request failed: {exc.reason}") from exc


def _run_capture(
    argv: list[str],
    timeout: float = SECRET_SUBPROCESS_TIMEOUT,
    environ: dict[str, str] | None = None,
) -> str:
    try:
        result = subprocess.run(
            argv,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=environ,
        )
    except subprocess.TimeoutExpired as exc:
        raise AuthError(f"{argv[0]} timed out after {timeout}s") from exc
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


def _write_private_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, text.encode("utf-8"))
    finally:
        os.close(fd)
    os.chmod(path, 0o600)


def _write_private_atomic(path: Path, text: str) -> None:
    """Write via a 0600 temp file + os.replace so readers never see a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


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
        existing_devices = list(DEFAULT_ALIASES)
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
    if existing.get("kasa") and isinstance(existing.get("kasa"), dict):
        kasa = existing["kasa"]
        for key in ("url", "scan_cidrs", "scan_via"):
            if key in kasa:
                rendered = _toml_scalar(kasa[key])
                if rendered is None and isinstance(kasa[key], list):
                    inner = ", ".join(_toml_string(str(item)) for item in kasa[key])
                    lines.append(f"{key} = [{inner}]")
                elif rendered is not None:
                    lines.append(f"{key} = {rendered}")
        if any(k in kasa for k in ("url", "scan_cidrs", "scan_via")):
            lines.append("")
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
        if alias.host:
            lines.append(f"host = {_toml_string(alias.host)}")
        if alias.entity_id:
            lines.append(f"entity_id = {_toml_string(alias.entity_id)}")
        if alias.power_entity:
            lines.append(f"power_entity = {_toml_string(alias.power_entity)}")
        if alias.voltage_entity:
            lines.append(f"voltage_entity = {_toml_string(alias.voltage_entity)}")
        if alias.energy_entity:
            lines.append(f"energy_entity = {_toml_string(alias.energy_entity)}")
        lines.append("")
    _write_private_text(path, "\n".join(lines).rstrip() + "\n")


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
        apply_host_index(cfg)
        return cfg

    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path} is not valid TOML") from exc
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
    cfg.scan_cidrs = parse_cidr_list(
        kasa.get("scan_cidrs") if "scan_cidrs" in kasa else kasa.get("extra_cidrs")
    )
    cfg.scan_via = parse_cidr_list(kasa.get("scan_via"))
    for hop in parse_cidr_list(env.get("SMART_HOME_SCAN_VIA")):
        if hop not in cfg.scan_via:
            cfg.scan_via.append(hop)
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
        host = item.get("host")
        cfg.aliases[name.lower()] = Alias(
            name=name,
            connector=connector,
            match=match,
            allow_cycle=bool(item.get("allow_cycle", False)),
            host=str(host).strip() if host else None,
            entity_id=item.get("entity_id"),
            power_entity=item.get("power_entity"),
            voltage_entity=item.get("voltage_entity"),
            energy_entity=item.get("energy_entity"),
        )
    apply_host_index(cfg)
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


def decode_kasa_alias(raw: str) -> str:
    """KP125M / Matter plugs return base64 aliases from Kasa Cloud."""
    text = (raw or "").strip()
    if not text or not _B64_ALIAS.fullmatch(text):
        return text
    if "=" not in text and (len(text) % 4 or len(text) < 8):
        return text
    try:
        decoded = base64.b64decode(text, validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return text
    if not decoded or decoded == text:
        return text
    if not decoded.isprintable() or "\x00" in decoded:
        return text
    if not any(ch.isalnum() for ch in decoded):
        return text
    return decoded


def _hash_password(password: str, encoding: str) -> str:
    if encoding == "plain":
        return password
    if encoding == "md5":
        return hashlib.md5(password.encode("utf-8")).hexdigest().upper()
    raise ConfigError(f"unknown kasa.password_encoding {encoding!r}")




HOSTS_TOML = "hosts.toml"


def normalize_mac(raw: str | None) -> str:
    text = (raw or "").replace(":", "").replace("-", "").replace(".", "").lower()
    return text


def index_host(hosts: dict[str, str], ip: str, *keys: str | None) -> None:
    ip = (ip or "").strip()
    if not ip:
        return
    for key in keys:
        if not key:
            continue
        cleaned = str(key).strip()
        if not cleaned:
            continue
        hosts[cleaned.lower()] = ip
        mac = normalize_mac(cleaned)
        if len(mac) == 12:
            hosts[mac] = ip


def load_host_index(state_dir: Path) -> dict[str, str]:
    data = _read_toml_file(state_dir / HOSTS_TOML)
    mapping = data.get("hosts") if isinstance(data.get("hosts"), dict) else {}
    hosts: dict[str, str] = {}
    for key, value in mapping.items():
        if isinstance(value, str) and value.strip():
            hosts[str(key).strip().lower()] = value.strip()
    for item in data.get("host") or []:
        if not isinstance(item, dict):
            continue
        ip = str(item.get("ip") or item.get("host") or "").strip()
        index_host(
            hosts,
            ip,
            item.get("alias"),
            item.get("match"),
            item.get("device_id"),
            normalize_mac(str(item.get("mac") or "")),
        )
    return hosts


def save_host_index(state_dir: Path, hosts: dict[str, str]) -> None:
    lines = [
        "# Local Kasa IPs. chmod 600. No secrets. Written by `smart-home scan`.",
        "[hosts]",
    ]
    for key in sorted(hosts):
        ip = hosts[key]
        if ip:
            lines.append(f"{_toml_string(key)} = {_toml_string(ip)}")
    lines.append("")
    _write_private_text(state_dir / HOSTS_TOML, "\n".join(lines))


def apply_host_index(cfg: AppConfig) -> None:
    hosts = load_host_index(cfg.state_dir)
    for alias in cfg.aliases.values():
        if alias.host:
            index_host(hosts, alias.host, alias.name, alias.match)
    for alias in DEFAULT_ALIASES:
        if alias.host:
            index_host(hosts, alias.host, alias.name, alias.match)
    cfg.hosts = hosts


def remember_host(config: AppConfig, device: Device, host: str | None) -> None:
    host = (host or "").strip()
    if not host:
        return
    mac = normalize_mac(
        str(device.extras.get("deviceMac") or device.extras.get("mac") or "")
    )
    index_host(
        config.hosts,
        host,
        device.alias,
        device.device_id,
        mac or None,
    )
    save_host_index(config.state_dir, config.hosts)


def parse_cidr_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = [item.strip() for item in value.replace(";", ",").split(",")]
        return [item for item in parts if item]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def ips_from_ifconfig(text: str) -> list[str]:
    return [match.group(1) for match in _INET_RE.finditer(text or "")]


def cidr_from_ipv4(ip: str) -> str | None:
    if not ip or ip.startswith("127.") or ip.startswith("169.254.") or ip.startswith("100."):
        return None
    try:
        packed = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if packed.version != 4 or packed.is_loopback or packed.is_link_local or packed.is_multicast:
        return None
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))


def cidr_broadcasts(cidrs: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for cidr in ["255.255.255.255", *cidrs]:
        if cidr == "255.255.255.255":
            bcast = cidr
        else:
            try:
                bcast = str(ipaddress.ip_network(cidr, strict=False).broadcast_address)
            except ValueError:
                continue
        if bcast not in seen:
            seen.add(bcast)
            out.append(bcast)
    return out


def local_ipv4_cidrs(extra: list[str] | None = None) -> list[str]:
    cidrs: list[str] = []
    seen: set[str] = set()

    def add_ip(ip: str) -> None:
        prefix = cidr_from_ipv4(ip)
        if prefix and prefix not in seen:
            seen.add(prefix)
            cidrs.append(prefix)

    def add_cidr(cidr: str) -> None:
        text = (cidr or "").strip()
        if not text or text in seen:
            return
        try:
            net = ipaddress.ip_network(text, strict=False)
        except ValueError:
            return
        if net.version != 4 or net.num_addresses > 256:
            return
        key = str(net)
        if key not in seen:
            seen.add(key)
            cidrs.append(key)

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        add_ip(sock.getsockname()[0])
        sock.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add_ip(info[4][0])
    except OSError:
        pass
    try:
        blob = subprocess.check_output(["ifconfig"], text=True, timeout=5)
        for ip in ips_from_ifconfig(blob):
            add_ip(ip)
    except (OSError, subprocess.TimeoutExpired):
        try:
            blob = subprocess.check_output(["ip", "-4", "-o", "addr"], text=True, timeout=5)
            for ip in ips_from_ifconfig(blob):
                add_ip(ip)
        except (OSError, subprocess.TimeoutExpired):
            pass
    for cidr in extra or []:
        add_cidr(cidr)
    return cidrs or ["192.168.50.0/24"]


def scan_cidrs_for(config: AppConfig | None = None, extra: list[str] | None = None) -> list[str]:
    configured: list[str] = []
    if config is not None:
        configured.extend(config.scan_cidrs)
    configured.extend(parse_cidr_list(os.environ.get("SMART_HOME_SCAN_CIDRS")))
    if extra:
        configured.extend(extra)
    configured.extend(DEFAULT_SCAN_CIDRS)
    return local_ipv4_cidrs(extra=configured)


def host_is_directly_reachable(ip: str, extra: list[str] | None = None) -> bool:
    """True when *ip* is on a local L3 subnet (not merely a configured scan CIDR)."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.version != 4:
        return False
    for cidr in local_ipv4_cidrs(extra=extra):
        try:
            net = ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            continue
        if addr in net:
            return True
    return False


def scan_via_for(config: AppConfig | None = None) -> list[str]:
    hops: list[str] = []
    seen: set[str] = set()

    def add(raw: str | None) -> None:
        hop = (raw or "").strip()
        if hop and hop not in seen:
            seen.add(hop)
            hops.append(hop)

    if config is not None:
        for hop in config.scan_via:
            add(hop)
    for hop in parse_cidr_list(os.environ.get("SMART_HOME_SCAN_VIA")):
        add(hop)
    return hops


def tcp_open_hosts(cidrs: list[str], port: int = 80, timeout: float = 0.12) -> list[str]:
    ips: list[str] = []
    for cidr in cidrs:
        try:
            net = ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            continue
        if net.num_addresses > 256:
            continue
        ips.extend(str(host) for host in net.hosts())
    open_hosts: list[str] = []

    def probe(ip: str) -> str | None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect((ip, port))
            return ip
        except OSError:
            return None
        finally:
            sock.close()

    if not ips:
        return []
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=64) as pool:
        for ip in pool.map(probe, ips):
            if ip:
                open_hosts.append(ip)
    return open_hosts


def is_smart_kasa_device(device: Device) -> bool:
    family = str(
        device.extras.get("deviceType")
        or device.extras.get("type")
        or ""
    ).upper()
    model = (device.model or "").upper()
    if family.startswith(_SMART_FAMILY_PREFIX):
        return True
    return "KP125M" in model or "P125M" in model


def copy_device(device: Device, **changes: Any) -> Device:
    payload = {
        "connector": device.connector,
        "device_id": device.device_id,
        "alias": device.alias,
        "model": device.model,
        "online": device.online,
        "parent_id": device.parent_id,
        "extras": dict(device.extras),
    }
    payload.update(changes)
    return Device(**payload)


def host_for_device(config: AppConfig, device: Device, needle: str | None = None) -> str | None:
    host = device.extras.get("host")
    if isinstance(host, str) and host.strip():
        return host.strip()
    names = {device.alias.lower(), device.device_id.lower()}
    if needle:
        names.add(needle.lower())
    mac = normalize_mac(
        str(device.extras.get("deviceMac") or device.extras.get("mac") or "")
    )
    if mac:
        names.add(mac)
    alias_pool = list(config.aliases.values()) + list(DEFAULT_ALIASES)
    for alias in alias_pool:
        hit = (
            alias.name.lower() in names
            or alias.match.lower() in names
        )
        if hit:
            names.add(alias.name.lower())
            names.add(alias.match.lower())
            if alias.host:
                return alias.host
    for key in names:
        ip = (config.hosts or {}).get(key)
        if ip:
            return ip
    return None


def parse_klap_state(payload: dict[str, Any]) -> tuple[Device, Energy]:
    """Parse python-kasa `--json state` / internal SMART protocol dump."""
    info = payload.get("get_device_info")
    if not isinstance(info, dict):
        info = payload
    emeter = payload.get("get_emeter_data")
    if not isinstance(emeter, dict):
        emeter = {}
    usage = payload.get("get_energy_usage")
    if not isinstance(usage, dict):
        usage = {}
    if emeter.get("power_mw") is not None:
        watts = float(emeter.get("power_mw") or 0) / 1000.0
        volts = float(emeter.get("voltage_mv") or 0) / 1000.0
        amps = float(emeter.get("current_ma") or 0) / 1000.0
        kwh = float(emeter.get("energy_wh") or 0) / 1000.0
    elif usage.get("current_power") is not None:
        current_power = float(usage.get("current_power") or 0)
        watts = current_power / 1000.0 if current_power > 1000 else current_power
        volts = 0.0
        amps = 0.0
        kwh = float(usage.get("today_energy") or 0) / 1000.0
    else:
        current = payload.get("get_current_power")
        watts = float((current or {}).get("current_power") or 0) if isinstance(current, dict) else 0.0
        volts = 0.0
        amps = 0.0
        kwh = 0.0
    on = info.get("device_on")
    if on is None:
        on = info.get("relay_state")
    alias = decode_kasa_alias(str(info.get("nickname") or info.get("alias") or ""))
    device = Device(
        connector="kasa",
        device_id=str(info.get("device_id") or ""),
        alias=alias or str(info.get("ip") or "klap"),
        model=str(info.get("model") or ""),
        online=True,
        extras={
            "deviceType": info.get("type"),
            "host": info.get("ip"),
            "path": "klap",
        },
    )
    energy = Energy(
        watts=watts,
        volts=volts,
        amps=amps,
        kwh=kwh,
        on=bool(on) if on is not None else None,
        raw={"get_emeter_data": emeter, "get_energy_usage": usage},
    )
    return device, energy


def parse_local_state(
    payload: dict[str, Any], host: str | None = None
) -> tuple[Device, Energy]:
    """SMART KLAP dump or IOT python-kasa sysinfo/emeter dump."""
    if isinstance(payload.get("get_device_info"), dict) or "get_emeter_data" in payload:
        device, energy = parse_klap_state(payload)
        if host:
            extras = dict(device.extras)
            extras["host"] = host
            extras["path"] = extras.get("path") or "klap"
            device = copy_device(device, extras=extras)
        return device, energy
    sysinfo = payload.get("sys_info") if isinstance(payload.get("sys_info"), dict) else {}
    nested = payload.get("system")
    if isinstance(nested, dict) and isinstance(nested.get("get_sysinfo"), dict):
        sysinfo = nested.get("get_sysinfo") or sysinfo
    if sysinfo:
        alias = decode_kasa_alias(str(sysinfo.get("alias") or sysinfo.get("nickname") or ""))
        on = sysinfo.get("relay_state")
        if on is None:
            on = sysinfo.get("device_on")
        device = Device(
            connector="kasa",
            device_id=str(sysinfo.get("deviceId") or sysinfo.get("device_id") or ""),
            alias=alias or str(host or "kasa"),
            model=str(sysinfo.get("model") or sysinfo.get("dev_name") or ""),
            online=True,
            extras={
                "deviceType": str(sysinfo.get("type") or sysinfo.get("mic_type") or "IOT.SMARTPLUGSWITCH"),
                "host": host or sysinfo.get("ip"),
                "mac": sysinfo.get("mac"),
                "deviceMac": normalize_mac(str(sysinfo.get("mac") or "")),
                "path": "local",
            },
        )
        emeter = payload.get("emeter")
        realtime = {}
        if isinstance(emeter, dict):
            realtime = emeter.get("get_realtime") or emeter
        try:
            energy = normalize_emeter(
                {"emeter": {"get_realtime": realtime}} if realtime else payload,
                on=bool(on) if on is not None else None,
            )
        except EnergyUnsupported:
            energy = Energy(watts=0, volts=0, amps=0, kwh=0, on=bool(on) if on is not None else None)
        return device, energy
    device, energy = parse_klap_state(payload)
    if host:
        extras = dict(device.extras)
        extras["host"] = host
        device = copy_device(device, extras=extras)
    return device, energy


REMOTE_KLAP_AGENT = r"""
import asyncio, concurrent.futures, ipaddress, json, socket, sys
cfg = json.load(sys.stdin)
cmd = cfg.get("cmd") or "discover"
user = cfg.get("username") or ""
pw = cfg.get("password") or ""
timeout = float(cfg.get("timeout") or 12)

def emit(obj):
    sys.stdout.write("RESULT:" + json.dumps(obj) + "\n")

def tcp_open(cidrs, port=80, wait=0.15):
    ips = []
    for cidr in cidrs:
        try:
            net = ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            continue
        if net.num_addresses > 256:
            continue
        ips.extend(str(h) for h in net.hosts())
    hits = []
    def probe(ip):
        sock = socket.socket()
        sock.settimeout(wait)
        try:
            sock.connect((ip, port))
            return ip
        except OSError:
            return None
        finally:
            sock.close()
    if not ips:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
        for ip in pool.map(probe, ips):
            if ip:
                hits.append(ip)
    return hits

async def klap_read(host):
    from kasa import Credentials, Device, DeviceConfig
    dev = await asyncio.wait_for(
        Device.connect(config=DeviceConfig(host=host, credentials=Credentials(user, pw))),
        timeout,
    )
    try:
        await asyncio.wait_for(dev.update(), timeout)
        state = getattr(dev, "internal_state", None)
        if isinstance(state, dict) and state.get("get_device_info"):
            return state
        energy = None
        try:
            energy = dev.modules.get("Energy")
        except Exception:
            energy = None
        info = {
            "device_id": getattr(dev, "device_id", "") or "",
            "nickname": getattr(dev, "alias", "") or "",
            "model": getattr(dev, "model", "") or "",
            "type": "SMART.KASAPLUG",
            "device_on": bool(getattr(dev, "is_on", False)),
            "ip": host,
        }
        emeter = {}
        if energy is not None:
            watts = getattr(energy, "current_consumption", None) or 0
            volts = getattr(energy, "voltage", None) or 0
            amps = getattr(energy, "current", None) or 0
            today = getattr(energy, "consumption_today", None) or 0
            emeter = {
                "power_mw": watts * 1000,
                "voltage_mv": volts * 1000,
                "current_ma": amps * 1000,
                "energy_wh": today * 1000,
            }
        return {"get_device_info": info, "get_emeter_data": emeter}
    finally:
        try:
            await dev.disconnect()
        except Exception:
            pass

if cmd == "discover":
    hosts = tcp_open(cfg.get("cidrs") or [])
    out = []
    for host in hosts:
        try:
            out.append({"host": host, "state": asyncio.run(klap_read(host))})
        except Exception as exc:
            out.append({"host": host, "error": type(exc).__name__})
    emit({"hosts": out})
elif cmd == "read":
    host = cfg.get("host") or ""
    try:
        emit({"host": host, "state": asyncio.run(klap_read(host))})
    except Exception as exc:
        emit({"error": type(exc).__name__, "msg": str(exc)[:160]})
        sys.exit(2)
else:
    emit({"error": "unknown_cmd"})
    sys.exit(2)
"""



def ssh_klap_json(
    hop: str,
    payload: dict[str, Any],
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Run REMOTE_KLAP_AGENT on *hop*. Password travels on stdin, never argv."""
    try:
        result = subprocess.run(
            [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=8",
                hop,
                "bash",
                "-lc",
                'py="$HOME/.cache/smart-home/venv/bin/python"; '
                'if [ ! -x "$py" ]; then py=python3; fi; '
                'exec "$py" -u -c "$0"',
                REMOTE_KLAP_AGENT,
            ],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise DeviceOffline(f"ssh {hop} timed out after {timeout}s") from exc
    except FileNotFoundError as exc:
        raise DeviceOffline("ssh is not installed") from exc
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise DeviceOffline(f"ssh {hop} failed: {err[:200] or result.returncode}")
    for line in reversed((result.stdout or "").splitlines()):
        if line.startswith("RESULT:"):
            try:
                data = json.loads(line[7:])
            except json.JSONDecodeError as exc:
                raise DeviceOffline(f"ssh {hop} returned invalid JSON") from exc
            if isinstance(data, dict):
                return data
            raise DeviceOffline(f"ssh {hop} RESULT was not an object")
    raise DeviceOffline(f"ssh {hop} returned no RESULT")


class LocalKasaBackend(Protocol):
    def read(self, host: str, username: str, password: str) -> tuple[Device, Energy]:
        ...

    def set_power(self, host: str, username: str, password: str, on: bool) -> None:
        ...


class PythonKasaBackend:
    """Unicast KLAP via python-kasa (import) or `uvx --from python-kasa kasa`."""

    def __init__(
        self,
        run: Callable[..., str] = _run_capture,
        timeout: float = LOCAL_KASA_TIMEOUT,
        ssh: Callable[..., dict[str, Any]] | None = None,
    ) -> None:
        self.run = run
        self.timeout = timeout
        self.ssh = ssh or ssh_klap_json

    def read(self, host: str, username: str, password: str) -> tuple[Device, Energy]:
        try:
            payload = self._read_library(host, username, password)
        except ImportError:
            payload = self._uvx_json(host, username, password, "state")
        device, energy = parse_local_state(payload, host=host)
        extras = dict(device.extras)
        extras["host"] = host
        return copy_device(device, extras=extras), energy

    def set_power(self, host: str, username: str, password: str, on: bool) -> None:
        try:
            self._set_library(host, username, password, on)
        except ImportError:
            self._uvx_json(host, username, password, "on" if on else "off")

    def discover(
        self,
        username: str,
        password: str,
        cidrs: list[str] | None = None,
    ) -> list[tuple[Device, Energy]]:
        found: dict[str, tuple[Device, Energy]] = {}
        nets = cidrs or local_ipv4_cidrs()
        try:
            payloads = self._discover_library(username, password, nets)
        except ImportError:
            payloads = self._discover_uvx(username, password, nets)
        for host, payload in payloads.items():
            try:
                found[host] = parse_local_state(payload, host=host)
            except (SmartHomeError, TypeError, ValueError, KeyError):
                continue
        identify = PythonKasaBackend(run=self.run, timeout=min(self.timeout, 6.0))
        for ip in tcp_open_hosts(nets, port=80):
            if ip in found:
                continue
            try:
                found[ip] = identify.read(ip, username, password)
            except SmartHomeError:
                continue
        return list(found.values())

    def discover_via(
        self,
        hop: str,
        username: str,
        password: str,
        cidrs: list[str] | None = None,
    ) -> list[tuple[Device, Energy]]:
        payload = self.ssh(
            hop,
            {
                "cmd": "discover",
                "cidrs": cidrs or local_ipv4_cidrs(),
                "username": username,
                "password": password,
                "timeout": min(self.timeout, 12.0),
            },
            timeout=max(self.timeout, 45.0),
        )
        found: list[tuple[Device, Energy]] = []
        for item in payload.get("hosts") or []:
            if not isinstance(item, dict):
                continue
            host = str(item.get("host") or "").strip()
            state = item.get("state")
            if not host or not isinstance(state, dict):
                continue
            try:
                found.append(parse_local_state(state, host=host))
            except (SmartHomeError, TypeError, ValueError, KeyError):
                continue
        return found

    def read_via(
        self, hop: str, host: str, username: str, password: str
    ) -> tuple[Device, Energy]:
        payload = self.ssh(
            hop,
            {
                "cmd": "read",
                "host": host,
                "username": username,
                "password": password,
                "timeout": self.timeout,
            },
            timeout=max(self.timeout, 30.0),
        )
        if payload.get("error"):
            raise DeviceOffline(
                f"KLAP {host} via {hop} failed: {payload.get('error')}"
            )
        state = payload.get("state")
        if not isinstance(state, dict):
            raise DeviceOffline(f"KLAP {host} via {hop} returned no state")
        device, energy = parse_local_state(state, host=host)
        extras = dict(device.extras)
        extras["host"] = host
        extras["via"] = hop
        return copy_device(device, extras=extras), energy

    def _discover_uvx(
        self,
        username: str,
        password: str,
        cidrs: list[str] | None = None,
    ) -> dict[str, dict[str, Any]]:
        # Limited broadcast only. Extra guest CIDRs are covered by TCP :80.
        argv = [
            "uvx",
            "--from",
            "python-kasa",
            "kasa",
            "--json",
            "--username",
            username,
            "discover",
            "detail",
        ]
        try:
            stdout = self.run(
                argv, timeout=max(self.timeout, 20.0), environ=self._kasa_env(username, password)
            )
        except TypeError:
            stdout = self.run(argv)
        except AuthError:
            return {}
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            return {}
        if not isinstance(payload, dict):
            return {}
        return {
            str(host): body
            for host, body in payload.items()
            if isinstance(body, dict)
        }

    def _discover_library(
        self,
        username: str,
        password: str,
        cidrs: list[str] | None = None,
    ) -> dict[str, dict[str, Any]]:
        from kasa import Credentials, Discover  # type: ignore

        async def _go() -> dict[str, dict[str, Any]]:
            out: dict[str, dict[str, Any]] = {}
            devices = await Discover.discover(
                credentials=Credentials(username, password),
                timeout=8,
            )
            for host, dev in (devices or {}).items():
                try:
                    await asyncio.wait_for(dev.update(), 8)
                    state = getattr(dev, "internal_state", None)
                    if isinstance(state, dict) and state:
                        out[str(host)] = state
                    else:
                        info = {
                            "device_id": getattr(dev, "device_id", "") or "",
                            "nickname": getattr(dev, "alias", "") or "",
                            "model": getattr(dev, "model", "") or "",
                            "type": "SMART.KASAPLUG",
                            "device_on": bool(getattr(dev, "is_on", False)),
                            "ip": str(host),
                        }
                        out[str(host)] = {"get_device_info": info}
                except Exception:
                    continue
                finally:
                    try:
                        await dev.disconnect()
                    except Exception:
                        pass
            return out

        return asyncio.run(_go())

    def _kasa_env(self, username: str, password: str) -> dict[str, str]:
        env = os.environ.copy()
        env["KASA_USERNAME"] = username
        env["KASA_PASSWORD"] = password
        return env

    def _uvx_json(
        self, host: str, username: str, password: str, command: str
    ) -> dict[str, Any]:
        argv = [
            "uvx",
            "--from",
            "python-kasa",
            "kasa",
            "--json",
            "--username",
            username,
            "--host",
            host,
            command,
        ]
        try:
            stdout = self.run(
                argv, timeout=self.timeout, environ=self._kasa_env(username, password)
            )
        except TypeError:
            stdout = self.run(argv)
        except AuthError as exc:
            raise DeviceOffline(f"KLAP {host} failed: {exc}") from exc
        if command in {"on", "off"}:
            return {}
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise SmartHomeError(f"python-kasa JSON was invalid from {host}") from exc
        if not isinstance(payload, dict):
            raise SmartHomeError(f"python-kasa JSON from {host} was not an object")
        return payload

    def _read_library(self, host: str, username: str, password: str) -> dict[str, Any]:
        from kasa import Credentials, Device, DeviceConfig  # type: ignore

        async def _go() -> dict[str, Any]:
            config = DeviceConfig(host=host, credentials=Credentials(username, password))
            dev = await asyncio.wait_for(Device.connect(config=config), self.timeout)
            try:
                await asyncio.wait_for(dev.update(), self.timeout)
                state = getattr(dev, "internal_state", None) or {}
                if not isinstance(state, dict) or "get_device_info" not in state:
                    energy_mod = None
                    try:
                        energy_mod = dev.modules.get("Energy")
                    except Exception:
                        energy_mod = None
                    info = {
                        "device_id": getattr(dev, "device_id", "") or "",
                        "nickname": getattr(dev, "alias", "") or "",
                        "model": getattr(dev, "model", "") or "",
                        "type": "SMART.KASAPLUG",
                        "device_on": bool(dev.is_on),
                        "ip": host,
                    }
                    emeter = {}
                    if energy_mod is not None:
                        watts = getattr(energy_mod, "current_consumption", None)
                        volts = getattr(energy_mod, "voltage", None)
                        amps = getattr(energy_mod, "current", None)
                        today = getattr(energy_mod, "consumption_today", None)
                        emeter = {
                            "power_mw": (watts or 0) * 1000,
                            "voltage_mv": (volts or 0) * 1000,
                            "current_ma": (amps or 0) * 1000,
                            "energy_wh": (today or 0) * 1000,
                        }
                    return {"get_device_info": info, "get_emeter_data": emeter}
                return state
            finally:
                await dev.disconnect()

        try:
            return asyncio.run(_go())
        except Exception as exc:
            raise DeviceOffline(f"KLAP {host} failed: {exc}") from exc

    def _set_library(self, host: str, username: str, password: str, on: bool) -> None:
        from kasa import Credentials, Device, DeviceConfig  # type: ignore

        async def _go() -> None:
            config = DeviceConfig(host=host, credentials=Credentials(username, password))
            dev = await asyncio.wait_for(Device.connect(config=config), self.timeout)
            try:
                if on:
                    await asyncio.wait_for(dev.turn_on(), self.timeout)
                else:
                    await asyncio.wait_for(dev.turn_off(), self.timeout)
            finally:
                await dev.disconnect()

        try:
            asyncio.run(_go())
        except ImportError:
            raise
        except Exception as exc:
            raise DeviceOffline(f"KLAP {host} power failed: {exc}") from exc



class KasaCloudConnector:
    name = "kasa"

    def __init__(
        self,
        config: AppConfig,
        transport: HttpTransport | None = None,
        timeout: float = 20.0,
        local: LocalKasaBackend | None = None,
    ) -> None:
        self.config = config
        self.transport = transport or UrlLibTransport()
        self.timeout = timeout
        self._local = local
        self._token: str | None = None
        self._devices: list[Device] | None = None
        self._scanned = False
        self._scan_lock = threading.Lock()
        self._app_session: tuple[str, str] | None = None
        self._app_rows: list[dict[str, Any]] | None = None
        self._session_thread_lock = threading.RLock()
        self._session_lock_depth = 0
        self._terminal = self._load_terminal_uuid()

    def _local_backend(self) -> LocalKasaBackend:
        if self._local is None:
            self._local = PythonKasaBackend()
        return self._local

    def _kasa_user_pass(self) -> tuple[str, str]:
        if not self.config.kasa_username or not self.config.kasa_password:
            raise AuthError(
                "Kasa credentials missing. Set SMART_HOME_KASA_USERNAME and "
                "SMART_HOME_KASA_PASSWORD, or ~/.config/smart-home/config.toml."
            )
        return self.config.kasa_username, self.config.kasa_password

    def _attach_host(self, device: Device, needle: str | None = None) -> Device:
        host = host_for_device(self.config, device, needle)
        if not host or device.extras.get("host") == host:
            return device
        extras = dict(device.extras)
        extras["host"] = host
        extras.setdefault("deviceType", extras.get("deviceType") or "SMART.KASAPLUG")
        return copy_device(device, extras=extras)

    def ensure_local_hosts(self) -> None:
        with self._scan_lock:
            if self._scanned:
                return
            self._scanned = True
            backend = self._local_backend()
            if not callable(getattr(backend, "discover", None)):
                return
            try:
                self.scan()
            except SmartHomeError:
                return

    def scan(self) -> list[Device]:
        username, password = self._kasa_user_pass()
        backend = self._local_backend()
        discover = getattr(backend, "discover", None)
        cidrs = scan_cidrs_for(self.config)
        discovered: list[tuple[Device, Energy]] = []
        if callable(discover):
            try:
                discovered.extend(discover(username, password, cidrs=cidrs))
            except TypeError:
                discovered.extend(discover(username, password))
        discover_via = getattr(backend, "discover_via", None)
        if callable(discover_via):
            for hop in scan_via_for(self.config):
                try:
                    discovered.extend(discover_via(hop, username, password, cidrs=cidrs))
                except SmartHomeError:
                    continue
        found: list[Device] = []
        seen_hosts: set[str] = set()
        for device, _energy in discovered:
            host = host_for_device(self.config, device) or device.extras.get("host")
            if isinstance(host, str) and host.strip():
                host = host.strip()
                if host in seen_hosts:
                    continue
                seen_hosts.add(host)
                remember_host(self.config, device, host)
                extras = dict(device.extras)
                extras["host"] = host
                device = copy_device(device, extras=extras, online=True)
            found.append(device)
        if self._devices is not None:
            self._devices = [self._attach_host(item) for item in self._devices]
        return found

    def _via_read(self, host: str) -> tuple[Device, Energy]:
        username, password = self._kasa_user_pass()
        read_via = getattr(self._local_backend(), "read_via", None)
        last: SmartHomeError | None = None
        if not callable(read_via):
            raise DeviceOffline(f"KLAP {host} is not on a local subnet")
        for hop in scan_via_for(self.config):
            try:
                found, energy = read_via(hop, host, username, password)
                remember_host(self.config, found, host)
                extras = dict(found.extras)
                extras["host"] = host
                extras["via"] = hop
                extras.setdefault("path", "local")
                return copy_device(found, extras=extras, online=True), energy
            except SmartHomeError as exc:
                last = exc
                continue
        if last:
            raise last
        raise DeviceOffline(
            f"KLAP {host} is not on a local subnet and no scan_via hop answered"
        )

    def _local_read(self, device: Device) -> tuple[Device, Energy]:
        self.ensure_local_hosts()
        device = self._attach_host(device)
        host = host_for_device(self.config, device)
        if not host:
            kind = "SMART.KASAPLUG" if is_smart_kasa_device(device) else "Kasa"
            raise DeviceOffline(
                f"{device.alias!r} ({kind}) has no LAN host. "
                "Run `smart-home scan` from a hop that can reach the plug "
                "(kasa.scan_via / SMART_HOME_SCAN_VIA)."
            )
        username, password = self._kasa_user_pass()
        backend = self._local_backend()
        if not host_is_directly_reachable(host) and scan_via_for(self.config):
            return self._via_read(host)
        try:
            found, energy = backend.read(host, username, password)
        except DeviceOffline:
            if scan_via_for(self.config):
                return self._via_read(host)
            raise
        remember_host(self.config, found, host)
        extras = dict(found.extras)
        extras["host"] = host
        extras.setdefault("path", "local")
        return copy_device(found, extras=extras, online=True), energy

    def _load_terminal_uuid(self) -> str:
        path = self.config.state_dir / "kasa-terminal-uuid"
        with self._session_file_lock():
            if path.is_file():
                value = path.read_text(encoding="utf-8").strip()
                if value:
                    os.chmod(path, 0o600)
                    return value
            value = str(uuid.uuid4())
            _write_private_atomic(path, value + "\n")
            return value

    @contextlib.contextmanager
    def _session_file_lock(self):
        """Process + thread lock for kasa-terminal-uuid and kasa-session-cache.json.

        Reentrant within one thread: flock on a second fd would self-deadlock.
        """
        with self._session_thread_lock:
            if self._session_lock_depth:
                self._session_lock_depth += 1
                try:
                    yield
                finally:
                    self._session_lock_depth -= 1
                return
            lock = self.config.state_dir / "kasa-session-cache.lock"
            self.config.state_dir.mkdir(parents=True, exist_ok=True)
            fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o600)
            try:
                os.chmod(lock, 0o600)
                fcntl.flock(fd, fcntl.LOCK_EX)
                self._session_lock_depth = 1
                try:
                    yield
                finally:
                    self._session_lock_depth = 0
            finally:
                os.close(fd)

    def _session_key(self) -> str:
        raw = f"{self.config.kasa_username or ''}\0{self.config.kasa_url}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _read_session_file(self) -> dict[str, Any]:
        path = self.config.state_dir / "kasa-session-cache.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _cached_session(self, kind: str) -> dict[str, Any] | None:
        entry = self._read_session_file().get(self._session_key())
        session = entry.get(kind) if isinstance(entry, dict) else None
        if (
            isinstance(session, dict)
            and isinstance(session.get("token"), str)
            and session["token"]
            and session.get("terminal_uuid") == self._terminal
        ):
            return session
        return None

    def _store_session(self, kind: str, session: dict[str, Any] | None) -> None:
        """Caller holds _session_file_lock. None removes the entry."""
        data = self._read_session_file()
        key = self._session_key()
        entry = data.get(key) if isinstance(data.get(key), dict) else {}
        if session is None:
            entry.pop(kind, None)
        else:
            entry[kind] = {**session, "terminal_uuid": self._terminal, "saved_at": time.time()}
        data[key] = entry
        _write_private_atomic(
            self.config.state_dir / "kasa-session-cache.json", json.dumps(data, indent=2) + "\n"
        )

    def _drop_session(self, kind: str, token: str | None) -> None:
        """Forget a rejected token unless another process already replaced it."""
        with self._session_file_lock():
            cached = self._cached_session(kind)
            if cached is not None and cached.get("token") == token:
                self._store_session(kind, None)

    def _cloud(self, payload: dict[str, Any], url: str | None = None) -> dict[str, Any]:
        token = self._token
        try:
            return self._cloud_once(payload, url, token)
        except AuthError:
            if not token:
                raise
        self._relogin_cloud(token)
        return self._cloud_once(payload, url, self._token)

    def _cloud_once(
        self, payload: dict[str, Any], url: str | None, token: str | None
    ) -> dict[str, Any]:
        target = url or self.config.kasa_url
        if token:
            sep = "&" if "?" in target else "?"
            target = f"{target}{sep}{urlencode({'token': token})}"
        body = json.dumps(payload).encode("utf-8")
        status, text = self.transport.request(
            "POST",
            target,
            {"Content-Type": "application/json"},
            body,
            self.timeout,
        )
        if status in (401, 403):
            raise AuthError(f"Kasa cloud HTTP {status}")
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

    def _relogin_cloud(self, rejected: str) -> None:
        """Replace a rejected legacy token: adopt a newer cached one, else log in once."""
        with self._session_file_lock():
            cached = self._cached_session("cloud")
            if cached is not None and cached["token"] != rejected:
                self._token = cached["token"]
                return
            self.login()

    def login(self) -> dict[str, Any]:
        if not self.config.kasa_username or not self.config.kasa_password:
            raise AuthError(
                "Kasa credentials missing. Set SMART_HOME_KASA_USERNAME and "
                "SMART_HOME_KASA_PASSWORD, or ~/.config/smart-home/config.toml "
                "with password_env / password_op / password_keychain."
            )
        with self._session_file_lock():
            self._token = None
            result = self._cloud_once(
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
                },
                None,
                None,
            )
            token = result.get("token")
            if not token:
                raise AuthError("Kasa login succeeded without a token")
            self._token = str(token)
            self._store_session("cloud", {"token": self._token})
        self._devices = None
        return {"account": self.config.kasa_username, "connector": self.name}

    def whoami(self) -> dict[str, Any]:
        info = self.login()
        devices = self.list_devices()
        info["device_count"] = len(devices)
        return info

    def _ensure_login(self) -> None:
        if self._token:
            return
        with self._session_file_lock():
            cached = self._cached_session("cloud")
            if cached is not None:
                self._token = cached["token"]
                return
            self.login()

    def _app_signed_post(
        self, host: str, path: str, payload: dict[str, Any], term: str,
        token: str | None = None,
    ) -> dict[str, Any]:
        text = json.dumps(payload, separators=(",", ":"))
        content_md5 = base64.b64encode(hashlib.md5(text.encode()).digest()).decode()
        nonce = str(uuid.uuid4())
        signature = hmac.new(
            APP_SERVER_SECRET_KEY.encode(),
            f"{content_md5}\n9999999999\n{nonce}\n{path}".encode(),
            hashlib.sha1,
        ).hexdigest()
        params = {
            "appName": APP_SERVER_APP, "appVer": APP_SERVER_VERSION,
            "netType": "wifi", "termID": term, "ospf": "Android 14",
            "brand": "TPLINK", "locale": "en_US", "model": "Pixel",
            "termName": "Pixel", "termMeta": "Pixel",
        }
        if token:
            params["token"] = token
        url = host.rstrip("/") + path + "?" + urlencode(params)
        headers = {
            "Content-Type": "application/json;charset=UTF-8",
            "Content-MD5": content_md5,
            "X-Authorization": (
                f"Timestamp=9999999999, Nonce={nonce}, "
                f"AccessKey={APP_SERVER_ACCESS_KEY}, Signature={signature}"
            ),
        }
        status, response_text = self.transport.request(
            "POST", url, headers, text.encode(), self.timeout
        )
        return self._app_response(status, response_text)

    @staticmethod
    def _app_response(status: int, text: str) -> dict[str, Any]:
        if status in (401, 403):
            raise AuthError(f"Kasa app-server HTTP {status}")
        try:
            data = json.loads(text) if text else {}
        except json.JSONDecodeError as exc:
            raise SmartHomeError(f"Kasa app-server returned HTTP {status} non-JSON") from exc
        if status >= 400:
            raise SmartHomeError(f"Kasa app-server HTTP {status}")
        if not isinstance(data, dict):
            raise SmartHomeError("Kasa app-server returned an invalid response")
        code = data.get("error_code", 0)
        if code:
            if code in KASA_AUTH_ERROR_CODES:
                raise AuthError(f"Kasa app-server auth failed (error_code {code})")
            raise SmartHomeError(f"Kasa app-server error_code {code}")
        return data

    def _app_auth(self) -> tuple[str, str]:
        """(app_host, token): memory, then disk cache, then one app-server login."""
        if self._app_session is not None:
            return self._app_session
        with self._session_file_lock():
            cached = self._cached_session("app")
            if cached is None or not isinstance(cached.get("app_host"), str):
                cached = self._app_login()
                self._store_session("app", cached)
            self._app_session = (cached["app_host"], cached["token"])
        return self._app_session

    def _relogin_app(self, rejected: str) -> tuple[str, str]:
        """Replace a rejected app-server token: adopt a newer one, else log in once."""
        with self._session_file_lock():
            if self._app_session is not None and self._app_session[1] != rejected:
                return self._app_session
            cached = self._cached_session("app")
            if cached is None or cached["token"] == rejected:
                cached = self._app_login()
                self._store_session("app", cached)
            self._app_session = (cached["app_host"], cached["token"])
            return self._app_session

    def _app_request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        host, token = self._app_auth()
        try:
            return self._app_request_once(method, host, path, token, body)
        except AuthError:
            host, token = self._relogin_app(token)
        return self._app_request_once(method, host, path, token, body)

    def _app_request_once(
        self, method: str, host: str, path: str, token: str, body: dict[str, Any] | None
    ) -> dict[str, Any]:
        term = self._terminal
        headers = {
            "Authorization": f"ut|{token}",
            "app-cid": f"app:{APP_SERVER_APP}:{term}",
            "x-app-name": APP_SERVER_APP, "x-app-version": "3.20.753",
            "x-term-id": term, "x-ospf": "Android 14", "x-net-type": "wifi",
            "x-strict": "0", "x-locale": "en_US",
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        status, text = self.transport.request(
            method, host.rstrip("/") + path, headers, data, self.timeout
        )
        return self._app_response(status, text)

    def _app_login(self) -> dict[str, Any]:
        """One app-server login with the persisted terminal UUID. Returns the cacheable session."""
        username, password = self._kasa_user_pass()
        term = self._terminal
        status = self._app_signed_post(
            APP_SERVER_REGION_URL, "/api/v2/account/getAccountStatusAndUrl",
            {"appType": APP_SERVER_APP, "cloudUserName": username}, term,
        )
        regional = (status.get("result") or {}).get("appServerUrl") or APP_SERVER_REGION_URL
        if self.config.kasa_password_encoding == "md5":
            password = hashlib.md5(password.encode()).hexdigest().upper()
        elif self.config.kasa_password_encoding != "plain":
            raise ConfigError("unsupported Kasa password_encoding")
        login = self._app_signed_post(
            str(regional), "/api/v2/account/login",
            {"appType": APP_SERVER_APP, "appVersion": APP_SERVER_VERSION,
             "cloudPassword": password, "cloudUserName": username, "platform": "Android",
             "refreshTokenNeeded": True, "supportBindAccount": False,
             "terminalUUID": term, "terminalName": "Pixel", "terminalMeta": "Pixel"},
            term,
        )
        result = login.get("result") or {}
        token = result.get("token")
        if not token:
            raise AuthError("Kasa app-server login returned no token")
        service = self._app_signed_post(
            str(regional), "/api/v2/common/getAppServiceUrl",
            {"serviceIds": [APP_SERVER_SERVICE_ID]}, term, str(token),
        )
        urls = (service.get("result") or {}).get("serviceUrls") or {}
        app_host = urls.get(APP_SERVER_SERVICE_ID)
        if not app_host:
            raise SmartHomeError("Kasa app-server URL is missing")
        session: dict[str, Any] = {
            "app_host": str(app_host), "regional_url": str(regional), "token": str(token),
        }
        if result.get("refreshToken"):
            session["refresh_token"] = str(result["refreshToken"])
        return session

    def _app_inventory(self) -> list[dict[str, Any]]:
        if self._app_rows is not None:
            return self._app_rows
        response = self._app_request(
            "GET",
            "/v2/things?page=0&pageSize=100&includeKasaShareDevices=true&includeMatterDevice=true",
        )
        result = response.get("result") if isinstance(response.get("result"), dict) else response
        data = result.get("data") if isinstance(result, dict) else None
        if not isinstance(data, list):
            raise SmartHomeError("Kasa app-server inventory has no data list")
        self._app_rows = [item for item in data if isinstance(item, dict)]
        return self._app_rows

    @staticmethod
    def _app_shadow_on(response: dict[str, Any], device_id: str) -> tuple[bool | None, int | None]:
        result = response.get("result")
        wrapper = result if isinstance(result, dict) else response
        shadows = wrapper.get("shadows") if isinstance(wrapper, dict) else None
        if not isinstance(shadows, list):
            return None, None
        shadow = next((item for item in shadows if isinstance(item, dict)
                       and item.get("thingName") == device_id), None)
        if shadow is None:
            return None, None
        state = shadow.get("state")
        reported = state.get("reported") if isinstance(state, dict) else None
        on = reported.get("on") if isinstance(reported, dict) else None
        version = shadow.get("version")
        return (on if isinstance(on, bool) else None,
                version if isinstance(version, int) and not isinstance(version, bool) else None)

    def _app_shadow(
        self, device: Device, inventory: list[dict[str, Any]] | None = None,
    ) -> tuple[bool | None, int | None]:
        rows = self._app_inventory() if inventory is None else inventory
        item = next((row for row in rows
                     if (row.get("thingName") or row.get("deviceId")) == device.device_id), None)
        if item is None or item.get("status") != 1:
            raise DeviceOffline(f"{device.alias!r} is not online in Kasa app-server inventory")
        query = urllib.parse.quote(device.device_id, safe="")
        for path in (f"/v1/things/matter/shadows?thingNames={query}",
                     f"/v1/things/shadows?thingNames={query}"):
            response = self._app_request("GET", path)
            on, version = self._app_shadow_on(response, device.device_id)
            if on is not None:
                return on, version
        return None, None

    def list_devices(self) -> list[Device]:
        self._ensure_login()
        if self._devices is not None:
            return self._devices
        result = self._cloud({"method": "getDeviceList"})
        devices: list[Device] = []
        for item in result.get("deviceList") or []:
            parent = Device(
                connector=self.name, device_id=str(item.get("deviceId") or ""),
                alias=decode_kasa_alias(str(item.get("alias") or item.get("deviceName") or "")),
                model=str(item.get("deviceModel") or ""), online=item.get("status") == 1,
                extras={"appServerUrl": item.get("appServerUrl"),
                        "deviceType": item.get("deviceType"),
                        "deviceMac": item.get("deviceMac"), "mac": item.get("deviceMac")},
            )
            devices.append(parent)
            if parent.online and not is_smart_kasa_device(parent):
                devices.extend(self._expand_children(parent))
        app_rows: list[dict[str, Any]] = []
        need_app = bool(self.config.aliases) and (
            not devices
            or any(is_smart_kasa_device(item) and not item.online for item in devices)
        )
        if need_app:
            try:
                app_rows = self._app_inventory()
            except SmartHomeError:
                app_rows = []
        app_by_id: dict[str, dict[str, Any]] = {}
        for row in app_rows:
            device_id = str(row.get("thingName") or row.get("deviceId") or "")
            if device_id:
                app_by_id[device_id] = row
        known_ids = {device.device_id for device in devices}
        merged: list[Device] = []
        for device in devices:
            row = app_by_id.get(device.device_id)
            if row is not None and is_smart_kasa_device(device) and row.get("status") == 1:
                device = copy_device(device, online=True)
            merged.append(device)
        for row in app_rows:
            device_id = str(row.get("thingName") or row.get("deviceId") or "")
            model = str(row.get("model") or row.get("deviceModel") or "")
            device_type = str(row.get("deviceType") or "")
            if not device_id or device_id in known_ids:
                continue
            candidate = Device(self.name, device_id, "", model=model,
                               extras={"deviceType": device_type})
            if not is_smart_kasa_device(candidate):
                continue
            alias_name = str(row.get("nickname") or row.get("alias")
                             or row.get("deviceName") or device_id)
            merged.append(Device(self.name, device_id, decode_kasa_alias(alias_name),
                                 model=model, online=row.get("status") == 1,
                                 extras={"deviceType": device_type, "app_server": True}))
            known_ids.add(device_id)
        attached: list[Device] = []
        for device in merged:
            device = self._attach_host(device)
            if device.extras.get("host"):
                device = copy_device(device, online=True)
            attached.append(device)
        self._devices = attached
        return attached
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
        return decode_passthrough(self._cloud(payload, url=url))

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
                    alias=decode_kasa_alias(str(child.get("alias") or full_id)),
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
        alias = self.config.aliases.get(needle.lower())
        match = alias.match if alias else needle
        try:
            device = self._find(self.list_devices(), match)
        except DeviceNotFound:
            host = (alias.host if alias else None) or host_for_device(
                self.config, Device("kasa", needle, needle), needle
            )
            if host:
                label = alias.match if alias else needle
                if alias is None:
                    for da in DEFAULT_ALIASES:
                        if (
                            da.name.lower() == needle.lower()
                            or da.match.lower() == needle.lower()
                        ):
                            label = da.match
                            break
                return Device(self.name, needle, label, model="KP125M", online=True,
                              extras={"host": host, "deviceType": "SMART.KASAPLUG",
                                      "path": "klap"})
            raise
        return self._attach_host(device, needle)

    def _smart_without_host(self, device: Device) -> DeviceOffline:
        kind = "SMART.KASAPLUG" if is_smart_kasa_device(device) else "Kasa"
        return DeviceOffline(
            f"{device.alias!r} ({kind}) has no LAN host. "
            "Run `smart-home scan` from a hop that can reach the plug "
            "(kasa.scan_via / SMART_HOME_SCAN_VIA)."
        )

    def _app_shadow_power(self, device: Device) -> bool:
        on, _version = self._app_shadow(device)
        if on is None:
            raise DeviceOffline(f"{device.alias!r} has no boolean app-server shadow state")
        return on

    def get_power(self, device: Device) -> bool:
        device = self._attach_host(device)
        if device.extras.get("app_server"):
            return self._app_shadow_power(device)
        if is_smart_kasa_device(device):
            host = host_for_device(self.config, device)
            if host:
                try:
                    _, energy = self._local_read(device)
                    if energy.on is not None:
                        return bool(energy.on)
                except DeviceOffline:
                    if device.online is False:
                        raise
                except SmartHomeError:
                    pass
            elif device.online is False:
                raise self._smart_without_host(device)
            return self._app_shadow_power(device)
        host = host_for_device(self.config, device)
        if host:
            try:
                _, energy = self._local_read(device)
                if energy.on is not None:
                    return bool(energy.on)
            except SmartHomeError:
                pass
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
        device = self._attach_host(device)
        if device.extras.get("app_server"):
            self._app_set_power(device, on)
            return
        if is_smart_kasa_device(device):
            host = host_for_device(self.config, device)
            if host:
                try:
                    username, password = self._kasa_user_pass()
                    self._local_backend().set_power(host, username, password, on)
                    return
                except DeviceOffline:
                    if device.online is False:
                        raise
                except SmartHomeError:
                    pass
            elif device.online is False:
                raise self._smart_without_host(device)
            self._app_set_power(device, on)
            return
        host = host_for_device(self.config, device)
        if host:
            try:
                username, password = self._kasa_user_pass()
                self._local_backend().set_power(host, username, password, on)
                return
            except SmartHomeError:
                pass
        request: dict[str, Any] = {"system": {"set_relay_state": {"state": 1 if on else 0}}}
        if device.parent_id:
            request["context"] = {"child_ids": [device.device_id]}
        self._passthrough(device, request)
    def _app_set_power(self, device: Device, on: bool) -> bool:
        inventory = self._app_inventory()
        state, version = self._app_shadow(device, inventory=inventory)
        if state is None or version is None:
            raise DeviceOffline(f"{device.alias!r} has no valid app-server shadow")
        path = f"/v1/things/{urllib.parse.quote(device.device_id, safe='')}/matter/shadows"
        self._app_request(
            "PATCH", path, {"version": version + 1, "state": {"desired": {"on": on}}}
        )
        observed, _version = self._app_shadow(device, inventory=inventory)
        if observed is not on:
            raise SmartHomeError(
                f"{device.alias!r} app-server read-back mismatch: requested {on}, reported {observed}"
            )
        return observed
    def energy(self, device: Device) -> Energy:
        device = self._attach_host(device)
        if device.extras.get("app_server"):
            on = self._app_shadow_power(device)
            return Energy(watts=0.0, volts=0.0, amps=0.0, kwh=0.0, on=on, raw={})
        if is_smart_kasa_device(device):
            host = host_for_device(self.config, device)
            if host:
                try:
                    _, energy = self._local_read(device)
                    return energy
                except DeviceOffline:
                    if device.online is False:
                        raise
                except SmartHomeError:
                    pass
            elif device.online is False:
                raise self._smart_without_host(device)
            on = self._app_shadow_power(device)
            return Energy(watts=0.0, volts=0.0, amps=0.0, kwh=0.0, on=on, raw={})
        host = host_for_device(self.config, device)
        if host:
            try:
                _, energy = self._local_read(device)
                return energy
            except SmartHomeError:
                pass
        request: dict[str, Any] = {"emeter": {"get_realtime": {}}}
        if device.parent_id:
            request["context"] = {"child_ids": [device.device_id]}
        payload = self._passthrough(device, request)
        on = None
        try:
            on = self.get_power(device)
        except SmartHomeError:
            on = None
        try:
            return normalize_emeter(payload, on=on)
        except EnergyUnsupported:
            if on is None:
                raise
            return Energy(watts=0.0, volts=0.0, amps=0.0, kwh=0.0, on=on, raw=payload)


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
    config: AppConfig,
    needle: str,
    transport: HttpTransport | None = None,
    connectors: dict[str, KasaCloudConnector | HomeAssistantConnector] | None = None,
) -> tuple[KasaCloudConnector | HomeAssistantConnector, Device, Alias | None]:
    alias = config.aliases.get(needle.lower())
    connector_name = alias.connector if alias else config.default_connector
    connector: KasaCloudConnector | HomeAssistantConnector | None = None
    if connectors is not None:
        connector = connectors.get(connector_name)
    if connector is None:
        connector = build_connector(connector_name, config, transport=transport)
        if connectors is not None:
            connectors[connector_name] = connector
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
    if name.strip().lower() in {"mac studio", "mac-studio"} or (
        alias is not None and alias.match.strip().lower() == "mac studio"
    ):
        raise SafetyError("refusing to turn off or cycle the Mac Studio plug")
    if confirm != CONFIRM_CYCLE:
        raise SafetyError(f"refusing to {action} {name!r}; pass --confirm {CONFIRM_CYCLE}")
    if alias is None and not allow_unmapped:
        raise SafetyError(
            f"{name!r} is not in ~/.config/smart-home/config.toml; "
            "add [[device]] allow_cycle = true, or pass --allow-unmapped"
        )
    if alias is not None and not alias.allow_cycle:
        raise SafetyError(f"{alias.name} has allow_cycle = false")


CYCLE_RECOVERY_DELAY_SECONDS = 2.0


class CycleFailed(SmartHomeError):
    def __init__(self, message: str, payload: dict[str, Any]):
        super().__init__(message)
        self.payload = payload


def _recover_power(
    connector: KasaCloudConnector | HomeAssistantConnector,
    device: Device,
    sleep: Callable[[float], None],
) -> dict[str, Any]:
    result: dict[str, Any] = {"attempted": True}
    try:
        sleep(CYCLE_RECOVERY_DELAY_SECONDS)
        connector.set_power(device, True)
    except BaseException as exc:
        result["on_error"] = str(exc) or type(exc).__name__
    try:
        result["on"] = connector.get_power(device)
    except BaseException as exc:
        result["on"] = None
        result["readback_error"] = str(exc) or type(exc).__name__
    return result


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
    try:
        connector.set_power(device, False)
    except BaseException as off_exc:
        # The relay may already be cut even though the call failed (timeout,
        # dropped connection, bad read-back). Always try to restore power.
        recovery = _recover_power(connector, device, sleep)
        if not isinstance(off_exc, Exception):
            raise
        raise CycleFailed(
            f"{device.alias!r} off failed: {off_exc}; recovery on "
            + ("succeeded" if recovery.get("on") is True else "did not verify"),
            {
                "alias": device.alias,
                "id": device.device_id,
                "ok": False,
                "off_error": str(off_exc),
                "recovery": recovery,
            },
        ) from off_exc
    try:
        sleep(off_seconds)
        connector.set_power(device, True)
    except BaseException:
        try:
            connector.set_power(device, True)
        except Exception:
            pass
        raise
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
    row = {
        "alias": device.alias,
        "id": device.device_id,
        "connector": device.connector,
        "model": device.model,
        "online": device.online,
        "parent_id": device.parent_id,
    }
    host = device.extras.get("host")
    if isinstance(host, str) and host.strip():
        row["host"] = host.strip()
    path = device.extras.get("path")
    if isinstance(path, str) and path.strip():
        row["path"] = path.strip()
    return row


def collect_whoami(
    config: AppConfig, transport: HttpTransport | None = None
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    reports: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for name in ("kasa", "homeassistant"):
        try:
            reports.append(build_connector(name, config, transport=transport).whoami())
        except SmartHomeError as exc:
            errors.append({"connector": name, "error": str(exc)})
    return reports, errors


def energy_row(
    connector: KasaCloudConnector | HomeAssistantConnector,
    device: Device,
    alias: Alias | None = None,
) -> dict[str, Any]:
    row = _device_row(device)
    try:
        if isinstance(connector, HomeAssistantConnector):
            reading = connector.energy(device, alias=alias)
        else:
            reading = connector.energy(device)
        row.update(reading.as_dict())
        if (
            reading.watts == 0
            and reading.volts == 0
            and reading.amps == 0
            and reading.kwh == 0
            and reading.on is not None
        ):
            row["energy_supported"] = False
    except EnergyUnsupported as exc:
        row["energy_error"] = str(exc)
        try:
            row["on"] = connector.get_power(device)
        except SmartHomeError:
            pass
    except SmartHomeError as exc:
        row["energy_error"] = str(exc)
        try:
            row["on"] = connector.get_power(device)
        except SmartHomeError:
            pass
    return row


def energy_rows_for_devices(
    connector: KasaCloudConnector | HomeAssistantConnector,
    devices: list[Device],
    workers: int = 8,
) -> list[dict[str, Any]]:
    if len(devices) <= 1:
        return [energy_row(connector, device) for device in devices]
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(workers, len(devices))) as pool:
        return list(pool.map(lambda device: energy_row(connector, device), devices))


def status_rows_for_targets(
    config: AppConfig,
    targets: list[str],
    transport: HttpTransport | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    connectors: dict[str, KasaCloudConnector | HomeAssistantConnector] = {}
    for target in targets:
        try:
            connector, device, alias = resolve_target(
                config, target, transport=transport, connectors=connectors
            )
        except SmartHomeError as exc:
            rows.append({"alias": target, "error": str(exc)})
            continue
        rows.append(energy_row(connector, device, alias))
    return rows


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="smart-home",
        description="Control smart plugs over Kasa Cloud (IOT) or unicast KLAP (SMART.KASAPLUG).",
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
    sub.add_parser("scan", help="Discover local Kasa IPs and write hosts.toml")
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
            reports, errors = collect_whoami(config)
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
            rows = []
            for device in connector.list_devices():
                row = _device_row(device)
                if is_smart_kasa_device(device):
                    try:
                        row["on"] = connector.get_power(device)
                    except SmartHomeError as exc:
                        row["state_error"] = str(exc)
                rows.append(row)
            _print(rows, args.json)
            return 0

        if args.command == "scan":
            connector = build_connector(config.default_connector, config)
            if not isinstance(connector, KasaCloudConnector):
                raise ConfigError("scan is implemented for the Kasa connector")
            found = connector.scan()
            payload = {
                "hosts_file": str(config.state_dir / HOSTS_TOML),
                "devices": [_device_row(device) for device in found],
            }
            _print(payload, args.json)
            return 0

        if args.command == "energy":
            connector, device, alias = resolve_target(config, args.target)
            payload = energy_row(connector, device, alias)
            _print(payload, args.json)
            return 0 if "watts" in payload or "on" in payload else 2


        if args.command in {"on", "off"}:
            alias = config.aliases.get(args.target.lower())
            if args.command == "off":
                require_power_cut_permission(
                    name=args.target, alias=alias, confirm=args.confirm,
                    allow_unmapped=False, action="turn off",
                )
            connector, device, _alias = resolve_target(config, args.target)
            connector.set_power(device, args.command == "on")
            on = connector.get_power(device)
            _print({**_device_row(device), "on": on}, args.json)
            return 0

        if args.command == "cycle":
            alias = config.aliases.get(args.target.lower())
            if args.confirm != CONFIRM_CYCLE:
                raise SafetyError(
                    f"refusing to cycle {args.target!r}; pass --confirm {CONFIRM_CYCLE}"
                )
            connector, device, alias = resolve_target(config, args.target)
            result = cycle_device(
                connector, device, alias=alias, confirm=args.confirm,
                off_seconds=args.off_seconds, allow_unmapped=args.allow_unmapped,
                even_if_off=args.even_if_off,
            )
            _print(result, args.json)
            return 0

        if args.command == "status":
            if args.target:
                rows = status_rows_for_targets(config, [args.target])
                _print(rows, args.json)
                return 0
            connector = build_connector(config.default_connector, config)
            seen: set[str] = set()
            devices: list[Device] = []
            for device in connector.list_devices():
                key = device.device_id or device.alias
                if key in seen:
                    continue
                seen.add(key)
                devices.append(device)
            rows = energy_rows_for_devices(connector, devices)
            _print(rows, args.json)
            return 0

        raise SmartHomeError(f"unhandled command {args.command}")
    except CycleFailed as exc:
        print(f"smart-home: {exc}", file=sys.stderr)
        if args.json:
            _print(exc.payload, True)
        return 2
    except (SmartHomeError, FileNotFoundError) as exc:
        print(f"smart-home: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
