/**
 * Runtime theming -- lets a tenant's chosen accent color (Settings >
 * Branding) actually retint the app, instead of just sitting saved in the
 * database with every `brand-*` Tailwind class hardcoded to indigo.
 *
 * Approach: Tailwind's `brand` palette is defined in tailwind.config.js as
 * `rgb(var(--brand-500) / <alpha-value>)` for each shade, reading CSS
 * custom properties instead of fixed hex values. This module computes a
 * full 50-950 shade scale from a single base hex (via HSL lightness
 * interpolation) and writes it onto :root as `--brand-500: "R G B"` etc.
 * (space-separated, no rgb() wrapper -- required for Tailwind's
 * `<alpha-value>` opacity modifiers like `bg-brand-600/50` to work).
 */

const SHADE_LIGHTNESS: Record<number, number> = {
  50: 95, 100: 90, 200: 80, 300: 68, 400: 56,
  500: 45, 600: 38, 700: 32, 800: 26, 900: 20, 950: 12,
};

function hexToHsl(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgbTriplet(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return `${to255(r)} ${to255(g)} ${to255(b)}`;
}

/** Applies `hex` as the app's brand color by writing --brand-{shade} CSS
 * variables onto :root. Safe to call repeatedly (e.g. on workspace switch,
 * or immediately after saving a new color in Settings). */
export function applyAccentColor(hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return; // ignore malformed values rather than crash the whole app
  const [h, s] = hexToHsl(hex);
  const root = document.documentElement.style;
  for (const [shade, lightness] of Object.entries(SHADE_LIGHTNESS)) {
    root.setProperty(`--brand-${shade}`, hslToRgbTriplet(h, s, lightness));
  }
}