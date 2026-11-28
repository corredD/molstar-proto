#!/usr/bin/env node
/**
 * Listening check for Virus on the Rock's stem toggles, in one run: the click track (kicks every 0.5 s from 0.25 s, with
 * an 80 Hz tone under it, generated in the page) plays with a stem model and an audio delay, drums and bass on. Three
 * silent script processors tap, at sample resolution on the context clock, the unmuted mix (the delay node's output),
 * the mix as heard (through its mute gain) and the drums stem (after its gain). Reported: each kick's onset on the drums
 * stem minus its onset in the mix (PASS within one render quantum, 3 ms; a stem a few ms early is the STFT's pre-echo
 * on the attack, reported as measured), the mix's peak after the first stem chunk plays (PASS under 0.01: muted), the
 * mix gain 50 ms after the toggles go off (1: back), and the largest sample-to-sample step of the bass stem at each chunk
 * seam against its largest step elsewhere (a click shows as a ratio well over 1).
 *
 * node scripts/votr-sync/listensync.mjs --port 1354 [--model spleeter|htdemucs|scnet] [--delay 12] [--seconds 30]
 *     [--provider wasm|webgpu] [--headed]
 * Weights come from the model's remote base URL when not served locally (an 80-126 MB download on the first run).
 * `--provider webgpu --headed` for HTDemucs and SCNet, which wasm runs slower than real time.
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
page.on('pageerror', e => console.error('pageerror', e.message, e.stack));
await page.goto(`http://localhost:${port}/build/virus-on-the-rock/`);
await page.waitForFunction(() => !!window.__vorProbe, null, { timeout: 60000 });
await page.waitForTimeout(12000);

const result = await page.evaluate(async ([model, delay, seconds, provider]) => {
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
    // the sustained tone under the kicks, in the bass: a seam shows in it
    for (let i = 0; i < n; i++) pcm[i] += Math.round(0.05 * Math.sin(2 * Math.PI * 80 * i / sr) * 32767);
    const head = new ArrayBuffer(44), dv = new DataView(head);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, n * 2, true);
    const file = new File([head, pcm.buffer], 'click120.wav', { type: 'audio/wav' });
    // the click track is added with the tone: scale down the sum's peak a little
    await m.loadFile(file);
    const ctx = m['audioContext'], player = m['stemPlayer'];
    // the taps: silent script processors, each recording its input at sample resolution on the context clock
    const seams = [];
    const tap = (node, keep) => {
        const proc = ctx.createScriptProcessor(256, 1, 1);
        // peaks per block; the largest step away from the chunk seams, and at each seam (the seams are known D ahead)
        const rec = { onsets: [], peakAfter: [], loud: [], stepAway: 0, stepAt: new Map(), last: 0, lastOnset: -1, on: false };
        proc.onaudioprocess = e => {
            if (!rec.on) return;
            const d = e.inputBuffer.getChannelData(0), t0 = e.playbackTime;
            let peak = 0;
            for (let i = 0; i < d.length; i++) {
                const a = Math.abs(d[i]);
                if (a > peak) peak = a;
                // an onset: over 0.15, 0.25 s after the last (kicks are 0.5 s apart)
                const t = t0 + i / ctx.sampleRate;
                if (a > 0.15 && t - rec.lastOnset > 0.25) { rec.onsets.push(t); rec.lastOnset = t; }
                if (keep) {
                    const step = Math.abs(d[i] - rec.last);
                    const seam = seams.find(x => Math.abs(t - x) < 0.003);
                    if (seam === undefined) rec.stepAway = Math.max(rec.stepAway, step);
                    else rec.stepAt.set(seam, Math.max(rec.stepAt.get(seam) || 0, step));
                }
                rec.last = d[i];
            }
            // ranges of loud blocks, not every block
            const last = rec.loud[rec.loud.length - 1];
            if (peak > 0.05) { if (last && t0 - last[1] < 0.01) last[1] = t0; else rec.loud.push([t0, t0]); }
            rec.peakAfter.push([t0, peak]);
        };
        node.connect(proc);
        proc.connect(ctx.destination);
        return rec;
    };
    const mixTap = tap(m['delayNode']), heardTap = tap(m['mixGain']), drumsTap = tap(player['gains'].drums), bassTap = tap(player['gains'].bass, true);
    // the chunk seams, in context time: each chunk's start + D
    const schedule = player.schedule.bind(player);
    player.schedule = chunk => { seams.push(chunk.time + delay); schedule(chunk); };
    for (const t of [mixTap, heardTap, drumsTap, bassTap]) t.on = true;
    m.setStemListen('drums', true);
    m.setStemListen('bass', true);
    await m.play();
    const a = m.state.audioPlayer.value;
    await new Promise(done => { const f = () => a.currentTime < seconds + delay ? setTimeout(f, 200) : done(); f(); });
    const status = m.state.status.value.stemStatus;
    const gainBefore = m['mixGain'].gain.value;
    const firstHeardAt = player['firstHeardAt'];
    // the mix as heard stops being recorded before the toggles go off: the mix comes back then
    heardTap.on = false;
    m.setStemListen('drums', false);
    m.setStemListen('bass', false);
    await new Promise(r => setTimeout(r, 80));
    const gainAfter = m['mixGain'].gain.value;
    for (const t of [mixTap, heardTap, drumsTap, bassTap]) t.on = false;
    m.stop();
    bassTap.stepAt = [...bassTap.stepAt.entries()];
    for (const t of [mixTap, heardTap, drumsTap, bassTap]) t.peakAfter = t.peakAfter.filter((_, i) => i % 8 === 0);
    return { firstHeardAt, mix: mixTap, heard: heardTap, drums: drumsTap, bass: bassTap, seams, status: `${status.state} ${status.message || ''}`, gainBefore, gainAfter };
}, [model, delay, seconds, provider]);

const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`click track + 80 Hz tone, ${model} on ${provider}, delay ${delay} s, ${seconds} s: stems ${result.status}`);
// the drums stem's onset against the mix's, for the kicks both have
const mixOn = result.mix.onsets, drumsOn = result.drums.onsets;
const diffs = [];
for (const t of drumsOn) {
    const near = mixOn.reduce((b, x) => Math.abs(x - t) < Math.abs(b - t) ? x : b, Infinity);
    if (Math.abs(near - t) < 0.1) diffs.push((t - near) * 1000);
}
const firstStem = drumsOn.length ? drumsOn[0] : Infinity;
console.log(`first stem chunk heard at ${result.firstHeardAt.toFixed(3)} s; drums stem first onset ${firstStem.toFixed(3)}; mix as heard loud in ${result.heard.loud.slice(0, 6).map(r => `[${r[0].toFixed(3)}, ${r[1].toFixed(3)}]`).join(' ')}`);
console.log(`kick onsets: mix ${mixOn.length}, drums stem ${drumsOn.length}; stem minus mix over ${diffs.length} kicks: median ${med(diffs).toFixed(2)} ms (min ${Math.min(...diffs).toFixed(2)}, max ${Math.max(...diffs).toFixed(2)})`);
const sorted = [...diffs].sort((x, y) => x - y), p90 = Math.max(Math.abs(sorted[Math.floor(0.05 * sorted.length)]), Math.abs(sorted[Math.floor(0.95 * sorted.length)]));
console.log(`  ${Math.abs(med(diffs)) <= 3 && p90 <= 6 ? 'PASS' : 'FAIL'} (median within one render quantum, 3 ms; 90% of the kicks within 6 ms: ${p90.toFixed(2)})`);
const heardPeak = Math.max(0, ...result.heard.peakAfter.filter(([t]) => t > firstStem + 0.05).map(([, p]) => p));
console.log(`mix as heard, after the first stem chunk plays: peak ${heardPeak.toFixed(4)} (${heardPeak < 0.01 ? 'PASS: muted' : 'FAIL: audible'}); mix gain at the end ${result.gainBefore.toFixed(2)}, 80 ms after the toggles off ${result.gainAfter.toFixed(2)} (${result.gainAfter > 0.99 ? 'PASS' : 'FAIL'})`);
// the bass stem's step at each seam against its largest step elsewhere
const normal = result.bass.stepAway;
const atSeams = result.bass.stepAt.map(([, v]) => v);
const worst = Math.max(0, ...atSeams);
console.log(`bass stem: largest step away from seams ${normal.toFixed(4)}; at ${atSeams.length} seams: max ${worst.toFixed(4)} (ratio ${(worst / normal).toFixed(2)}; ${worst / normal < 2 ? 'PASS' : 'seams click'})`);
await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
