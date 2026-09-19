# Smart home connectors (EMO-474)

Date: 2026-09-18
Parent: [EMO-474](https://linear.app/emo-eth/issue/EMO-474/setup-smart-home-connectors-on-studio-kasa-power-cycling-and-power)

## What landed

`skills/smart-home/` is an API-only connector skill. Agents call `scripts/smart-home` for `whoami`, `devices`, `energy`, `on`/`off`, and `cycle`. Kasa Cloud (`https://wap.tplinkcloud.com` login + `getDeviceList` + `passthrough`) is the default path so isolated-SSID plugs are reachable without LAN broadcast. Home Assistant REST is the second connector. Secrets stay in env, `op://` refs, macOS keychain, or a mode-`600` file under `~/.config/smart-home/` written by `smart-home setup` — never in git. Keychain/`sudo security` fails on studio agent sessions (`User interaction is not allowed`).

## Studio check (2026-09-18)

- Host is studio (`emo-studio`, LAN `192.168.50.221/24`, tailscale `100.116.12.42`).
- No Home Assistant on `:8123`. `python-kasa` is not installed. 1Password CLI has no session. No Kasa keychain item. No `SMART_HOME_*` / `KASA_*` env vars.
- Live CLI on studio:

```
$ ./skills/smart-home/scripts/smart-home --json whoami
smart-home: Kasa credentials missing. Set SMART_HOME_KASA_USERNAME and SMART_HOME_KASA_PASSWORD, or ~/.config/smart-home/config.toml with password_env / password_op / password_keychain.; Home Assistant credentials missing. Set SMART_HOME_HA_URL and SMART_HOME_HA_TOKEN, or [homeassistant] in config.toml.
# exit 2
```

Cloud API is the reachable control plane. Live wattage still needs TP-Link credentials in the local store.

## Proof

- `python3 skills/smart-home/tests/test_smart_home.py` — tests for HTTPS-only Kasa login/list/energy, HS300 child cycle, HA watts + toggle, cycle confirm, chmod-600 secrets, env vs `op read`.

## Credential store (2026-09-19)

`sudo security add-generic-password` fails with `User interaction is not allowed` (sudo + non-GUI keychain). Interactive `setup --password-stdin` used `sys.stdin.read()` and hung waiting for EOF (Ctrl-D). Setup now uses a hidden `getpass` prompt on a TTY, and one line (`readline`) when piped.

```
./skills/smart-home/scripts/smart-home setup --username EMAIL --verify
```

That writes `~/.config/smart-home/config.toml` mode 600.

## PR review fixes (2026-09-19)

- Kasa cloud `-20571` is `DeviceOffline`, not `AuthError`.
- `off` requires `--confirm cycle` and refuses `allow_cycle = false`.
- Offline parents skip child `get_sysinfo` passthrough.
- `write_local_config` keeps an existing `[homeassistant]` table.

## Live proof (2026-09-19)

`~/.config/smart-home/config.toml` mode 600, Kasa Cloud login succeeded.

```
$ ./skills/smart-home/scripts/smart-home --json whoami
{"ok":[{"account":"wenzel.james.r@gmail.com","connector":"kasa","device_count":16}],"skipped":[{"connector":"homeassistant","error":"..."}]}
```

16 plugs. KP125M aliases arrive as base64 (`U3Bhcmtz` → Sparks, `UEM=` → PC, `NDA5MA==` → 4090) and are decoded. Placeholder aliases `spark0` / `emo-win` are not Kasa names.

Live wattage (EP25, isolated-SSID via cloud, no LAN broadcast):

| alias | model | on | watts | volts | amps | kWh |
| --- | --- | --- | --- | --- | --- | --- |
| Entertainment | EP25(US) | true | 174.358 | 121.88 | 1.605 | 120.377 |
| Studio Desk | EP25(US) | true | 206.531 | 121.734 | 1.993 | 29.081 |
| Mac Studio | EP25(US) | true | 34.375 | 122.635 | 0.281 | 16.266 |

HS103/HS105 (`Mix Cubes`, `Monitors`, `Bed Cooler`) return `emeter error -1` (no energy chip). `Mac Studio` is this host — do not cycle it.

Offline KP125M (`Sparks`/`spark0`, `PC`/`emo-win`, `4090`, `Media Rack`, `SSDs`) now resolve by decoded name and return `DeviceOffline` (`error_code -20571`), not an auth failure. Local aliases: spark0→Sparks, emo-win→PC, 4090, mac-studio (`allow_cycle = false`).

## Astra review fixes (2026-09-19)

- `cycle` restores power if the off-window is interrupted (`BaseException`).
- `setup` creates `config.toml` with `os.open(..., 0o600)` so the secret is never world-readable.
- `status` isolates per-alias failures so one offline plug does not abort the fleet.
- `whoami` skips any `SmartHomeError`, not only `AuthError`.
- `op` / `security` subprocesses time out after 10s.
- Invalid TOML raises `ConfigError` instead of a traceback.

## Fleet aliases (2026-09-19)

Operator map:

| host | Kasa alias | model | notes |
| --- | --- | --- | --- |
| spark0, spark1 | Sparks | KP125M | one plug feeds both DGX Sparks; cycle either reboots both |
| emo-win | PC | KP125M | |
| emo-4090 | 4090 | KP125M | |
| studio | Mac Studio | EP25 | `allow_cycle = false` |

Kasa Cloud still reports Sparks/PC/4090 as `status: 0` and passthrough `-20571` (IOT and SMART payloads). They are `SMART.KASAPLUG` Matter plugs. EP25 IOT plugs (Entertainment, Studio Desk, Mac Studio) return live watts.

## EMO-479 KLAP for SMART.KASAPLUG (2026-09-19)

KP125M Matter plugs (`SMART.KASAPLUG`) stay `status: 0` on Kasa Cloud. Passthrough is `-20571` because TP-Link does not tunnel the legacy XOR IOT protocol for them. They speak KLAP on HTTP :80 at a unicast host using the TP-Link account.

`smart_home.py` now:

- persists `host` on `[[device]]`
- routes SMART.KASAPLUG energy/on/off through python-kasa when importable, else `uvx --from python-kasa kasa --json --host` with `KASA_PASSWORD` in the environment
- keeps IOT EP25 on cloud `passthrough`
- ships default alias `media-rack` → Media Rack `192.168.50.152` (`allow_cycle = false`)

Live on studio (no cycle, no UDP discover):

```
$ python3 skills/smart-home/scripts/smart_home.py --json energy "Media Rack"
{
  "alias": "Media Rack",
  "amps": 1.738,
  "connector": "kasa",
  "host": "192.168.50.152",
  "id": "803ABE5ED92F38252F2968C06265A37F2430D06F",
  "kwh": 215.131,
  "model": "KP125M(US)",
  "on": true,
  "online": true,
  "parent_id": null,
  "volts": 124.037,
  "watts": 203.99
}
```

`energy media-rack` matched. `status` reported Media Rack ~204 W on, Mac Studio (EP25) ~31 W on, and Sparks/PC/4090 as SMART.KASAPLUG missing `host` (not `-20571` auth confusion). `python3 skills/smart-home/tests/test_smart_home.py` — 38 tests OK.

Sparks/PC/4090 still need their LAN IPs in `[[device]] host` before KLAP can read them.
