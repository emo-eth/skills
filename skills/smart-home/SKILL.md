---
name: smart-home
disable-model-invocation: true
description: "Smart home connectors for Kasa power monitoring and safe power cycling. IOT plugs use TP-Link Cloud; SMART.KASAPLUG uses local python-kasa/KLAP. `smart-home scan` probes every local /24 plus ASUS guest VLANs. Isolated IoT SSIDs still need a route."
license: MIT
---

# Smart home connectors

Talk to plugs and strips through authenticated APIs plus local python-kasa when studio can reach the plug. **IOT** (EP25 / HS103 / HS105) use Kasa Cloud across a separate IoT SSID. **SMART.KASAPLUG** (KP125M) does not tunnel XOR through `wap.tplinkcloud.com`; it uses KLAP on HTTP :80. `smart-home scan` discovers IPs with UDP broadcasts and TCP :80 on every local interface /24 plus ASUS guest VLANs `192.168.101.0/24` and `192.168.102.0/24` (override with `scan_cidrs` or `SMART_HOME_SCAN_CIDRS`). Isolated SSIDs with no L3 route still cannot be KLAP'd from studio until a host is on that VLAN or the router allows LAN→guest :80.

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
bash "$smart_home_skill_script" --json scan
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

- Cloud for IOT when the cloud says online. Local python-kasa for SMART.KASAPLUG and for any plug with a host in `hosts.toml` or `[[device]] host`.
- `smart-home scan` covers every local /24 plus guest CIDRs `192.168.101.0/24` / `192.168.102.0/24`. Guest AP isolation still blocks those packets from studio LAN until Wi-Fi is on that SSID or the router allows intranet access.
- Do not put Kasa or HA secrets in the skills repo, tickets, or chat logs. Do not log Matter setup codes.
- Do not cycle a plug that is feeding this machine unless the operator named that target.
- Map human aliases in `[[device]]`. Scan persists IPs so SMART plugs do not need a hand-written host when they are on this LAN.
- This skill is explicit-invocation. Automation should call the CLI, not invent raw TP-Link HTTP.

## Studio notes

studio ethernet is `192.168.50.0/24`. Live scan finds Media Rack (`192.168.50.152`) on that LAN. Sparks / PC / 4090 / SSDs (KP125M) live on the isolated IoT SSID (ASUS guest `192.168.101/102`). IOT plugs that are cloud-online report watts/`on` via Kasa Cloud; SMART plugs need a unicast host. There is no Home Assistant listener on studio. `python-kasa` is not installed system-wide; `uvx` is.
