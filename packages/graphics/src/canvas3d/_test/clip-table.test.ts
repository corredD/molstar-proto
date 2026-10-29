/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @vitest-environment jsdom

import { Interval } from '@molstar/core/data/int';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { DefaultAssetManager } from '@molstar/core/util/assets';
import { Color } from '@molstar/core/util/color';
import { EveryLoci } from '@molstar/model/model/loci';
import { Shape } from '@molstar/model/model/shape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addSphere } from '../../geo/geometry/mesh/builder/sphere.js';
import { Mesh } from '../../geo/geometry/mesh/mesh.js';
import { MeshBuilder } from '../../geo/geometry/mesh/mesh-builder.js';
import { createGl } from '../../gl/_test/gl.shim.js';
import { createContext } from '../../gl/webgl/context.js';
import { ShapeRepresentation } from '../../repr/shape/representation.js';
import { Visual } from '../../repr/visual.js';
import { Clipping } from '../../theme/clipping.js';
import { Canvas3D, Canvas3DContext } from '../canvas3d.js';

// The clipping table on the gl shim (no pixels: what is uploaded, not what is drawn; the browser check is the app's):
// a representation's rows and table are data, written when the clipping changes, never by a frame or a camera move,
// so the instances a fuzzy band keeps are the same every frame (cellVIEW rebuilt and uploaded its table every frame).

function spheres(_: unknown, { count }: { count: number }) {
  const state = MeshBuilder.createState(64, 32);
  state.currentGroup = 0;
  addSphere(state, Vec3.create(0, 0, 0), 1, 1);
  const transforms = Array.from({ length: count }, (_, i) => Mat4.fromTranslation(Mat4(), Vec3.create(i * 3, 0, 0)));
  return Shape.create(
    's',
    {},
    MeshBuilder.getMesh(state),
    () => Color(0x3f7fbf),
    () => 1,
    () => 's',
    1,
    transforms,
  );
}

/** Eight planes: more than Mol*'s six clipping groups */
const planes = Array.from({ length: 8 }, (_, i) => ({
  type: 'plane' as const,
  invert: false,
  position: Vec3.create(i, 0, 0),
  rotation: { axis: Vec3.create(0, 0, 1), angle: 90 },
  scale: Vec3.create(1, 1, 1),
  transform: Mat4.identity(),
}));

const keep: Clipping.Cell = { mode: 'keep', band: 60, fuzziness: 0.5 };

function setup() {
  const gl = createGl(64, 64, { preserveDrawingBuffer: true });
  const getParameter = gl.getParameter.bind(gl);
  (gl as any).getParameter = (p: number) => (p === gl.COLOR_WRITEMASK ? [true, true, true, true] : getParameter(p));
  const graphics = createContext(gl);
  const ctx = Canvas3DContext.fromGraphics(document.createElement('canvas'), graphics, new DefaultAssetManager());
  const uploads = { count: 0 };
  for (const name of ['texImage2D', 'texSubImage2D'] as const) {
    const f = (gl as any)[name].bind(gl);
    (gl as any)[name] = (...a: unknown[]) => {
      uploads.count += 1;
      return f(...a);
    };
  }
  return { canvas: Canvas3D.create(ctx), uploads };
}

function draw(canvas: Canvas3D) {
  canvas.commit(true);
  canvas.requestDraw();
  canvas.tick(0 as any);
}

describe('the clipping table', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes a row per instance and a cell per (row, object), past six objects', async () => {
    const { canvas } = setup();
    const repr = ShapeRepresentation(spheres, Mesh.Utils, { graphics: canvas.graphics });
    await repr.createOrUpdate({ clip: { variant: 'instance', objects: planes } } as any, { count: 4 }).run();
    const [ro] = repr.renderObjects;
    const values = ro.values as any;
    const lociApply = (_: unknown, apply: (i: Interval) => boolean) => apply(Interval.ofBounds(2, 4));
    // instances 2 and 3 in row 1: they keep a layer of the eighth plane and ignore the first; the others in row 0
    const table: Clipping.Table = [[], [{ mode: 'ignore', band: 0, fuzziness: 0 }, , , , , , , keep]];
    Visual.setClipping(
      ro,
      { kind: 'every-loci', layers: [{ loci: EveryLoci, groups: 0, row: 1 }], table },
      lociApply,
      true,
    );

    expect(values.dClipObjectCount.ref.value).toBe(8);
    expect(values.dClipping.ref.value).toBe(true);
    expect(values.dClipTable.ref.value).toBe(true);
    expect(Array.from(values.tClipping.ref.value.array.slice(0, 4))).toEqual([0, 0, 1, 1]);
    const cells = values.tClipTable.ref.value.array as Float32Array;
    expect(values.tClipTable.ref.value.count).toBe(2 * Clipping.TableWidth);
    const at = (row: number, i: number) => Array.from(cells.slice((row * 16 + i) * 4, (row * 16 + i) * 4 + 3));
    expect(at(1, 0)).toEqual([Clipping.ModeCode.ignore, 0, 0]);
    expect(at(1, 7)).toEqual([Clipping.ModeCode.keep, 60, 0.5]);
    expect(at(0, 7)).toEqual([Clipping.ModeCode.cut, 0, 0]);

    // without a table the value is the bits of the objects ignored, as before
    Visual.setClipping(ro, { kind: 'every-loci', layers: [{ loci: EveryLoci, groups: 5 }] }, lociApply, true);
    expect(values.dClipTable.ref.value).toBe(false);
    expect(Array.from(values.tClipping.ref.value.array.slice(0, 4))).toEqual([0, 0, 5, 5]);
    canvas.dispose();
  });

  it('cuts by row 0 the instances in no layer: the table alone sets the clipping', async () => {
    const { canvas } = setup();
    const repr = ShapeRepresentation(spheres, Mesh.Utils, { graphics: canvas.graphics });
    await repr.createOrUpdate({ clip: { variant: 'instance', objects: planes } } as any, { count: 2 }).run();
    const [ro] = repr.renderObjects;
    Visual.setClipping(ro, { kind: 'every-loci', layers: [], table: [[keep]] }, () => false, true);
    expect((ro.values as any).dClipping.ref.value).toBe(true);
    expect((ro.values as any).dClipTable.ref.value).toBe(true);
    canvas.dispose();
  });

  it('uploads nothing when the camera turns, and nothing when the same table is set again', async () => {
    const { canvas, uploads } = setup();
    const repr = ShapeRepresentation(spheres, Mesh.Utils, { graphics: canvas.graphics });
    await repr.createOrUpdate({ clip: { variant: 'instance', objects: planes } } as any, { count: 4 }).run();
    repr.setState({ syncManually: false });
    canvas.add(repr);
    const [ro] = repr.renderObjects;
    const values = ro.values as any;
    const lociApply = (_: unknown, apply: (i: Interval) => boolean) => apply(Interval.ofBounds(1, 3));
    const clipping = (): Clipping => ({
      kind: 'every-loci',
      layers: [{ loci: EveryLoci, groups: 0, row: 1 }],
      table: [[], [keep]],
    });
    Visual.setClipping(ro, clipping(), lociApply, true);
    draw(canvas);
    draw(canvas);
    const versions = [values.tClipping.ref.version, values.tClipTable.ref.version];
    const before = uploads.count;

    const { position } = canvas.camera.state;
    canvas.camera.setState({ position: Vec3.add(Vec3(), position, Vec3.create(10, 5, 0)) });
    draw(canvas);
    draw(canvas);
    expect([values.tClipping.ref.version, values.tClipTable.ref.version]).toEqual(versions);
    expect(uploads.count).toBe(before);

    // the same table again (a new object, equal cells): the table's data is not touched
    Visual.setClipping(ro, clipping(), lociApply, true);
    expect(values.tClipTable.ref.version).toBe(versions[1]);
    canvas.dispose();
  });
});
