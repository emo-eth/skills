---
name: smart-home
disable-model-invocation: true
description: "API-only smart home connectors for Kasa power monitoring and safe power cycling across isolated IoT SSIDs. Use when an agent on studio (or any fleet box) needs live watts/voltage/kWh or a hard reboot of a stuck machine via TP-Link Cloud or Home Assistant, never local UDP broadcast."
license: MIT
---

# Smart home connectors

Talk to plugs and strips through an authenticated API. Devices on a separate IoT SSID are not on studio's LAN, so local Kasa discovery (`python-kasa discover`, UDP 9999/20002) will not reach them.

Connectors today: **Kasa Cloud** (default) and **Home Assistant REST**. Add another backend by implementing the same list / energy / on / off surface.

## Resolve the helper

```bash
smart_home_skill_script=""
for smart_home_candidate in \
    "${SMART_HOME_SKILL_DIR:-}/scripts/smart-home" \
    "${CODEX_HOME:-$HOME/.codex}/skills/smart-home/scripts/smart-home" \
    "$HOME/.agents/skills/smart-home/scripts/smart-home" \
    "$HOME/.claude/skills/smart-home/scripts/smart-home" \
    "$HOME/dev/skills/skills/smart-home/scripts/smart-home"
do
  if [[ -n "$smart_home_candidate" && -f "$smart_home_candidate" ]]; then
    smart_home_skill_script="$smart_home_candidate"
    break
  fi
done

if [[ -z "$smart_home_skill_script" ]]; then
  echo "smart-home skill: scripts/smart-home was not found" >&2
  exit 127
fi
```

## Credentials (never in git)

On studio, keep secrets in env, 1Password, or macOS keychain. Copy `references/config.example.toml` to `~/.config/smart-home/config.toml` and `chmod 600` it.

```bash
export SMART_HOME_KASA_USERNAME='you@example.com'
export SMART_HOME_KASA_PASSWORD='...'   # or KASA_USERNAME / KASA_PASSWORD
# optional HA
export SMART_HOME_HA_URL='http://homeassistant.local:8123'
export SMART_HOME_HA_TOKEN='...'
```

Inline `password =` / `token =` in the config file is allowed only if the file is mode `600`. Prefer `password_op = "op://vault/item/field"` or `password_keychain = "smart-home.kasa"`.

## Commands

```bash
bash "$smart_home_skill_script" --json whoami
bash "$smart_home_skill_script" --json devices
bash "$smart_home_skill_script" --json energy spark0
bash "$smart_home_skill_script" --json status
bash "$smart_home_skill_script" cycle spark0 --confirm cycle --off-seconds 8
```

`energy` returns live `watts`, `volts`, `amps`, `kwh`, and `on`. `cycle` is off → wait → on. It refuses unless `--confirm cycle` is passed, the alias has `allow_cycle = true` (or `--allow-unmapped`), and the outlet is currently on (or `--even-if-off`). Turning off an unmapped device also requires `--confirm cycle`.

## Rules

- Use the cloud or HA API. Do not scan the LAN, do not send UDP broadcasts, do not assume a flat subnet.
- Do not put Kasa or HA secrets in the skills repo, tickets, or chat logs.
- Do not cycle a plug that is feeding this machine unless the operator named that target.
- Map human aliases in `[[device]]` so agents do not guess deviceIds.
- This skill is explicit-invocation. Automation should call the CLI, not invent raw TP-Link HTTP.

## Studio notes

studio is `192.168.50.0/24`. Isolated Kasa plugs are not on that broadcast domain. There is no Home Assistant listener on studio. Kasa Cloud is the path that works across the SSID boundary once TP-Link account credentials are in the local store.
