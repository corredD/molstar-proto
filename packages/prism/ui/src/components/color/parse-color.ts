/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ColorNames } from '@molstar/core/util/color/names';

// A color as people write it: no DOM, so operations (the extensions', headless) read colors the picker's way.

export const rgb = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
export const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * A color as people write it, to the number Mol* uses (`0xRRGGBB`); undefined when it is not one:
 * - hex: `#3362b2`, `3362b2`, `#36b`, `0x3362b2`;
 * - channels, 0–255 or percentages: `51, 98, 178`, `51 98 178`, `rgb(51 98 178)`, `rgba(51,98,178,1)`, `rgb(20%,…)`;
 * - normalized channels (all at most 1, one with a decimal point): `0.2, 0.38, 0.7`;
 * - `hsl(218, 55%, 45%)`;
 * - a CSS color name: `steelblue`, `Steel Blue`.
 */
export function parseColor(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;

  const hex = /^(?:#|0x)?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  // Three bare digits are channels' worth of hex only without separators ("123" is #112233, "1, 2, 3" is not).
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
    return Number.parseInt(h, 16);
  }

  const fn = /^(rgba?|hsla?)?\s*\(?\s*([^()]*?)\s*\)?$/.exec(t);
  if (fn) {
    // Separated by commas, spaces, semicolons or a slash (the alpha in `rgb(r g b / a)`, ignored).
    const parts = fn[2].split(/\s*[,;/\s]\s*/).filter(Boolean);
    if (parts.length === 3 || parts.length === 4) {
      const values = parts.slice(0, 3);
      if (values.every((p) => /^[+]?(\d+\.?\d*|\.\d+)%?$/.test(p))) {
        if (fn[1]?.startsWith('hsl')) return hsl(values);
        const percent = values.some((p) => p.endsWith('%'));
        const nums = values.map((p) => Number.parseFloat(p));
        const normalized = !percent && nums.every((v) => v <= 1) && values.some((p) => p.includes('.'));
        const to = (v: number) => (percent ? (v * 255) / 100 : normalized ? v * 255 : v);
        if (!percent && !normalized && nums.some((v) => v > 255)) return undefined;
        return rgb(byte(to(nums[0])), byte(to(nums[1])), byte(to(nums[2])));
      }
    }
  }

  const name = t.replace(/[\s_-]/g, '') as keyof typeof ColorNames;
  return Object.hasOwn(ColorNames, name) ? (ColorNames[name] as number) : undefined;
}

function hsl(values: string[]): number | undefined {
  const h = (((Number.parseFloat(values[0]) % 360) + 360) % 360) / 60;
  const s = Math.min(1, Number.parseFloat(values[1]) / 100);
  const l = Math.min(1, Number.parseFloat(values[2]) / 100);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return rgb(byte((r + m) * 255), byte((g + m) * 255), byte((b + m) * 255));
}
