---
name: smart-home
disable-model-invocation: true
description: "Smart home connectors for Kasa power monitoring and safe power cycling. IOT plugs use TP-Link Cloud; Matter SMART.KASAPLUG (KP125M) uses unicast KLAP on a configured host. Never UDP discover."
license: MIT
---

# Smart home connectors

Talk to plugs and strips through authenticated APIs. **IOT** Kasa plugs (EP25 and older XOR LAN protocol) use Kasa Cloud so they still work on a separate IoT SSID. **SMART.KASAPLUG** Matter plugs (KP125M / KM125) do not tunnel that protocol through `wap.tplinkcloud.com`; they speak **KLAP on HTTP port 80** at a unicast address using the same TP-Link account credentials. Configure `host = "IP"` on `[[device]]`. Do not UDP-broadcast discover.

Connectors today: **Kasa Cloud + unicast KLAP** (default) and **Home Assistant REST**. Add another backend by implementing the same list / energy / on / off surface.

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

KLAP uses the same username/password. The CLI talks to python-kasa when that library is importable, otherwise `uvx --from python-kasa kasa --host <IP>` with `KASA_PASSWORD` in the environment (never on argv).

## Commands

```bash
bash "$smart_home_skill_script" setup --username 'you@example.com' --verify
bash "$smart_home_skill_script" --json whoami
bash "$smart_home_skill_script" --json devices
bash "$smart_home_skill_script" --json energy spark0
bash "$smart_home_skill_script" --json energy emo-win
bash "$smart_home_skill_script" --json energy emo-4090
bash "$smart_home_skill_script" --json energy media-rack
bash "$smart_home_skill_script" --json energy "Media Rack"
bash "$smart_home_skill_script" --json status
bash "$smart_home_skill_script" off spark0 --confirm cycle
bash "$smart_home_skill_script" cycle spark0 --confirm cycle --off-seconds 8
```

`energy` returns live `watts`, `volts`, `amps`, `kwh`, and `on`. `cycle` is off → wait → on. If the wait is interrupted, cycle turns the outlet back on before exiting. `off` and `cycle` refuse unless `--confirm cycle` is passed. Mapped aliases also need `allow_cycle = true` (or `--allow-unmapped` for `cycle`). The outlet must currently be on for `cycle` (or `--even-if-off`). `on` is unguarded so a stuck host can be recovered.

Host map: `spark0` and `spark1` are the same Kasa plug `Sparks` (cycling either reboots both DGX Sparks). `emo-win` is `PC`. `emo-4090` is `4090`. `mac-studio` is this machine (`allow_cycle = false`). `media-rack` is `Media Rack` at `192.168.50.152` (KP125M, KLAP, `allow_cycle = false`).

## Rules

- Cloud for IOT. Unicast KLAP for SMART.KASAPLUG when `host` is set. Do not scan the LAN, do not send UDP broadcasts.
- Do not put Kasa or HA secrets in the skills repo, tickets, or chat logs. Do not log Matter setup codes.
- Do not cycle a plug that is feeding this machine unless the operator named that target.
- Map human aliases in `[[device]]` so agents do not guess deviceIds. SMART plugs need `host = "IP"`.
- This skill is explicit-invocation. Automation should call the CLI, not invent raw TP-Link HTTP.

## Studio notes

studio is `192.168.50.0/24`. Some Kasa plugs sit on an isolated IoT SSID (cloud only). KP125M plugs that are on the studio LAN (Media Rack at `.152`) are reachable by unicast KLAP, not by cloud passthrough (`-20571`, `get_connect_cloud_state.status = 0`). There is no Home Assistant listener on studio. `python-kasa` is not installed system-wide; `uvx` is.
