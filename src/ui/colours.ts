/** Palette taken from the reference consultancy site's stylesheet (look and feel only). */
export const PALETTE = {
  navy: "#002b49",
  blue: "#006ba6",
  grey: "#656969",
  greyMid: "#b2b4b4",
  greyLight: "#d9dad9",
  charcoal: "#3f4443",
  lime: "#cedc00",
  red: "#cc1f1d",
  cyan: "#6ad1e3",
  cyanLight: "#c4edf3",
  ink: "#010f1a",
  white: "#ffffff",
};

/** Heat map colour scale from 0 to twice the acceptance limit, so 12.6 sits in the middle. */
const STOPS: [number, [number, number, number]][] = [
  [0.0, [0xf4, 0xf6, 0xf6]],
  [0.18, [0xc4, 0xed, 0xf3]],
  [0.36, [0x6a, 0xd1, 0xe3]],
  [0.5, [0x00, 0x6b, 0xa6]],
  [0.5001, [0xce, 0xdc, 0x00]],
  [0.75, [0xf0, 0x8a, 0x24]],
  [1.0, [0xcc, 0x1f, 0x1d]],
];

export const SCALE_MAXIMUM = 25.2;

export function heatColour(value: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, value / SCALE_MAXIMUM));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const u = (t - t0) / Math.max(1e-9, t1 - t0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + u * (c1[k] - c0[k]))) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const OPENING_STYLE: Record<string, { fill: string; stroke: string; hatch?: boolean }> = {
  window: { fill: "rgba(196, 237, 243, 0.85)", stroke: PALETTE.blue },
  door: { fill: "rgba(178, 180, 180, 0.75)", stroke: PALETTE.charcoal },
  nonFireResistingWall: { fill: "rgba(217, 218, 217, 0.9)", stroke: PALETTE.grey, hatch: true },
  combustibleCladding: { fill: "rgba(206, 220, 0, 0.45)", stroke: "#7d8500", hatch: true },
};
