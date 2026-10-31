/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util/value-cell';
import { Color } from '@molstar/core/util/color';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { DataArray } from '@molstar/graphics/gl/renderable/util';

/**
 * Colors by size on screen (`color-levels.md`): a far color, the entity's, the chain's and the atom's, chosen by the
 * pixels an atom covers and blended in Oklab. The TS rule of the shaders' `colorLevels`.
 */
export namespace ColorLevels {
  /** An atom's diameter in Å: the edges are the pixels it covers (the unit, in one place; `colorLevelSize` in GLSL, WGSL) */
  export const AtomSize = 3.4;

  const edge = (value: number, label: string) =>
    PD.Numeric(value, { min: 0.1, max: 200, step: 0.1 }, { description: `Pixels an atom covers where ${label} start` });
  export const Params = {
    entity: edge(3, 'the entity colors'),
    chain: edge(10, 'the chain colors'),
    atom: edge(30, 'the atom colors (by element)'),
    band: PD.Numeric(1, { min: 0.1, max: 4, step: 0.1 }, { description: 'Octaves of size on screen a blend spans' }),
    chainHue: PD.Numeric(90, { min: 0, max: 360, step: 1 }, { description: 'Hue range of the chains, in degrees' }),
  };
  export type Props = PD.Values<typeof Params>;

  /** The pixels an atom covers at view depth `depth` (`projection11` is `P[1][1]`, `height` in CSS pixels) */
  export function atomSize(depth: number, projection11: number, height: number, orthographic: boolean) {
    const pixel = 2 / (projection11 * height);
    return AtomSize / (orthographic ? pixel : pixel * depth);
  }

  /** A chain's offset among `count` chains, from -1 to 1 (0 for one chain) */
  export function chainOffset(index: number, count: number) {
    return count > 1 ? (2 * index) / (count - 1) - 1 : 0;
  }

  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  /** `color` in Oklab (L, a, b) */
  export function toOklab(out: Vec3, color: Color) {
    const [r, g, b] = Color.toRgbNormalized(color).map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return Vec3.set(
      out,
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    );
  }

  function fromOklab(lab: Vec3): Color {
    const l = (lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]) ** 3;
    const m = (lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]) ** 3;
    const s = (lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2]) ** 3;
    const c = (x: number) => Math.min(1, Math.max(0, toSrgb(x)));
    return Color.fromNormalizedRgb(
      c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    );
  }

  const smoothstep = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  /** The share of the next level at each edge (entity, chain, atom) for an atom `size` pixels on screen */
  export function factors(out: Vec3, size: number, props: Props) {
    const s = Math.log2(size);
    const h = props.band / 2;
    return Vec3.set(
      out,
      smoothstep(-h, h, s - Math.log2(props.entity)),
      smoothstep(-h, h, s - Math.log2(props.chain)),
      smoothstep(-h, h, s - Math.log2(props.atom)),
    );
  }

  const t = Vec3();
  const c = Vec3();
  const x = Vec3();

  /** The color of an atom `size` pixels on screen: `far`, then `entity`, its chain's (`offset`), then `element` */
  export function blend(far: Color, entity: Color, element: Color, offset: number, size: number, props: Props) {
    factors(t, size, props);
    toOklab(c, far);
    Vec3.lerp(c, c, toOklab(x, entity), t[0]);
    const angle = (offset * props.chainHue * Math.PI) / 360;
    const a = x[1] * Math.cos(angle) - x[2] * Math.sin(angle);
    Vec3.set(x, x[0] + 0.05 * offset, a, x[1] * Math.sin(angle) + x[2] * Math.cos(angle));
    Vec3.lerp(c, c, x, t[1]);
    Vec3.lerp(c, c, toOklab(x, element), t[2]);
    return fromOklab(c);
  }

  export type Data = {
    /** per instance its far color (`ColorTheme.farColor`, else its color) */
    tColorFar: ValueCell<DataArray<Uint8Array>>;
    /** per group its element color (`rgb`) and its chain's offset (`a`, `(offset + 1) / 2`) */
    tColorNear: ValueCell<DataArray<Uint8Array>>;
    dColorLevels: ValueCell<boolean>;
    /** `log2` of the edges (entity, chain, atom) */
    uColorLevelEdges: ValueCell<Vec3>;
    uColorLevelBand: ValueCell<number>;
    /** the chains' hue range in radians */
    uColorLevelChainHue: ValueCell<number>;
  };

  const emptyData = () => ({ array: new Uint8Array(4), count: 1 });

  export function createData(): Data {
    return {
      tColorFar: ValueCell.create(emptyData()),
      tColorNear: ValueCell.create(emptyData()),
      dColorLevels: ValueCell.create(false),
      uColorLevelEdges: ValueCell.create(Vec3()),
      uColorLevelBand: ValueCell.create(1),
      uColorLevelChainHue: ValueCell.create(0),
    };
  }

  /** Sets the uniforms of `props`, on, or off where undefined (the data kept) */
  export function setProps(data: Data, props: Props | undefined) {
    ValueCell.updateIfChanged(data.dColorLevels, !!props);
    if (!props) return;
    const edges = Vec3.create(Math.log2(props.entity), Math.log2(props.chain), Math.log2(props.atom));
    if (!Vec3.exactEquals(edges, data.uColorLevelEdges.ref.value)) ValueCell.update(data.uColorLevelEdges, edges);
    ValueCell.updateIfChanged(data.uColorLevelBand, props.band);
    ValueCell.updateIfChanged(data.uColorLevelChainHue, (props.chainHue * Math.PI) / 180);
  }
}
