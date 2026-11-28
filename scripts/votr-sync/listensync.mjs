#!/usr/bin/env node
/**
 * Listening check for Virus on the Rock's stem toggles: the click track (kicks every 0.5 s from 0.25 s, generated in the
 * page) is played twice with a stem model and an audio delay, the mix alone, then with the drums stem on. What reaches the
 * speakers is recorded in the page (every node that connects to the destination also feeds a script processor, stamped
 * with the context clock), and each run's kick onsets (the first 256-sample block over the threshold after a quiet one)
 * are listed. Pass: with the drums on, the mix is muted (the recording is the drums stem's, no mix) and a kick's onset
 * is within one render quantum (3 ms) + the model's seam error of the mix's, in context time.
 *
 * node scripts/votr-sync/listensync.mjs --port 1354 [--model spleeter|htdemucs|scnet] [--delay 12] [--seconds 30] [--headed]
 * Weights come from the model's remote base URL when not served locally (an 80-126 MB download on the first run).
 * @author Ludovic Autin <autin@scripps.edu>
 */
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
const port = +arg('port', '');
if (!Number.isInteger(port) || port <= 0) { console.error('--port is required (your lane\'s dev server)'); process.exit(2); }
const model = arg('model', 'spleeter');
const delay = +arg('delay', 12);
const seconds = +arg('seconds', 30);
const provider = arg('provider', 'wasm');
const headed = argv.includes('--headed');

function loadPlaywright() {
    try { return createRequire(join(process.cwd(), 'x.js'))('playwright'); } catch (e) { /* the npx cache */ }
    const root = join(homedir(), '.npm', '_npx');
    if (existsSync(root)) {
        for (const d of readdirSync(root)) {
            const p = join(root, d, 'node_modules', 'playwright');
            if (existsSync(p)) return createRequire(join(p, 'x.js'))('playwright');
        }
    }
    throw new Error('playwright not found: run `npx playwright --version` once');
}
const { chromium } = loadPlaywright();

async function main() {

const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
// every connection to a destination also feeds the recorder
await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    window.__rec = { blocks: [], proc: null, on: false };
    AudioNode.prototype.connect = function (target, ...rest) {
        const r = connect.call(this, target, ...rest);
        if (target instanceof AudioDestinationNode) {
            const ctx = this.context;
            if (!window.__rec.proc) {
                const proc = ctx.createScriptProcessor(256, 1, 1);
                proc.onaudioprocess = e => {
                    if (!window.__rec.on) return;
                    const d = e.inputBuffer.getChannelData(0);
                    let p = 0;
                    for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
                    // playbackTime: the context time this block plays
                    window.__rec.blocks.push([e.playbackTime, p]);
                };
                connect.call(proc, ctx.destination);
                window.__rec.proc = proc;
            }
            connect.call(this, window.__rec.proc);
        }
        return r;
    };
});
await page.goto(`http://localhost:${port}/build/virus-on-the-rock/`);
await page.waitForFunction(() => !!window.__vorProbe, null, { timeout: 60000 });
await page.waitForTimeout(12000);

async function run(listen) {
    return page.evaluate(async ([listen, model, delay, seconds, provider]) => {
        const app = window.__vorProbe, m = app.viewer.plugin.managers.audioReactive;
        m.setParams({ stemModel: model, stemExecutionProvider: provider, stemDelaySeconds: delay, lookahead: false });
        let seed = 12345;
        const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const sr = 44100, n = Math.ceil((seconds + delay + 2) * sr), pcm = new Int16Array(n);
        for (let k = 0.25; k < seconds + delay + 2; k += 0.5) {
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
        await m.loadFile(file);
        window.__rec.blocks = [];
        window.__rec.on = true;
        if (listen) m.setStemListen('drums', true);
        await m.play();
        const a = m.state.audioPlayer.value, ctx = m['audioContext'];
        const t0 = ctx.currentTime;
        await new Promise(done => { const f = () => a.currentTime < seconds + delay ? setTimeout(f, 200) : done(); f(); });
        window.__rec.on = false;
        const status = m.state.status.value.stemStatus;
        const mixGain = m['mixGain'].gain.value;
        m.setStemListen('drums', false);
        const afterMix = m['mixGain'].gain.value;
        m.stop();
        return { blocks: window.__rec.blocks, t0, status: `${status.state} ${status.message ?? ''}`, mixGain, afterMix };
    }, [listen, model, delay, seconds, provider]);
}

/** kick onsets in the context's time: the first block over the threshold after a quiet one */
function onsets(blocks, threshold) {
    const out = [];
    let quiet = true;
    for (const [t, p] of blocks) {
        if (p > threshold && quiet) { out.push(t); quiet = false; } else if (p < threshold / 4) quiet = true;
    }
    return out;
}
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log(`click track, ${model} on ${provider}, delay ${delay} s, ${seconds} s`);
const mix = await run(false);
console.log(`mix alone: stems ${mix.status}`);
const mixOn = onsets(mix.blocks, 0.1);
const stem = await run(true);
console.log(`drums on: stems ${stem.status}; mix gain at the end ${stem.mixGain.toFixed(2)}, after the toggle off ${stem.afterMix.toFixed(2)}`);
const stemOn = onsets(stem.blocks, 0.1);
// the kicks relative to the start of each run's playback: a run's first onset is the first kick (0.25 s) + D
const rel = (on, t0) => on.map(t => t - t0);
const a = rel(mixOn, mix.t0), b = rel(stemOn, stem.t0);
console.log(`onsets: mix ${a.length}, drums ${b.length}`);
// pair each drums onset with the mix's kick of the same index of the song (0.25 + 0.5 k + D): the stem's lag against the mix's own timing
const lags = [];
for (const t of b) {
    const k = Math.round((t - delay - 0.25) / 0.5);
    if (k < 0) continue;
    lags.push((t - (0.25 + 0.5 * k + delay)) * 1000);
}
const mixLags = a.map(t => (t - (0.25 + 0.5 * Math.round((t - delay - 0.25) / 0.5) + delay)) * 1000);
console.log(`kick onset vs its song time + D: mix median ${med(mixLags).toFixed(1)} ms, drums stem median ${med(lags).toFixed(1)} ms (min ${Math.min(...lags).toFixed(1)}, max ${Math.max(...lags).toFixed(1)}), difference ${(med(lags) - med(mixLags)).toFixed(1)} ms`);
await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
