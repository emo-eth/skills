import assert from "node:assert/strict";
import test from "node:test";
import { createStatusPulse, maxInGamutChroma, oklchToSrgb, parseTruecolorFg, srgbToOklch } from "../src/pulse.ts";

const ACCENT_BLUE = "\u001b[38;2;97;175;239m";
const WARNING_AMBER = "\u001b[38;2;229;192;123m";
const GRAY = "\u001b[38;2;128;128;128m";

function fakeTheme(overrides: Partial<{ mode: string; colors: Record<string, string> }> = {}) {
  const colors = overrides.colors ?? { accent: ACCENT_BLUE, warning: WARNING_AMBER };
  return {
    getFgAnsi: (color: string) => colors[color] ?? "",
    getColorMode: () => overrides.mode ?? "truecolor",
  };
}

test("parseTruecolorFg extracts RGB from a truecolor SGR sequence", () => {
  assert.deepEqual(parseTruecolorFg(ACCENT_BLUE), [97, 175, 239]);
  assert.equal(parseTruecolorFg("\u001b[38;5;39m"), undefined);
  assert.equal(parseTruecolorFg("\u001b[38;2;300;0;0m"), undefined);
});

test("OKLCH round-trip reproduces the source color", () => {
  const [l, c, h] = srgbToOklch(97, 175, 239);
  const [r, g, b] = oklchToSrgb(l, c, h);
  assert.ok(Math.abs(r - 97) <= 1 && Math.abs(g - 175) <= 1 && Math.abs(b - 239) <= 1);
});

test("max in-gamut chroma is at least the source color's chroma", () => {
  const [l, c, h] = srgbToOklch(97, 175, 239);
  assert.ok(maxInGamutChroma(l, h) >= c - 0.001);
});

test("pulse breathes chroma while holding lightness and hue", () => {
  let now = 0;
  const pulse = createStatusPulse({ periodMs: 4_000, now: () => now });
  const ui = { theme: fakeTheme() };

  const rest = pulse.colorize(ui, "⏱ 5m left", "active");
  now = 2_000;
  const peak = pulse.colorize(ui, "⏱ 5m left", "active");
  assert.ok(rest.animated && peak.animated);
  assert.ok(rest.text.endsWith("\u001b[39m") && peak.text.endsWith("\u001b[39m"));

  const restRgb = parseTruecolorFg(rest.text);
  const peakRgb = parseTruecolorFg(peak.text);
  assert.ok(restRgb && peakRgb);
  const [restL, restC] = srgbToOklch(...restRgb);
  const [peakL, peakC] = srgbToOklch(...peakRgb);
  const [anchorL, , anchorH] = srgbToOklch(97, 175, 239);
  assert.ok(peakC > restC + 0.05, "peak of the breath is more saturated than the rest point");
  assert.ok(Math.abs(peakC - maxInGamutChroma(anchorL, anchorH)) < 0.01, "peak reaches full in-gamut saturation");
  assert.ok(Math.abs(restL - anchorL) < 0.02 && Math.abs(peakL - anchorL) < 0.02, "lightness stays anchored to the theme color");
});

test("wrap-up phase pulses the theme warning color", () => {
  const requested: string[] = [];
  const pulse = createStatusPulse({ now: () => 2_000 });
  const theme = fakeTheme();
  const ui = {
    theme: {
      ...theme,
      getFgAnsi: (color: string) => {
        requested.push(color);
        return theme.getFgAnsi(color);
      },
    },
  };
  assert.ok(pulse.colorize(ui, "⏱ 10s left", "wrap-up").animated);
  assert.deepEqual(requested, ["warning"]);
});

test("pulse degrades to plain text when it cannot render", () => {
  const pulse = createStatusPulse({ now: () => 2_000 });
  const text = "⏱ 5m left";
  assert.deepEqual(pulse.colorize(undefined, text, "active"), { text, animated: false });
  assert.deepEqual(pulse.colorize({ theme: fakeTheme({ mode: "256color" }) }, text, "active"), { text, animated: false });
  assert.deepEqual(pulse.colorize({ theme: fakeTheme({ colors: { accent: GRAY } }) }, text, "active"), { text, animated: false });
  assert.deepEqual(pulse.colorize({ theme: fakeTheme() }, text, "expired"), { text, animated: false });
});
