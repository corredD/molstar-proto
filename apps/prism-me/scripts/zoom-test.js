// Paste in the browser console of prism-me (any port). Zoom where you want, then run `await S()`.
// It stops the animation loop, times frames at the current camera (`T()`) and turning about it (`M()`, 1° a frame),
// sweeps the pixel scale and the graphics mode, and puts everything back.
{
  const pl = molstar.viewer.plugin;
  const c = pl.canvas3d;
  const g = c.graphics;
  const ctx = pl.canvas3dContext;
  // the pixel scale is the context's (Canvas3D has none: its `setProps({ pixelScale })` changed nothing)
  const setPixelScale = (s) => {
    ctx.setProps({ pixelScale: s });
    c.handleResize();
  };
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
  // the camera turned by `degrees` about its up axis through the target (Rodrigues), every frame a new view
  const turn = (degrees) => {
    const { position: p, target: t, up: u } = c.camera.state;
    const a = (degrees * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    const l = Math.hypot(u[0], u[1], u[2]);
    const k = [u[0] / l, u[1] / l, u[2] / l];
    const v = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
    const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    const r = [0, 1, 2].map((i) => t[i] + v[i] * cos + x[i] * sin + k[i] * kv * (1 - cos));
    c.camera.setState({ position: r }, 0);
  };
  // ms a frame while the camera turns (`degrees` a frame, then back): what dragging costs; batched as `T`
  window.M = async (batches = 5, degrees = 1) => {
    const start = c.camera.getSnapshot();
    try {
      for (let i = 0; i < 5; i++) {
        turn(degrees);
        await frame();
      }
      const w = [];
      for (let k = 0; k < batches; k++) {
        const t = performance.now();
        for (let i = 0; i < 19; i++) {
          turn(degrees);
          c.tick(performance.now(), { isSynchronous: true });
        }
        turn(degrees);
        await frame();
        w.push((performance.now() - t) / 20);
      }
      w.sort((a, b) => a - b);
      return +w[batches >> 1].toFixed(1);
    } finally {
      c.camera.setState(start, 0);
    }
  };
  // the sweep: resolution (fragments) and graphics mode (spheres drawn)
  window.S = async () => {
    pl.animationLoop.stop();
    const px0 = ctx.pixelScale;
    const out = {};
    say('measuring: 8 steps of 105 frames each, do not move the camera…');
    try {
      out.still = await T();
      say(`still: ${out.still} ms`);
      out.turning = await M();
      say(`turning: ${out.turning} ms`);
      for (const s of [1, 0.5, 0.25]) {
        setPixelScale(s);
        await frame();
        out[`pixel scale ${s}`] = await T();
        say(`pixel scale ${s}: ${out[`pixel scale ${s}`]} ms`);
      }
      setPixelScale(px0);
      for (const m of ['quality', 'balanced', 'performance']) {
        await molstar.api.run('mesoscale.graphics', { mode: m });
        await new Promise((r) => setTimeout(r, 1500));
        // a mode also sets its own pixel scale (balanced 0.75, performance 0.5): put it back, so only the LOD changes
        setPixelScale(px0);
        out[`LOD of ${m}`] = await T();
        say(`LOD of ${m}: ${out[`LOD of ${m}`]} ms`);
      }
      await molstar.api.run('mesoscale.graphics', { mode: 'quality' });
      out.backend = g.capabilities?.backend;
      out.dpr = devicePixelRatio;
      out.viewport = `${c.camera.viewport.width}x${c.camera.viewport.height}`;
    } finally {
      setPixelScale(px0);
      pl.animationLoop.start();
    }
    console.table(out);
    say(JSON.stringify(out));
    return out;
  };
  say('ready: zoom in, then type  await S()  (about 40 s; each step prints a line)');
}
