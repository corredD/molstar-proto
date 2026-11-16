/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { StateObjectCell } from '@molstar/core/state';
import type { PluginContext } from '@molstar/plugin/context';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';

/** An object as drawn: the last of the decorators on it (a transform, custom properties), else itself */
export function drawnObject(ctx: { readonly plugin: PluginContext }, ref: string) {
  const { cells, tree } = ctx.plugin.state.data;
  let cell = cells.get(ref);
  for (;;) {
    const next = tree.children
      .get(cell?.transform.ref ?? '')
      .toArray()
      .map((c) => cells.get(c))
      .find((c) => c?.transform.transformer.definition.isDecorator && c.obj);
    if (!next) return cell?.obj;
    cell = next;
  }
}

/**
 * The shape a mesh's representation draws, whose `transforms` place it: its parent, past the decorators of the shape
 * between them (a mesh colored by a volume)
 */
export function shapeCellOf(
  ctx: { readonly plugin: PluginContext },
  repr: StateObjectCell,
): StateObjectCell | undefined {
  const { cells } = ctx.plugin.state.data;
  let cell = cells.get(repr.transform.parent);
  while (cell?.transform.transformer.definition.isDecorator && SO.Shape.Provider.is(cell.obj)) {
    cell = cells.get(cell.transform.parent);
  }
  return cell && SO.Shape.Provider.is(cell.obj) ? cell : undefined;
}
