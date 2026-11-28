#!/usr/bin/env node
/**
 * Click-track sync test for Virus on the Rock: kicks every 0.5 s from 0.25 s (120 BPM), generated in the page (no
 * audio file in git). Per animation frame it records the audio element's clock, the audio context's heard time, the
 * drums/bass stems and the symmetry-axes drive, then reports how long after each kick the drive peaks:
 *   media: against audio.currentTime (the element's clock)
 *   heard: against what leaves the speakers, heard = media - D - (ctx.currentTime - ts.contextTime - age), age = (performance.now() - ts.performanceTime) / 1000,
 *          D the audio delay (the manager's delay node)
 * The kick windows are on the heard column; the media column is reported less D.
 * Pass (spec _spec/audio-routing-spec.md): kick -> peak <= 50 ms + one frame (with lookahead and a delay: |heard kick ->
 * peak| <= one frame or 17 ms), the drive under 10% of its peak before the next kick (for the drums-only route), and
 * gain x2 -> peak x2 (1.9-2.1).
 *
 * node scripts/votr-sync/clicksync.mjs --port 1350 [--preset drums-bass-burst] [--seconds 8] [--headed]
 *     [--delay <s>] [--lookahead [--trim <ms>]] [--stems <spleeter|htdemucs|scnet> [--stem-lead <ms>]]
 * Without --lookahead the lookahead is set off (the app turns it on at startup). --delay 0 (the default) is the default
 * delay: the model's with --stems, 0.25 s with --lookahead, else none. --stem-lead overrides how far the model's stem
 * timeline runs ahead of the bands (the hidden param stemTimelineLeadMs; default the model's timelineLeadSeconds).
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
const delay = +arg('delay', 0);
const lookahead = argv.includes('--lookahead');
const trim = +arg('trim', 0);
const stems = arg('stems', 'off');
const stemLeadArg = arg('stem-lead', '');
const stemLead = stemLeadArg === '' ? null : +stemLeadArg;

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
    return page.evaluate(async ([gainScale, routesSpec, preset, seconds, sync]) => {
        const app = window.__vorProbe; const m = app.viewer.plugin.managers.audioReactive;
        // the sync params before the load: the delay lines are set with them
        m.setParams(sync);
        const D = sync.stemDelaySeconds > 0 ? sync.stemDelaySeconds : (sync.stemModel !== 'off' ? 12 : sync.lookahead ? 0.25 : 0);
        // the click track: a 60 Hz sine with a 70 ms decay and a 2 ms noise click on the attack (seeded, so the track is the same every run), every 0.5 s from 0.25 s
        let seed = 12345; // an LCG: Math.random would change the click's noise from run to run
        const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const sr = 44100, n = Math.ceil((seconds + D + 2) * sr), pcm = new Int16Array(n);
        for (let k = 0.25; k < seconds + D + 2; k += 0.5) {
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
        // the delays the manager set: what is heard, what is analysed
        const delayS = m['delayNode'].delayTime.value, leadS = delayS - m['analysisDelayNode'].delayTime.value;
        const stemLeadMs = m.state.params.value.stemTimelineLeadMs;
        await new Promise(done => {
            const f = () => {
                const ts = ctx.getOutputTimestamp();
                // the heard time: what the element's clock read when the sample now leaving the speakers entered the graph
                // ts is a pair (a context time, the performance time it leaves the speakers): age it to now; then one delay back
                const age = (performance.now() - ts.performanceTime) / 1000;
                const lag = ts.contextTime > 0 ? ctx.currentTime - ts.contextTime - age : NaN;
                const heard = a.currentTime - delayS - lag;
                out.push([a.currentTime, heard, m.stems.drums, m.stems.bass, m.drives.symAxis, lag, m.state.status.value.stemsSeparated ? 1 : 0]);
                if (!(heard >= seconds) && a.currentTime < seconds + delayS + 1) requestAnimationFrame(f); else done();
            };
            requestAnimationFrame(f);
        });
        m.stop();
        return {
            out, routes: m.state.routes.value.map(r => `${r.source}/${r.mode}->${r.target} g${r.gain.toFixed(2)}`), baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency,
            delayS, leadS, model: m.state.params.value.stemModel, stemLeadMs,
        };
    }, [gainScale, routesSpec, preset, seconds, { lookahead, lookaheadTrimMs: trim, stemModel: stems, stemDelaySeconds: delay, stemTimelineLeadMs: stemLead }]);
}

const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f0 = x => Number.isFinite(x) ? x.toFixed(0) : 'n/a';
function analyse(label, { out, routes, baseLatency, outputLatency, delayS, leadS, model, stemLeadMs }) {
    const kicks = []; for (let t = 1.25; t < seconds - 0.5; t += 0.5) kicks.push(t); // skip the first second: envelopes settle
    const lagM = [], lagH = [], peaks = [], rests = [], lagSep = [];
    // the windows on the heard column (r[1]); the media column less the delay
    const heardOut = out.filter(r => Number.isFinite(r[1]));
    for (const k of kicks) {
        const win = heardOut.filter(r => r[1] >= k - 0.05 && r[1] < k + 0.4);
        if (!win.length) continue;
        const peak = win.reduce((b, r) => r[4] > b[4] ? r : b);
        lagM.push((peak[0] - delayS - k) * 1000); lagH.push((peak[1] - k) * 1000); peaks.push(peak[4]);
        // with a stem model: the kicks whose whole window was separated (the stems, not the bands' fallback)
        if (win.every(r => r[6])) lagSep.push((peak[1] - k) * 1000);
        // less the lead: with lookahead the next kick's drive rises the lead before it is heard
        const rest = heardOut.filter(r => r[1] >= k + 0.4 - leadS && r[1] < k + 0.5 - leadS).map(r => r[4]);
        if (rest.length) rests.push(Math.max(...rest) / peak[4]);
    }
    const dt = out.slice(1).map((r, i) => r[0] - out[i][0]).filter(x => x > 0);
    const out2 = out.map(r => r[5]).filter(Number.isFinite);
    const separated = out.filter(r => r[1] >= 1.25 && r[1] < seconds);
    console.log(`${label} | ${routes.join(', ')}`);
    console.log(`  delay ${delayS.toFixed(3)} s, lead ${f0(leadS * 1000)} ms, stem model ${model}${model !== 'off' ? `, stem timeline lead ${stemLeadMs === null ? 'the model\'s' : `${stemLeadMs} ms`}, stems separated ${separated.filter(r => r[6]).length}/${separated.length} frames` : ''}`);
    console.log(`  frames ${out.length}, media step ${f0(med(dt) * 1000)} ms | output delay (ctx.currentTime - outputTimestamp.contextTime) median ${f0(med(out2) * 1000)} ms, ctx.baseLatency ${f0(baseLatency * 1000)} ms, outputLatency ${f0(outputLatency * 1000)} ms`);
    console.log(`  kick->peak MEDIA-D median ${f0(med(lagM))} ms (min ${f0(Math.min(...lagM))}, max ${f0(Math.max(...lagM))}) | HEARD median ${f0(med(lagH))} ms (min ${f0(Math.min(...lagH))}, max ${f0(Math.max(...lagH))}) | peak median ${med(peaks).toFixed(2)} | rest/peak median ${med(rests).toFixed(2)} max ${Math.max(...rests).toFixed(2)}`);
    if (model !== 'off') console.log(`  separated kicks only (the whole window separated): ${lagSep.length}/${lagH.length} kicks, HEARD median ${f0(med(lagSep))} ms (min ${f0(Math.min(...lagSep))}, max ${f0(Math.max(...lagSep))})`);
    return med(peaks);
}

console.log(`click track 120 BPM, kicks from 0.25 s, preset ${preset}, ${seconds} s, port ${port}, delay asked ${delay > 0 ? `${delay} s` : 'default'} (none without --stems or --lookahead), lookahead ${lookahead ? `on, trim ${trim} ms` : 'off'}, stems ${stems}${stemLead !== null ? `, stem timeline lead ${stemLead} ms` : ''}`);
const p1 = analyse('full preset x1', await run(1, 'all'));
analyse('drums only x1', await run(1, 'drumsOnly'));
analyse('bass only x1', await run(1, 'bassOnly'));
const p2 = analyse('full preset x2', await run(2, 'all'));
console.log(`gain x2 -> peak ratio ${(p2 / p1).toFixed(2)} (expect 1.9-2.1)`);
await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
