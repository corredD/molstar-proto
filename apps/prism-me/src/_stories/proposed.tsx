/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  Button,
  type Child,
  type ObservableState,
  observableState,
  type ReadonlyState,
  Select,
  Show,
  Slider,
  watch,
} from '@molstar/prism-ui';
import { derive } from '@molstar/prism-ui/reactive/state';
import { classes } from './_generated/explorer.module.css.js';
import { Compartments, type MockNode } from './fake-scene.js';

// What the cellVIEW evaluation proposes (TODO.md, Proposed; progress/2026-10-28-cellview-evaluation.md), mocked for Ludo
// to judge before any brief: a cut graded per part (+ / 0 / −, the band, fuzziness), ghosts of what is cut, the aperture
// cut, a part shown in part. Not decided: the stories that show it are under Explorer/Proposed. The previews draw the
// rules of cellVIEW's cut (_spec/cellview.md §4.1, §4.2) on a 2D slice of dots, so the controls can be judged by eye.

/** What a cut does to one part (cellVIEW's + / 0 / −, and the part ignoring it: Prism's per-part cut today) */
export type CutBias = 'ignore' | 'keep' | 'cut' | 'wider';

const BiasOptions: [CutBias, string][] = [
  ['ignore', 'Ignores it'],
  ['keep', 'Keeps a layer'],
  ['cut', 'Cuts it'],
  ['wider', 'Cuts it wider'],
];

/** cellVIEW's stable random per instance (a Wang hash of its id, `Helper.cginc`): the same instances every frame */
export function stableRandom(id: number): number {
  let h = id >>> 0;
  h = h ^ 61 ^ (h >>> 16);
  h = Math.imul(h, 9);
  h ^= h >>> 4;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Whether a cut removes an instance (cellVIEW's object-space cut at full strength, _spec/cellview.md §4.1): `d` its
 * signed distance to the cut's surface (Å, ≤ 0 inside), `band` the band's width (Å), `fuzziness` 0–1, `r` its stable
 * random
 */
export function isCut(bias: CutBias, d: number, band: number, fuzziness: number, r: number): boolean {
  const inside = d <= 0;
  if (bias === 'ignore') return false;
  if (bias === 'cut') return inside;
  const nd = Math.abs(d) / Math.max(band, 0.01);
  // cellVIEW's `rand < 1 − p · lerp(1, 1 − fuzziness, nd)` at p = 1: affected inside the band, less toward its edge
  const passes = nd > 1 || r < fuzziness * nd;
  return bias === 'keep' ? inside && passes : inside || !passes;
}

/** A part's setting under one cut */
interface PartCut {
  readonly path: string;
  readonly bias: ObservableState<CutBias>;
  readonly band: ObservableState<number>;
  readonly fuzziness: ObservableState<number>;
}

/** The mock's cut over the HIV model's compartments: a membrane kept on the face, the capsid's inside cut wider */
function partCuts(): PartCut[] {
  const first: Record<string, [CutBias, number, number]> = {
    'envelope.membrane': ['keep', 60, 0.3],
    'envelope.surface': ['cut', 60, 0],
    'capsid.interior': ['wider', 80, 0.6],
    'capsid.surface': ['ignore', 60, 0],
    cytoplasm: ['cut', 60, 0],
  };
  return Compartments.map((path) => {
    const [bias, band, fuzziness] = first[path] ?? ['cut', 60, 0];
    return {
      path,
      bias: observableState<CutBias>(bias),
      band: observableState(band),
      fuzziness: observableState(fuzziness),
    };
  });
}

/** The previews' dots: a jittered grid on a 200 × 100 slice, each its own stable random */
const Dots = (() => {
  const out: { x: number; y: number; r: number }[] = [];
  let id = 1;
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 20; i++, id++) {
      out.push({
        x: 5 + i * 10 + (stableRandom(id * 7) - 0.5) * 6,
        y: 6 + j * 11 + (stableRandom(id * 13) - 0.5) * 6,
        r: stableRandom(id),
      });
    }
  }
  return out;
})();

/** The preview's half-width in Å: the slice spans ±250 Å around the cut's surface (cellVIEW's widest band) */
const HalfWidth = 250;

/**
 * A 2D slice through the cut: the cut's side shaded, its surface dashed, the part's instances as dots; a removed one is
 * gone, or an outline when ghosts are on (cellVIEW's ghosts, §4.3). Built once; a watch writes what changed.
 */
function CutPreview(props: {
  parts: readonly PartCut[];
  picked: ReadonlyState<number>;
  ghosts: ReadonlyState<boolean>;
}) {
  const circles: SVGElement[] = [];
  const svg = (
    <svg class={classes.preview} viewBox="0 0 200 100" role="img" aria-label="What the cut keeps of the part">
      <rect class={classes.previewCut} x="0" y="0" width="100" height="100" />
      <line class={classes.previewSurface} x1="100" y1="0" x2="100" y2="100" />
      {Dots.map((d) => (
        <circle ref={(el: SVGElement) => void circles.push(el)} cx={String(d.x)} cy={String(d.y)} r="3" />
      ))}
    </svg>
  );
  // every part's settings are sources (five parts, three each): the picked one's draw, a change to another draws nothing new
  const sources = props.parts.flatMap((p) => [p.bias.asReadonly, p.band.asReadonly, p.fuzziness.asReadonly]);
  watch([props.picked, props.ghosts, ...sources], () => {
    const p = props.parts[props.picked.value];
    const g = props.ghosts.value;
    for (let i = 0; i < Dots.length; i++) {
      const dot = Dots[i];
      const cut = isCut(p.bias.value, ((dot.x - 100) / 100) * HalfWidth, p.band.value, p.fuzziness.value, dot.r);
      circles[i].setAttribute('class', cut ? (g ? classes.previewGhost : classes.previewGone) : classes.previewKept);
    }
  });
  return svg;
}

const line = (label: string, child: Child) => (
  <div class={classes.line}>
    <span class={classes.lineLabel}>{label}</span>
    {child}
  </div>
);

const angstrom = { format: (v: number) => String(Math.round(v)), unit: 'Å' };
const percent = { format: (v: number) => String(Math.round(v * 100)), unit: '%' };

/** One part's line under a cut: what the cut does to it; the band and fuzziness where it keeps or widens */
function PartLine(props: { part: PartCut; picked: ReadonlyState<boolean>; onPick(): void }) {
  const { part } = props;
  const graded = derive(part.bias.asReadonly, (b) => b === 'keep' || b === 'wider');
  const name = part.path.split('.').join(' › ');
  return (
    <div class={classes.partCut} classList={{ [classes.partCutPicked]: props.picked }}>
      <div class={classes.line}>
        <Button size="sm" variant="ghost" class={classes.partName} title="Preview this part" onClick={props.onPick}>
          {name}
        </Button>
        <Select
          size="sm"
          aria-label={`What the cut does to ${name}`}
          options={BiasOptions}
          value={part.bias.asReadonly}
          onChange={(v) => {
            part.bias.set(v as CutBias);
            props.onPick();
          }}
        />
      </div>
      <Show when={graded}>
        {() => (
          <div class={classes.stack}>
            {line(
              'Band',
              <Slider
                aria-label={`${name}: the band's width`}
                value={part.band.asReadonly}
                min={5}
                max={HalfWidth}
                step={1}
                {...angstrom}
                onPreview={(v) => part.band.set(v)}
                onCommit={(v) => part.band.set(v)}
              />,
            )}
            {line(
              'Fuzziness',
              <Slider
                aria-label={`${name}: fuzziness`}
                value={part.fuzziness.asReadonly}
                min={0}
                max={1}
                step={0.01}
                {...percent}
                onPreview={(v) => part.fuzziness.set(v)}
                onCommit={(v) => part.fuzziness.set(v)}
              />,
            )}
          </div>
        )}
      </Show>
    </div>
  );
}

/** A toggle as the mocks make one: a small pressed button */
function Toggle(props: { on: ObservableState<boolean>; label: string; title: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      title={props.title}
      pressed={props.on.asReadonly}
      onClick={() => props.on.set(!props.on.value)}
    >
      {props.label}
    </Button>
  );
}

/**
 * A graded cut's properties (proposed items b and e): its shape (`shape`, the decided form), then what it does to each
 * part of the model, a preview of the picked part, and its ghosts
 */
export function GradedClip(props: { shape: Child; ghosts?: boolean }) {
  const parts = partCuts();
  const picked = observableState(0);
  const ghosts = observableState(!!props.ghosts);
  const name = derive(picked.asReadonly, (i) => parts[i].path.split('.').join(' › '));
  return (
    <div class={classes.stack}>
      {props.shape}
      <div class={classes.title}>
        <strong>What it cuts</strong>
        <span class={classes.hint}>per part; a layer kept or a wider cut thins out with fuzziness</span>
      </div>
      {parts.map((p, i) => (
        <PartLine part={p} picked={derive(picked.asReadonly, (j) => j === i)} onPick={() => picked.set(i)} />
      ))}
      <CutPreview parts={parts} picked={picked.asReadonly} ghosts={ghosts.asReadonly} />
      <span class={classes.hint}>{derive(name, (n) => `${n}: a slice through the cut, its side shaded`)}</span>
      {line(
        'Ghosts',
        <Toggle on={ghosts} label="Outline what it cuts" title="What the cut removes, drawn as outlines (context)" />,
      )}
    </div>
  );
}

/**
 * The aperture cut's properties (proposed item f, cellVIEW's visibility equalizer, _spec/cellview.md §4.2): the parts
 * it opens the view onto, how far from their outline's edge it opens, how much of what is in front it keeps near the
 * edge; a preview of the screen with the focus's outline
 */
export function ApertureClip(props: { ghosts?: boolean }) {
  const focus = Compartments.map((path) => ({ path, on: observableState(path.startsWith('capsid')) }));
  const opening = observableState(0.6);
  const keep = observableState(0.4);
  const ghosts = observableState(!!props.ghosts);
  const circles: SVGElement[] = [];
  const R = 38;
  const preview = (
    <svg class={classes.preview} viewBox="0 0 200 100" role="img" aria-label="What the aperture opens">
      <circle class={classes.previewFocus} cx="100" cy="50" r={String(R)} />
      {Dots.map((d) => (
        <circle ref={(el: SVGElement) => void circles.push(el)} cx={String(d.x)} cy={String(d.y)} r="3" />
      ))}
    </svg>
  );
  watch([opening.asReadonly, keep.asReadonly, ghosts.asReadonly], () => {
    for (let i = 0; i < Dots.length; i++) {
      const d = Dots[i];
      // inside the outline, its distance to the edge; near the edge (within the opening's band) kept at random
      const e = R - Math.hypot(d.x - 100, d.y - 50);
      const cut = e > 0 && (e >= (1 - opening.value) * R || d.r > keep.value);
      circles[i].setAttribute(
        'class',
        cut ? (ghosts.value ? classes.previewGhost : classes.previewGone) : classes.previewKept,
      );
    }
  });
  return (
    <div class={classes.stack}>
      <div class={classes.title}>
        <strong>Opens the view onto</strong>
        <span class={classes.hint}>what is in front of these parts is removed, most at their middle</span>
      </div>
      <div class={classes.chips}>
        {focus.map((f) => (
          <Toggle on={f.on} label={f.path.split('.').join(' › ')} title="A part the aperture opens onto" />
        ))}
      </div>
      {line(
        'Opening',
        <Slider
          aria-label="How far from the outline's edge it opens"
          value={opening.asReadonly}
          min={0}
          max={1}
          step={0.01}
          {...percent}
          onPreview={(v) => opening.set(v)}
          onCommit={(v) => opening.set(v)}
        />,
      )}
      {line(
        'Keep at edge',
        <Slider
          aria-label="How much of what is in front it keeps near the edge"
          value={keep.asReadonly}
          min={0}
          max={1}
          step={0.01}
          {...percent}
          onPreview={(v) => keep.set(v)}
          onCommit={(v) => keep.set(v)}
        />,
      )}
      {preview}
      <span class={classes.hint}>The screen: the parts' outline faint, what is in front of them as dots</span>
      {line(
        'Ghosts',
        <Toggle on={ghosts} label="Outline what it opens" title="What the aperture removes, drawn as outlines" />,
      )}
    </div>
  );
}

/** A part shown in part (proposed with item b: the same stable random): a share of its instances, the same ones always */
export function ShownShare(props: { node: MockNode }) {
  const share = observableState(props.node.kind === 'group' ? 0.35 : 1);
  return (
    <div class={classes.stack}>
      {line(
        'Shown',
        <Slider
          aria-label="The share of its instances shown"
          value={share.asReadonly}
          min={0}
          max={1}
          step={0.01}
          {...percent}
          onPreview={(v) => share.set(v)}
          onCommit={(v) => share.set(v)}
        />,
      )}
      <span class={classes.hint}>The same instances at every share and every frame: a crowded part thinned out</span>
    </div>
  );
}
