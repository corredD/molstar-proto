/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { PluginStateTransform, PluginStateObject as SO, type PluginStateObject } from '@molstar/plugin/state/objects';
import { Task } from '@molstar/core/task';
import { parseGltf } from '@molstar/io/reader/gltf/parser';
import { gltfToObj } from '@molstar/io/reader/gltf/to-obj';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Mat4 } from '@molstar/core/math/linear-algebra';
import { shapeFromObj } from '@molstar/graphics/formats/shape/obj';
import { DataFormatProvider, applyTransformerRaw, rawDataObject } from '@molstar/plugin/state/formats/provider';
import { ShapeFormatCategory } from './category.js';
import type { StateObjectRef } from '@molstar/core/state';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import type { PluginContext } from '@molstar/plugin/context';
import type { PluginRegistryEntry } from '@molstar/plugin/spec';

export { ParseGltf };
type ParseGltf = typeof ParseGltf;
const ParseGltf = PluginStateTransform.BuiltIn({
  name: 'parse-gltf',
  display: { name: 'Parse glTF', description: 'Parse glTF 2.0 (GLB, or .gltf with embedded buffers)' },
  from: [SO.Data.Binary, SO.Data.String, SO.Data.Response],
  to: SO.Format.Gltf,
})({
  apply({ a }) {
    return Task.create('Parse glTF', async (ctx) => {
      // a copy: the parsed file keeps views on it (.v6/data-response)
      const parsed = await parseGltf(SO.Data.readBytes(a, { copy: true })).runInContext(ctx);
      if (parsed.isError) throw new Error(parsed.message);
      return new SO.Format.Gltf(parsed.result, { label: 'glTF Data' });
    });
  },
});

export { ShapeFromGltf };
type ShapeFromGltf = typeof ShapeFromGltf;
/** The glTF scene baked into one mesh (io gltf.md §3), built and coloured as an OBJ is */
const ShapeFromGltf = PluginStateTransform.BuiltIn({
  name: 'shape-from-gltf',
  display: { name: 'Shape from glTF', description: 'Create Shape from glTF data' },
  from: SO.Format.Gltf,
  to: SO.Shape.Provider,
  params: {
    transforms: PD.Optional(PD.Value([Mat4.identity()], { isHidden: true })),
    label: PD.Optional(PD.Text('', { isHidden: true })),
  },
})({
  apply({ a, params }) {
    return Task.create('Create shape from glTF', async (ctx) => {
      const { obj, mtl } = gltfToObj(a.data);
      const shape = await shapeFromObj(obj, { transforms: params.transforms, mtl }).runInContext(ctx);
      return new SO.Shape.Provider(shape, { label: params.label || 'Shape' });
    });
  },
});

export const GltfProvider = DataFormatProvider({
  name: 'gltf',
  label: 'glTF',
  description: 'glTF 2.0 (GLB)',
  category: ShapeFormatCategory,
  binaryExtensions: ['glb'],
  stringExtensions: ['gltf'],
  parse: async (plugin, data) => {
    const format = plugin.state.data
      .build()
      .to(data)
      .apply(ParseGltf, {}, { state: { isGhost: true } });

    const shape = format.apply(ShapeFromGltf);

    await format.commit();

    return { format: format.selector, shape: shape.selector };
  },
  parseRaw: async (plugin, ctx, data) => {
    const format = await applyTransformerRaw(plugin, ctx, ParseGltf, rawDataObject(data));
    const shape = await applyTransformerRaw(plugin, ctx, ShapeFromGltf, format);
    return { shape: shape.data };
  },
  visuals(plugin: PluginContext, data: { shape: StateObjectRef<PluginStateObject.Shape.Provider> }) {
    const repr = plugin.state.data.build().to(data.shape).apply(ShapeRepresentation3D);
    return repr.commit();
  },
});

/** The glTF data format. */
export const Gltf: PluginRegistryEntry = {
  formats: [GltfProvider],
};
