/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// ChimeraX's colors (chimerax.md §2): its built-in names (chimerax.core.colors.BuiltinColors, CSS's and a
// few of its own; a name of two words is written with a blank, `cornflower blue`, or without, `cornflowerblue`) and
// its element colors (chimerax.atomic.colors), read from ChimeraX 1.10. A color is also `#rgb`, `#rrggbb`, `r,g,b`
// in percent, `rgb(…)`, `rgba(…)`, `gray(…)`, `hsl(…)` and `hsla(…)`.

/** The built-in names: `name:rrggbb`, a blank in a name written `_`. */
const Named = (
  'alice_blue:f0f8ff aliceblue:f0f8ff antique_white:faebd7 antiquewhite:faebd7 aqua:00ffff ' +
  'aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanched_almond:ffebcd ' +
  'blanchedalmond:ffebcd blue:0000ff blue_violet:8a2be2 blueviolet:8a2be2 brown:a52a2a burly_wood:deb887 ' +
  'burlywood:deb887 cadet_blue:5f9ea0 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 ' +
  'cornflower_blue:6495ed cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff dark_blue:00008b ' +
  'dark_cyan:008b8b dark_goldenrod:b8860b dark_gray:a9a9a9 dark_green:006400 dark_grey:a9a9a9 ' +
  'dark_khaki:bdb76b dark_magenta:8b008b dark_olive_green:556b2f dark_orange:ff8c00 dark_orchid:9932cc ' +
  'dark_red:8b0000 dark_salmon:e9967a dark_sea_green:8fbc8f dark_seagreen:8fbc8f dark_slate_blue:483d8b ' +
  'dark_slate_gray:2f4f4f dark_slate_grey:2f4f4f dark_turquoise:00ced1 dark_violet:9400d3 darkblue:00008b ' +
  'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b ' +
  'darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 ' +
  'darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f ' +
  'darkturquoise:00ced1 darkviolet:9400d3 deep_pink:ff1493 deep_sky_blue:00bfff deep_skyblue:00bfff ' +
  'deeppink:ff1493 deepskyblue:00bfff dim_gray:696969 dim_grey:696969 dimgray:696969 dimgrey:696969 ' +
  'dodger_blue:1e90ff dodgerblue:1e90ff fire_brick:b22222 firebrick:b22222 floral_white:fffaf0 ' +
  'floralwhite:fffaf0 forest_green:228b22 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ' +
  'ghost_white:f8f8ff ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 ' +
  'green_yellow:adff2f greenyellow:adff2f grey:808080 honeydew:f0fff0 hot_pink:ff69b4 hotpink:ff69b4 ' +
  'indian_red:cd5c5c indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
  'lavender_blush:fff0f5 lavenderblush:fff0f5 lawn_green:7cfc00 lawngreen:7cfc00 lemon_chiffon:fffacd ' +
  'lemonchiffon:fffacd light_blue:add8e6 light_coral:f08080 light_cyan:e0ffff light_goldenrod_yellow:fafad2 ' +
  'light_gray:d3d3d3 light_green:90ee90 light_grey:d3d3d3 light_pink:ffb6c1 light_salmon:ffa07a ' +
  'light_sea_green:20b2aa light_seagreen:20b2aa light_sky_blue:87cefa light_skyblue:87cefa ' +
  'light_slate_gray:778899 light_slate_grey:778899 light_steel_blue:b0c4de light_yellow:ffffe0 ' +
  'lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 ' +
  'lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa ' +
  'lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 ' +
  'lime:00ff00 lime_green:32cd32 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 ' +
  'medium_aquamarine:66cdaa medium_blue:0000cd medium_orchid:ba55d3 medium_purple:9370db ' +
  'medium_sea_green:3cb371 medium_seagreen:3cb371 medium_slate_blue:7b68ee medium_spring_green:00fa9a ' +
  'medium_turquoise:48d1cc medium_violet_red:c71585 mediumaquamarine:66cdaa mediumblue:0000cd ' +
  'mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
  'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnight_blue:191970 ' +
  'midnightblue:191970 mint_cream:f5fffa mintcream:f5fffa misty_rose:ffe4e1 mistyrose:ffe4e1 ' +
  'moccasin:ffe4b5 navajo_white:ffdead navajowhite:ffdead navy:000080 old_lace:fdf5e6 oldlace:fdf5e6 ' +
  'olive:808000 olive_drab:6b8e23 olivedrab:6b8e23 orange:ffa500 orange_red:ff4500 orangered:ff4500 ' +
  'orchid:da70d6 pale_goldenrod:eee8aa pale_green:98fb98 pale_turquoise:afeeee pale_violet_red:db7093 ' +
  'palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papaya_whip:ffefd5 ' +
  'papayawhip:ffefd5 peach_puff:ffdab9 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd ' +
  'powder_blue:b0e0e6 powderblue:b0e0e6 purple:800080 rebecca_purple:663399 rebeccapurple:663399 red:ff0000 ' +
  'rosy_brown:bc8f8f rosybrown:bc8f8f royal_blue:4169e1 royalblue:4169e1 saddle_brown:8b4513 ' +
  'saddlebrown:8b4513 salmon:fa8072 sandy_brown:f4a460 sandybrown:f4a460 sea_green:2e8b57 seagreen:2e8b57 ' +
  'seashell:fff5ee sienna:a0522d silver:c0c0c0 sky_blue:87ceeb skyblue:87ceeb slate_blue:6a5acd ' +
  'slate_gray:708090 slate_grey:708090 slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa ' +
  'spring_green:00ff7f springgreen:00ff7f steel_blue:4682b4 steelblue:4682b4 tan:d2b48c teal:008080 ' +
  'thistle:d8bfd8 tomato:ff6347 transparent:000000 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff ' +
  'white_smoke:f5f5f5 whitesmoke:f5f5f5 yellow:ffff00 yellow_green:9acd32 yellowgreen:9acd32'
).split(' ');

/** Every color name, lowercase (two-word names with their blank), to `0xRRGGBB`. */
export const ChimeraxColors: ReadonlyMap<string, number> = new Map(
  Named.map((e) => {
    const [name, hex] = e.split(':');
    return [name.replace(/_/g, ' '), parseInt(hex, 16)] as const;
  }),
);

/** The longest color name, in words (`cornflower blue`: 2). */
export const MaxColorWords = Math.max(...[...ChimeraxColors.keys()].map((k) => k.split(' ').length));

/** ChimeraX's element colors, by symbol as Mol* writes it (upper case): `C` is grey, `N` blue, `O` red. */
const Elements = (
  'AC:70abfa AG:c0c0c0 AL:bfa6a6 AM:545cf2 AR:80d1e3 AS:bd80e3 AT:754f45 AU:ffd123 B:ffb5b5 BA:00c900 ' +
  'BE:c2ff00 BH:e00038 BI:9e4fb5 BK:8a4fe3 BR:a62929 C:909090 CA:3dff00 CD:ffd98f CE:ffffc7 CF:a136d4 ' +
  'CL:1ff01f CM:785ce3 CN:b4b4b4 CO:f090a0 CR:8a99c7 CS:57178f CU:c88033 DB:d1004f DS:b4b4b4 DY:1fffc7 ' +
  'ER:00e675 ES:b31fd4 EU:61ffc7 F:90e050 FE:e06633 FL:b4b4b4 FM:b31fba FR:420066 GA:c28f8f GD:45ffc7 ' +
  'GE:668f8f H:ffffff HE:d9ffff HF:4dc2ff HG:b8b8d0 HO:00ff9c HS:e6002e I:940094 IN:a67573 IR:175487 ' +
  'K:8f40d4 KR:5cb8d1 LA:70d4ff LI:cc80ff LR:c70066 LU:00ab24 MD:b30da6 MG:8aff00 MN:9c7ac7 MO:54b5b5 ' +
  'MT:eb0026 N:3050f8 NA:ab5cf2 NB:73c2c9 ND:c7ffc7 NE:b3e3f5 NI:50d050 NO:bd0d87 NP:0080ff O:ff0d0d ' +
  'OS:266696 P:ff8000 PA:00a1ff PB:575961 PD:006985 PM:a3ffc7 PO:ab5c00 PR:d9ffc7 PT:d0d0e0 PU:006bff ' +
  'RA:007d00 RB:702eb0 RE:267dab RF:cc0059 RG:b4b4b4 RH:0a7d8c RN:428296 RU:248f8f S:ffff30 SB:9e63b5 ' +
  'SC:e6e6e6 SE:ffa100 SG:d90045 SI:f0c8a0 SM:8fffc7 SN:668080 SR:00ff00 TA:4da6ff TB:30ffc7 TC:3b9e9e ' +
  'TE:d47a00 TH:00baff TI:bfc2c7 TL:a6544d TM:00d452 U:008fff UUH:b4b4b4 UUO:b4b4b4 UUP:b4b4b4 UUS:b4b4b4 ' +
  'UUT:b4b4b4 V:a6a6ab W:2194d6 XE:429eb0 Y:94ffff YB:00bf38 ZN:7d80b0 ZR:94e0e0'
).split(' ');

export const ChimeraxElementColors: ReadonlyMap<string, number> = new Map(
  Elements.map((e) => {
    const [symbol, hex] = e.split(':');
    return [symbol, parseInt(hex, 16)] as const;
  }),
);

const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
const rgb = (r: number, g: number, b: number) => (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);

/** One component of `rgb(…)`: a number 0–255, or a percent. */
function component(t: string): number | undefined {
  const s = t.trim();
  const v = Number(s.endsWith('%') ? s.slice(0, -1) : s);
  if (!Number.isFinite(v)) return undefined;
  return s.endsWith('%') ? (v / 100) * 255 : v;
}

function hsl(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgb(f(0) * 255, f(8) * 255, f(4) * 255);
}

/**
 * A color as ChimeraX reads one: a name (any case), `#rgb`, `#rrggbb`(`aa`), `r,g,b`(`,a`) in percent (0–100), or
 * `rgb(…)`, `rgba(…)`, `gray(…)`, `hsl(…)`, `hsla(…)`. Undefined when it is none of these. Transparency in a color is
 * read and dropped (`transparency` sets it).
 */
export function chimeraxColor(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  const named = ChimeraxColors.get(t.replace(/\s+/g, ' '));
  if (named !== undefined) return named;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8}|[0-9a-f]{12})$/.exec(t);
  if (hex) {
    const h = hex[1];
    if (h.length <= 4) return rgb(parseInt(h[0], 16) * 17, parseInt(h[1], 16) * 17, parseInt(h[2], 16) * 17);
    if (h.length === 12)
      return rgb(parseInt(h.slice(0, 2), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(8, 10), 16));
    return parseInt(h.slice(0, 6), 16);
  }
  const percents = /^(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)(,(-?[\d.]+))?$/.exec(t);
  if (percents) return rgb((+percents[1] / 100) * 255, (+percents[2] / 100) * 255, (+percents[3] / 100) * 255);
  const fn = /^(rgba?|gray|grey|hsla?)\((.*)\)$/.exec(t);
  if (!fn) return undefined;
  const args = fn[2].split(',');
  if (fn[1] === 'gray' || fn[1] === 'grey') {
    const g = component(args[0] ?? '');
    return g === undefined ? undefined : rgb(g, g, g);
  }
  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = args.map(component);
    return r === undefined || g === undefined || b === undefined ? undefined : rgb(r, g, b);
  }
  const h = Number(args[0]);
  const s = Number((args[1] ?? '').replace('%', '')) / 100;
  const l = Number((args[2] ?? '').replace('%', '')) / 100;
  return [h, s, l].every(Number.isFinite) ? hsl(((h % 360) + 360) % 360, s, l) : undefined;
}
