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
