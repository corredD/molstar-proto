/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Canvas3D } from '../../../mol-canvas3d/canvas3d';
import { Color } from '../../../mol-util/color';
import { createCanvas3DChannelTarget } from '../canvas3d-channel-target';

/**
 * The background flash calls setBackgroundColor on every frame it moves: the adapter must not rebuild the renderer
 * props each time. A partial `{ renderer: { backgroundColor } }` is what Canvas3D.setProps needs (it defaults
 * colorMarker and light from the renderer's props, and renderer.setProps sets only the fields given).
 */
function fakeCanvas3D() {
    const patches: unknown[] = [];
    const counts = { propsReads: 0 };
    const canvas3d = {
        get props() {
            counts.propsReads += 1;
            return { renderer: { backgroundColor: Color(0), colorMarker: true, light: [] } };
        },
        setProps(patch: unknown) { patches.push(patch); },
    };
    return { canvas3d: canvas3d as unknown as Canvas3D, patches, counts };
}

describe('canvas3d channel target', () => {
    it('sets the background color with one reused patch of renderer.backgroundColor only', () => {
        const { canvas3d, patches, counts } = fakeCanvas3D();
        const target = createCanvas3DChannelTarget(canvas3d);

        target.setBackgroundColor(Color(0x112233));
        expect(patches).toHaveLength(1);
        expect(patches[0]).toEqual({ renderer: { backgroundColor: Color(0x112233) } });

        target.setBackgroundColor(Color(0x445566));
        expect(patches).toHaveLength(2);
        expect(patches[1]).toBe(patches[0]);
        expect(patches[1]).toEqual({ renderer: { backgroundColor: Color(0x445566) } });

        expect(counts.propsReads).toBe(0);
    });
});
