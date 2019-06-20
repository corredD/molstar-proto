/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import { PluginContext } from '../../../mol-plugin/context';
import { PluginCommands } from '../../../mol-plugin/command';
import { CameraSnapshotManager } from '../../../mol-plugin/state/camera';

export function registerDefault(ctx: PluginContext) {
    Reset(ctx);
    SetSnapshot(ctx);
    Snapshots(ctx);
}

export function Reset(ctx: PluginContext) {
    PluginCommands.Camera.Reset.subscribe(ctx, () => {
        ctx.canvas3d.resetCamera();
    })
}

export function SetSnapshot(ctx: PluginContext) {
    PluginCommands.Camera.SetSnapshot.subscribe(ctx, ({ snapshot, durationMs }) => {
        ctx.canvas3d.camera.transition.apply(snapshot, durationMs);
    })
}

export function Snapshots(ctx: PluginContext) {
    PluginCommands.Camera.Snapshots.Clear.subscribe(ctx, () => {
        ctx.state.cameraSnapshots.clear();
    });

    PluginCommands.Camera.Snapshots.Remove.subscribe(ctx, ({ id }) => {
        ctx.state.cameraSnapshots.remove(id);
    });

    PluginCommands.Camera.Snapshots.Add.subscribe(ctx, ({ name, description }) => {
        const entry = CameraSnapshotManager.Entry(ctx.canvas3d.camera.getSnapshot(), name, description);
        ctx.state.cameraSnapshots.add(entry);
    });

    PluginCommands.Camera.Snapshots.Apply.subscribe(ctx, ({ id }) => {
        const e = ctx.state.cameraSnapshots.getEntry(id);
        return PluginCommands.Camera.SetSnapshot.dispatch(ctx, { snapshot: e.snapshot, durationMs: 200 });
    });
}