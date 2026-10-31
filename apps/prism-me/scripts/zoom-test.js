// Paste in the browser console of prism-me (any port). Zoom where you want, then run `await S()`.
// It stops the animation loop, times frames at the current camera, and puts everything back.
{
  const pl = molstar.viewer.plugin;
  const c = pl.canvas3d;
  const g = c.graphics;
  const say = (m) => console.warn(`[zoom-test] ${m}`);
  const frame = async () => {
    c.requestDraw();
    c.tick(performance.now(), { isSynchronous: true });
    // WebGL: a 1-pixel read stalls until the GPU is done (Firefox's fences report only every 300 ms); WebGPU: its queue
    if (g.waitForGpuCommandsCompleteSync) g.waitForGpuCommandsCompleteSync();
    else await g.waitForGpuCommandsComplete();
  };
  // ms a frame at the current camera: batches of 20 frames, one GPU wait each (a browser that reports the GPU done on a
  // timer, as Firefox's WebGPU every 100 ms, rounds one frame but not 20), the median of the batches
  window.T = async (batches = 5) => {
    for (let i = 0; i < 5; i++) await frame();
    const w = [];
    for (let k = 0; k < batches; k++) {
      const t = performance.now();
      for (let i = 0; i < 19; i++) {
        c.requestDraw();
        c.tick(performance.now(), { isSynchronous: true });
      }
      await frame();
      w.push((performance.now() - t) / 20);
    }
    w.sort((a, b) => a - b);
    return +w[batches >> 1].toFixed(1);
  };
  // the sweep: resolution (fragments) and graphics mode (spheres drawn)
  window.S = async () => {
    pl.animationLoop.stop();
    const px0 = c.props.pixelScale;
    const out = {};
    say('measuring: 6 steps of 105 frames each, do not move the camera…');
    try {
      for (const s of [1, 0.5, 0.25]) {
        c.setProps({ pixelScale: s });
        await frame();
        out[`pixel scale ${s}`] = await T();
        say(`pixel scale ${s}: ${out[`pixel scale ${s}`]} ms`);
      }
      c.setProps({ pixelScale: px0 });
      for (const m of ['quality', 'balanced', 'performance']) {
        await molstar.api.run('mesoscale.graphics', { mode: m });
        await new Promise((r) => setTimeout(r, 1500));
        // a mode also sets its own pixel scale (balanced 0.75, performance 0.5): put it back, so only the LOD changes
        c.setProps({ pixelScale: px0 });
        out[`LOD of ${m}`] = await T();
        say(`LOD of ${m}: ${out[`LOD of ${m}`]} ms`);
      }
      await molstar.api.run('mesoscale.graphics', { mode: 'quality' });
      out.backend = g.capabilities?.backend;
      out.dpr = devicePixelRatio;
      out.viewport = `${c.camera.viewport.width}x${c.camera.viewport.height}`;
    } finally {
      c.setProps({ pixelScale: px0 });
      pl.animationLoop.start();
    }
    console.table(out);
    say(JSON.stringify(out));
    return out;
  };
  say('ready: zoom in, then type  await S()  (about 30 s; each step prints a line)');
}
