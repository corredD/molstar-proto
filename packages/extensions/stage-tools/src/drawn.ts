/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginContext } from '@molstar/plugin/context';

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
