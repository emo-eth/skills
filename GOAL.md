## Intention

Setup smart home connectors on studio (Kasa power cycling & power monitoring), including Matter SMART.KASAPLUG via local KLAP.

## Vibe

Doing smart-home-connectors should feel like finished work you can trust, not a reminder stub.

## Done-when

1. Separate SSID compatibility: IOT plugs work across network boundaries via Kasa Cloud without LAN broadcast.
2. SMART.KASAPLUG / KP125M: unicast KLAP on a configured host (python-kasa or `uvx --from python-kasa`) reports live watts; no UDP discover.
3. Extensible architecture: General smart home connector pattern, especially supporting Kasa devices.
4. Power monitoring: Queries live wattage accurately (cloud emeter or KLAP).
5. Power cycling: Supports safe power toggling/cycling to reboot frozen hardware.

## Acceptance criteria
1. `smart-home energy "Media Rack"` and `smart-home energy media-rack` return live watts/volts/amps/on via KLAP.
2. `smart-home status` includes Media Rack wattage without aborting on other offline SMART plugs.
3. Existing IOT cloud tests and new KLAP unit tests pass.
4. Secrets stay in mode-600 config; password never on uvx argv.

## Validation criteria
1. Live KLAP energy on studio for Media Rack at 192.168.50.152.
2. `python3 skills/smart-home/tests/test_smart_home.py` passes.
3. Execution log recorded with proof outputs (no secrets, no Matter setup codes).

## Map
- Herdr: smart-home-connectors (w59)
- Linear: https://linear.app/emo-eth/issue/EMO-474/setup-smart-home-connectors-on-studio-kasa-power-cycling-and-power
- Linear: https://linear.app/emo-eth/issue/EMO-479/support-matter-smart-klap-protocol-for-kp125m-kasa-plugs-on-studio
- Worktree: `/Users/emo/.herdr/worktrees/skills/smart-home-connectors`
- Host: `studio`
