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

Studio agents cannot write the login keychain (`User interaction is not allowed`, with or without `sudo`). Do not use `sudo security`. Write a mode-`600` file instead.

Interactive (hidden prompt; type the password and press Enter — no Ctrl-D):

```bash
bash "$smart_home_skill_script" setup --username 'you@example.com' --verify
```

Piped (one line on stdin; `--password-stdin` used to hang waiting for EOF):

```bash
printf '%s\n' "$KASA_PASSWORD" | bash "$smart_home_skill_script" setup \
  --username 'you@example.com' --password-stdin --verify
```

That writes `~/.config/smart-home/config.toml` (chmod 600) and calls Kasa Cloud. `--verify` is optional.

1Password (`password_op`) works after `op signin` in a GUI session. macOS keychain (`password_keychain`) only works from a logged-in GUI terminal, not from this agent.

## Commands

```bash
bash "$smart_home_skill_script" setup --username 'you@example.com' --verify
bash "$smart_home_skill_script" --json whoami
bash "$smart_home_skill_script" --json devices
bash "$smart_home_skill_script" --json energy spark0
bash "$smart_home_skill_script" --json status
bash "$smart_home_skill_script" off spark0 --confirm cycle
bash "$smart_home_skill_script" cycle spark0 --confirm cycle --off-seconds 8
```

`energy` returns live `watts`, `volts`, `amps`, `kwh`, and `on`. `cycle` is off → wait → on. `off` and `cycle` refuse unless `--confirm cycle` is passed. Mapped aliases also need `allow_cycle = true` (or `--allow-unmapped` for `cycle`). The outlet must currently be on for `cycle` (or `--even-if-off`). `on` is unguarded so a stuck host can be recovered.

## Rules

- Use the cloud or HA API. Do not scan the LAN, do not send UDP broadcasts, do not assume a flat subnet.
- Do not put Kasa or HA secrets in the skills repo, tickets, or chat logs.
- Do not cycle a plug that is feeding this machine unless the operator named that target.
- Map human aliases in `[[device]]` so agents do not guess deviceIds.
- This skill is explicit-invocation. Automation should call the CLI, not invent raw TP-Link HTTP.

## Studio notes

studio is `192.168.50.0/24`. Isolated Kasa plugs are not on that broadcast domain. There is no Home Assistant listener on studio. Kasa Cloud is the path that works across the SSID boundary once TP-Link account credentials are in the local store.
