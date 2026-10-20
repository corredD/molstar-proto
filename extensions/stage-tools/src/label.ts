/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import { Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Text } from '@molstar/graphics/geo/geometry/text/text';
import { TextBuilder } from '@molstar/graphics/geo/geometry/text/text-builder';
import type { ShapeProvider } from '@molstar/graphics/geo/shape/provider';
import * as ShapeUtils from '@molstar/graphics/geo/shape/shape';
import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';

// A label of the stage (apps/prism-me/_spec/ui.md §5): plain text at a place of the scene, made at a node of the
// explorer's tree (an object, an entity, a chain, a target…), facing the camera. A state transform, so it is saved in a
// session and undone as any change; its shape is drawn by a shape representation under it.

export const StageLabelParams = {
  text: PD.Text('Label', { description: 'What it says' }),
  position: PD.Vec3(Vec3(), {}, { description: 'Where it is (Å)' }),
  /** Brought toward the camera by this much (Å), so it sits in front of what it names */
  depth: PD.Numeric(0, { min: 0, max: 10000, step: 1 }),
  size: PD.Numeric(4, { min: 0.5, max: 100, step: 0.5 }, { description: 'Its height (Å)' }),
  color: PD.Color(Color(0xffffff)),
  background: PD.Boolean(true, { description: 'A plate behind the text' }),
  backgroundColor: PD.Color(Color(0x202020)),
  backgroundOpacity: PD.Numeric(0.7, { min: 0, max: 1, step: 0.01 }),
  /** A line from the place it names to the text, set off up and to the right */
  tether: PD.Boolean(false, { description: 'A line from the place to the text, set off from it' }),
  /** The line's length, in the text's heights */
  tetherLength: PD.Numeric(1, { min: 0.1, max: 10, step: 0.1 }),
  /** The object it names (a state ref) */
  target: PD.Text('', { isHidden: true }),
  /** The tree's row it was made at (its key), where it is listed */
  node: PD.Text('', { isHidden: true }),
};
export type StageLabelProps = PD.Values<typeof StageLabelParams>;

/** What a label's shape stands for: its params, and the kind a pick tells it by */
export interface StageLabelData extends StageLabelProps {
  readonly kind: 'stage-tools-label';
}

export function isStageLabelData(x: unknown): x is StageLabelData {
  return !!x && (x as StageLabelData).kind === 'stage-tools-label';
}

/** How its text is drawn: its plate and its line as its params say */
export function labelLook(p: StageLabelProps) {
  return {
    ...PD.getDefaultValues(Text.Params),
    background: p.background,
    backgroundColor: p.backgroundColor,
    backgroundOpacity: p.backgroundOpacity,
    backgroundMargin: 0.3,
    tether: p.tether,
    tetherLength: p.tetherLength,
    // a tethered label sits up and to the right of its place, its line from the corner
    attachment: p.tether ? ('bottom-left' as const) : ('middle-center' as const),
  };
}

export type StageLabel = typeof StageLabel;
export const StageLabel = PluginStateTransform.BuiltIn({
  name: 'stage-tools-label',
  display: { name: 'Label', description: 'Plain text at a place of the scene' },
  from: SO.Root,
  to: SO.Shape.Provider,
  params: StageLabelParams,
})({
  apply({ params }) {
    return Task.create('Label', async () => {
      const data: StageLabelData = { ...params, kind: 'stage-tools-label' };
      const provider: ShapeProvider<StageLabelData, Text, Text.Params> = {
        label: params.text,
        data,
        params: Text.Params,
        getShape: (_, d, props, shape) => {
          const builder = TextBuilder.create({ ...props, ...labelLook(d) }, 16, 16, shape?.geometry);
          builder.add(d.text, d.position[0], d.position[1], d.position[2], d.depth, d.size, 0);
          return ShapeUtils.create(
            d.text,
            d,
            builder.getText(),
            () => d.color,
            () => 1,
            () => d.text,
          );
        },
        geometryUtils: Text.Utils,
      };
      return new SO.Shape.Provider(provider, { label: params.text || 'Label', description: 'Label' });
    });
  },
});
