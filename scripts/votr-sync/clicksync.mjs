#!/usr/bin/env node
/**
 * Click-track sync test for Virus on the Rock: kicks every 0.5 s from 0.25 s (120 BPM), generated in the page (no
 * audio file in git). Per animation frame it records the audio element's clock, the audio context's heard time, the
 * drums/bass stems and the symmetry-axes drive, then reports how long after each kick the drive peaks:
 *   media: against audio.currentTime (the element's clock)
 *   heard: against what leaves the speakers, heard = media - (ctx.currentTime - ts.contextTime - age), age = (performance.now() - ts.performanceTime) / 1000
 * Pass (spec _spec/audio-routing-spec.md): kick -> peak <= 50 ms + one frame, the drive under 10% of its peak before the
 * next kick (for the drums-only route), and gain x2 -> peak x2 (1.9-2.1).
 *
 * node scripts/votr-sync/clicksync.mjs --port 1350 [--preset drums-bass-burst] [--seconds 8] [--headed]
 * Playwright is not a dependency: it is taken from `playwright` if resolvable, else from the npx cache.
 * @author Ludovic Autin <autin@scripps.edu>
 */
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
const port = +arg('port', '');
if (!Number.isInteger(port) || port <= 0) {
    console.error('--port is required: the dev server of your lane (1350 and up, node ./scripts/build.mjs -a virus-on-the-rock -p <port>); 1338 is Ludo\'s and a rebuild there stops his song');
    process.exit(2);
}
const preset = arg('preset', 'drums-bass-burst');
const seconds = +arg('seconds', 8);
const headed = argv.includes('--headed');

function loadPlaywright() {
    try { return createRequire(join(process.cwd(), 'x.js'))('playwright'); } catch (e) { /* fall through to the npx cache */ }
    const root = join(homedir(), '.npm', '_npx');
    if (existsSync(root)) {
        for (const d of readdirSync(root)) {
            const p = join(root, d, 'node_modules', 'playwright');
            if (existsSync(p)) return createRequire(join(p, 'x.js'))('playwright');
        }
    }
    throw new Error('playwright not found: run `npx playwright --version` once to fill the npx cache');
}
const { chromium } = loadPlaywright();

async function main() {

const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(`http://localhost:${port}/build/virus-on-the-rock/`);
await page.waitForFunction(() => !!window.__vorProbe, null, { timeout: 60000 });
await page.waitForTimeout(12000);

async function run(gainScale, routesSpec) {
    return page.evaluate(async ([gainScale, routesSpec, preset, seconds]) => {
        const app = window.__vorProbe; const m = app.viewer.plugin.managers.audioReactive;
        // the click track: a 60 Hz sine with a 70 ms decay and a 2 ms noise click on the attack (seeded, so the track is the same every run), every 0.5 s from 0.25 s
        let seed = 12345; // an LCG: Math.random would change the click's noise from run to run
        const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const sr = 44100, n = Math.ceil((seconds + 2) * sr), pcm = new Int16Array(n);
        for (let k = 0.25; k < seconds + 2; k += 0.5) {
            const s0 = Math.round(k * sr);
            for (let i = 0; i < 0.3 * sr && s0 + i < n; i++) {
                const t = i / sr;
                const v = 0.8 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t / 0.07) + (i < 0.002 * sr ? 0.3 * (rnd() * 2 - 1) : 0);
                pcm[s0 + i] += Math.round(Math.max(-1, Math.min(1, v)) * 32767);
            }
        }
        const head = new ArrayBuffer(44), dv = new DataView(head);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
        dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
        w(36, 'data'); dv.setUint32(40, n * 2, true);
        const file = new File([head, pcm.buffer], 'click120.wav', { type: 'audio/wav' });

        await app.applyAudioPreset(preset);
        if (routesSpec === 'drumsOnly') m.setRoutes(m.state.routes.value.filter(r => r.source === 'stemDrums' && r.target === 'symAxis'));
        if (routesSpec === 'bassOnly') m.setRoutes(m.state.routes.value.filter(r => r.source === 'stemBass' && r.target === 'symAxis'));
        for (const r of m.state.routes.value) m.updateRoute(r.id, { gain: r.gain * gainScale });
        await m.loadFile(file); await m.play();
        const a = m.state.audioPlayer.value; const ctx = m['audioContext']; const out = [];
        await new Promise(done => {
            const f = () => {
                const ts = ctx.getOutputTimestamp();
                // the heard time: what the element's clock read when the sample now leaving the speakers entered the graph
                // ts is a pair (a context time, the performance time it leaves the speakers): age it to now
                const age = (performance.now() - ts.performanceTime) / 1000;
                const lag = ts.contextTime > 0 ? ctx.currentTime - ts.contextTime - age : NaN;
                out.push([a.currentTime, a.currentTime - lag, m.stems.drums, m.stems.bass, m.drives.symAxis, lag]);
                if (a.currentTime < seconds) requestAnimationFrame(f); else done();
            };
            requestAnimationFrame(f);
        });
        m.stop();
        return { out, routes: m.state.routes.value.map(r => `${r.source}/${r.mode}->${r.target} g${r.gain.toFixed(2)}`), baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency };
    }, [gainScale, routesSpec, preset, seconds]);
}

const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f0 = x => Number.isFinite(x) ? x.toFixed(0) : 'n/a';
function analyse(label, { out, routes, baseLatency, outputLatency }) {
    const kicks = []; for (let t = 1.25; t < seconds - 0.5; t += 0.5) kicks.push(t); // skip the first second: envelopes settle
    const lagM = [], lagH = [], peaks = [], rests = [];
    for (const k of kicks) {
        const win = out.filter(r => r[0] >= k - 0.05 && r[0] < k + 0.4);
        if (!win.length) continue;
        const peak = win.reduce((b, r) => r[4] > b[4] ? r : b);
        lagM.push((peak[0] - k) * 1000); lagH.push((peak[1] - k) * 1000); peaks.push(peak[4]);
        const rest = out.filter(r => r[0] >= k + 0.4 && r[0] < k + 0.5).map(r => r[4]);
        if (rest.length) rests.push(Math.max(...rest) / peak[4]);
    }
    const dt = out.slice(1).map((r, i) => r[0] - out[i][0]).filter(x => x > 0);
    const out2 = out.map(r => r[5]).filter(Number.isFinite);
    console.log(`${label} | ${routes.join(', ')}`);
    console.log(`  frames ${out.length}, media step ${f0(med(dt) * 1000)} ms | output delay (ctx.currentTime - outputTimestamp.contextTime) median ${f0(med(out2) * 1000)} ms, ctx.baseLatency ${f0(baseLatency * 1000)} ms, outputLatency ${f0(outputLatency * 1000)} ms`);
    console.log(`  kick->peak MEDIA median ${f0(med(lagM))} ms (min ${f0(Math.min(...lagM))}, max ${f0(Math.max(...lagM))}) | HEARD median ${f0(med(lagH))} ms (min ${f0(Math.min(...lagH))}, max ${f0(Math.max(...lagH))}) | peak median ${med(peaks).toFixed(2)} | rest/peak median ${med(rests).toFixed(2)} max ${Math.max(...rests).toFixed(2)}`);
    return med(peaks);
}

console.log(`click track 120 BPM, kicks from 0.25 s, preset ${preset}, ${seconds} s, port ${port}`);
const p1 = analyse('full preset x1', await run(1, 'all'));
analyse('drums only x1', await run(1, 'drumsOnly'));
analyse('bass only x1', await run(1, 'bassOnly'));
const p2 = analyse('full preset x2', await run(2, 'all'));
console.log(`gain x2 -> peak ratio ${(p2 / p1).toFixed(2)} (expect 1.9-2.1)`);
await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
