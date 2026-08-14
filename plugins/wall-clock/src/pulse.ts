// Breathing color pulse for the wall-clock status line.
//
// The whole line breathes between near-gray and the theme color at full
// saturation: hue and lightness come from the host theme (accent while
// active, warning during wrap-up), and only OKLCH chroma is animated, so
// perceived brightness stays constant and the pulse reads as breathing
// rather than blinking.
//
// To excise this feature: delete this file, remove `statusPulse` from
// HostExtensionOptions and its uses in host.ts, and drop the
// createStatusPulse() line in pi.ts.

export type PulseTheme = {
  getFgAnsi?: (color: string) => string;
  getColorMode?: () => string;
};

export type PulseUi = {
  theme?: PulseTheme;
};

export type StatusPulse = {
  frameMs: number;
  colorize: (ui: PulseUi | undefined, text: string, phase: string) => { text: string; animated: boolean };
};

export type StatusPulseOptions = {
  periodMs?: number;
  frameMs?: number;
  now?: () => number;
};

const PHASE_COLORS: Record<string, string> = {
  active: "accent",
  "wrap-up": "warning",
};

// Below this chroma the theme color is effectively gray and has no usable
// hue to breathe toward.
const MIN_SOURCE_CHROMA = 0.02;
const CHROMA_FLOOR_FRACTION = 0.15;
const RESET_FG = "\u001b[39m";

export function createStatusPulse(options: StatusPulseOptions = {}): StatusPulse {
  const periodMs = options.periodMs ?? 4_000;
  const frameMs = options.frameMs ?? 100;
  const now = options.now ?? Date.now;
  const anchors = new Map<string, { lightness: number; hue: number; maxChroma: number }>();

  const colorize = (ui: PulseUi | undefined, text: string, phase: string): { text: string; animated: boolean } => {
    // Hosts may throw from the theme getter when no interactive UI is up
    // (e.g. pi in RPC mode before initTheme). Any failure means no pulse.
    let rgb: [number, number, number] | undefined;
    const colorName = PHASE_COLORS[phase];
    if (!colorName) return { text, animated: false };
    try {
      const theme = ui?.theme;
      if (!theme?.getFgAnsi) return { text, animated: false };
      if (theme.getColorMode && theme.getColorMode() !== "truecolor") return { text, animated: false };
      rgb = parseTruecolorFg(theme.getFgAnsi(colorName));
    } catch {
      return { text, animated: false };
    }
    if (!rgb) return { text, animated: false };
    const anchor = anchorFor(anchors, colorName, rgb);
    if (!anchor) return { text, animated: false };
    const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * (now() % periodMs)) / periodMs);
    const floor = anchor.maxChroma * CHROMA_FLOOR_FRACTION;
    const chroma = floor + (anchor.maxChroma - floor) * breath;
    const [r, g, b] = oklchToSrgb(anchor.lightness, chroma, anchor.hue);
    return { text: `\u001b[38;2;${r};${g};${b}m${text}${RESET_FG}`, animated: true };
  };

  return { frameMs, colorize };
}

function anchorFor(
  anchors: Map<string, { lightness: number; hue: number; maxChroma: number }>,
  colorName: string,
  rgb: [number, number, number],
): { lightness: number; hue: number; maxChroma: number } | undefined {
  const key = `${colorName}:${rgb[0]},${rgb[1]},${rgb[2]}`;
  const cached = anchors.get(key);
  if (cached) return cached;
  const [lightness, chroma, hue] = srgbToOklch(rgb[0], rgb[1], rgb[2]);
  if (chroma < MIN_SOURCE_CHROMA) return undefined;
  const anchor = { lightness, hue, maxChroma: maxInGamutChroma(lightness, hue) };
  anchors.set(key, anchor);
  return anchor;
}

export function parseTruecolorFg(ansi: string): [number, number, number] | undefined {
  const match = /\[38;2;(\d{1,3});(\d{1,3});(\d{1,3})m/.exec(ansi);
  if (!match) return undefined;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if (r > 255 || g > 255 || b > 255) return undefined;
  return [r, g, b];
}

export function srgbToOklch(r8: number, g8: number, b8: number): [number, number, number] {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bAxis);
  const hue = Math.atan2(bAxis, a);
  return [lightness, chroma, hue];
}

export function oklchToSrgb(lightness: number, chroma: number, hue: number): [number, number, number] {
  const [r, g, b] = oklchToLinear(lightness, chroma, hue);
  return [encode(r), encode(g), encode(b)];
}

export function maxInGamutChroma(lightness: number, hue: number): number {
  let low = 0;
  let high = 0.4;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinear(lightness, mid, hue))) low = mid;
    else high = mid;
  }
  return low;
}

function oklchToLinear(lightness: number, chroma: number, hue: number): [number, number, number] {
  const a = chroma * Math.cos(hue);
  const bAxis = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * bAxis) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * bAxis) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * bAxis) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(linear: [number, number, number]): boolean {
  return linear.every((channel) => channel >= -0.0001 && channel <= 1.0001);
}

function encode(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
