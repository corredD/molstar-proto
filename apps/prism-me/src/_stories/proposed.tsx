/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  Button,
  type Child,
  For,
  Icon,
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
import { classes as propertyClasses } from '../explorer/_generated/properties.module.css.js';
import { type ClipShape, type ClipUse, ClipTargets, type CutBias, clipBook, type MockClip } from './clip-book.js';
import type { MockNode } from './fake-scene.js';

// What the cellVIEW evaluation proposes (TODO.md, Next; progress/2026-10-28-cellview-evaluation.md), mocked for Ludo
// to judge before any brief; under Explorer/Proposed, apart from the decided mocks. Clips are objects of their own (the
// tree's Clips category, Ludo 2026-10-28): a clip says what it cuts and how (graded per object or part: + / 0 / −, the
// band, fuzziness), and every object or part says which clips are on it, adds a new one or uses an existing one; both
// edit one table (`clip-book.ts`). The previews draw cellVIEW's rules (_spec/cellview.md §4.1, §4.2) on 2D dots.

const CutOptions: [CutBias, string][] = [
  ['keep', 'Keeps a layer'],
  ['cut', 'Cuts it'],
  ['wider', 'Cuts it wider'],
];
const ApertureOptions: [CutBias, string][] = [['focus', 'Opens onto it']];
const optionsOf = (shape: ClipShape | undefined) => (shape === 'aperture' ? ApertureOptions : CutOptions);

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
  if (bias === 'cut' || bias === 'focus') return inside;
  const nd = Math.abs(d) / Math.max(band, 0.01);
  // cellVIEW's `rand < 1 − p · lerp(1, 1 − fuzziness, nd)` at p = 1: affected inside the band, less toward its edge
  const passes = nd > 1 || r < fuzziness * nd;
  return bias === 'keep' ? inside && passes : inside || !passes;
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

const dotClass = (cut: boolean, ghosts: boolean) =>
  cut ? (ghosts ? classes.previewGhost : classes.previewGone) : classes.previewKept;

/**
 * A 2D slice through a cut, for one use: the cut's side shaded, its surface dashed, the node's instances as dots; a
 * removed one is gone, or an outline when ghosts are on (cellVIEW's ghosts, §4.3). Built once; a watch writes the dots.
 */
function CutPreview(props: { use: ClipUse; ghosts: ReadonlyState<boolean> }) {
  const { use } = props;
  const circles: SVGElement[] = [];
  const svg = (
    <svg class={classes.preview} viewBox="0 0 200 100" role="img" aria-label={`What the cut keeps of ${use.nodeLabel}`}>
      <rect class={classes.previewCut} x="0" y="0" width="100" height="100" />
      <line class={classes.previewSurface} x1="100" y1="0" x2="100" y2="100" />
      {Dots.map((d) => (
        <circle ref={(el: SVGElement) => void circles.push(el)} cx={String(d.x)} cy={String(d.y)} r="3" />
      ))}
    </svg>
  );
  watch([use.bias.asReadonly, use.band.asReadonly, use.fuzziness.asReadonly, props.ghosts], () => {
    for (let i = 0; i < Dots.length; i++) {
      const dot = Dots[i];
      const d = ((dot.x - 100) / 100) * HalfWidth;
      const cut = isCut(use.bias.value, d, use.band.value, use.fuzziness.value, dot.r);
      circles[i].setAttribute('class', dotClass(cut, props.ghosts.value));
    }
  });
  return svg;
}

const line = (label: Child, child: Child) => (
  <div class={classes.line}>
    <span class={propertyClasses.lineLabel}>{label}</span>
    {child}
  </div>
);

const Angstrom = { format: (v: number) => String(Math.round(v)), unit: 'Å' };
const Percent = { format: (v: number) => String(Math.round(v * 100)), unit: '%' };

/** A slider writing `state` as it is dragged (the mock's: no operation, no step) */
function slider(label: string, state: ObservableState<number>, range: { min: number; max: number; step: number }) {
  const unit = range.max > 1 ? Angstrom : Percent;
  return (
    <Slider
      aria-label={label}
      value={state.asReadonly}
      {...range}
      {...unit}
      onPreview={(v) => state.set(v)}
      onCommit={(v) => state.set(v)}
    />
  );
}

/**
 * One use's line: its name (the node on a clip's list, the clip on a node's), what the clip does to it, and remove;
 * under it the band and fuzziness where it keeps a layer or cuts wider
 */
function UseLine(props: { use: ClipUse; name: string; picked?: ReadonlyState<boolean>; onPick?(): void }) {
  const { use } = props;
  const shape = clipBook.clip(use.clip)?.shape;
  const graded = derive(use.bias.asReadonly, (b) => b === 'keep' || b === 'wider');
  // the last thing a clip cuts has no × (the app's, Prism's clipping.apply refuses it: remove the clip instead)
  const last = derive(clipBook.uses.asReadonly, (all) => all.filter((u) => u.clip === use.clip).length === 1);
  return (
    <div class={classes.partCut} classList={{ [classes.partCutPicked]: props.picked ?? false }}>
      <div class={classes.line}>
        <Button
          size="sm"
          variant="ghost"
          class={classes.partName}
          title={props.onPick ? 'Preview it' : `Pick ${props.name} in the tree`}
          onClick={() => (props.onPick ? props.onPick() : console.info(`[explorer mock] pick ${props.name}`))}
        >
          {props.name}
        </Button>
        <Select
          size="sm"
          aria-label={`What it does to ${props.name}`}
          options={optionsOf(shape)}
          value={use.bias.asReadonly}
          onChange={(v) => {
            use.bias.set(v as CutBias);
            props.onPick?.();
          }}
        />
        <Button
          size="xs"
          variant="ghost"
          class={classes.partRemove}
          title={derive(last, (l) =>
            l
              ? 'No longer affected by this clip (all it cuts: remove the clip instead)'
              : 'No longer affected by this clip',
          )}
          disabled={last}
          icon={<Icon name="x" />}
          onClick={() => clipBook.drop(use)}
        />
      </div>
      <Show when={graded}>
        {() => (
          <div class={propertyClasses.stack}>
            {line('Band', slider(`${props.name}: the band's width`, use.band, { min: 5, max: HalfWidth, step: 1 }))}
            {line('Fuzziness', slider(`${props.name}: fuzziness`, use.fuzziness, { min: 0, max: 1, step: 0.01 }))}
          </div>
        )}
      </Show>
    </div>
  );
}

/** A toggle as the mocks make one: a small pressed button */
function Toggle(props: { on: ReadonlyState<boolean>; label: string; title: string; onClick(): void }) {
  return (
    <Button size="sm" variant="ghost" title={props.title} pressed={props.on} onClick={props.onClick}>
      {props.label}
    </Button>
  );
}

/** A picker that runs its choice and goes back to its placeholder (Cut also, New clip, Use a clip) */
function AddSelect(props: {
  label: string;
  placeholder: string;
  options: ReadonlyState<readonly (readonly [string, string])[]>;
  onPick(id: string): void;
}) {
  return (
    <For each={derive(props.options, (o) => [o])} by={(o) => o.map(([id]) => id).join()}>
      {(options) => (
        <Select
          size="sm"
          aria-label={props.label}
          options={[['', props.placeholder], ...options] as [string, string][]}
          value=""
          onChange={(id) => {
            if (id) props.onPick(id);
          }}
        />
      )}
    </For>
  );
}

/**
 * A clip's properties (proposed items b, e; clips in their own category): its shape (`shape`, the decided form), What it
 * cuts (every object or part it is given, each its way), Cut also, a preview of the picked use, and its ghosts
 */
export function ClipProperties(props: { node: MockNode; shape: Child }) {
  const clip = clipBook.clip(props.node.key);
  if (!clip) return <span class={propertyClasses.hint}>This clip was removed.</span>;
  if (clip.shape === 'aperture') return <ApertureClip clip={clip} />;
  const uses = derive(clipBook.uses.asReadonly, (all) => all.filter((u) => u.clip === clip.key));
  const picked = observableState<ClipUse | undefined>(uses.value[0]);
  const ghosts = observableState(false);
  const free = derive(uses, (us) => ClipTargets.filter(([k]) => !us.some((u) => u.node === k)));
  return (
    <div class={propertyClasses.stack}>
      {props.shape}
      <div class={propertyClasses.title}>
        <strong>What it cuts</strong>
        <span class={propertyClasses.hint}>each object or part its way</span>
      </div>
      <For each={uses} by={(u) => u.node}>
        {(u) => (
          <UseLine
            use={u}
            name={u.nodeLabel}
            picked={derive(picked.asReadonly, (p) => p === u)}
            onPick={() => picked.set(u)}
          />
        )}
      </For>
      {line(
        'Cut also',
        <AddSelect
          label="An object or part this clip also cuts"
          placeholder="An object or part…"
          options={free}
          onPick={(k) => clipBook.use(clip.key, k, 'cut')}
        />,
      )}
      <For each={derive(picked.asReadonly, (p) => (p ? [p] : []))} by={(u) => u.node}>
        {(u) => (
          <div class={propertyClasses.stack}>
            <CutPreview use={u} ghosts={ghosts.asReadonly} />
            <span class={propertyClasses.hint}>{`${u.nodeLabel}: a slice through the cut, its side shaded`}</span>
          </div>
        )}
      </For>
      {line(
        'Ghosts',
        <Toggle
          on={ghosts.asReadonly}
          label="Outline what it cuts"
          title="What the cut removes, drawn as outlines (context)"
          onClick={() => ghosts.set(!ghosts.value)}
        />,
      )}
    </div>
  );
}

/**
 * The aperture cut (proposed item f, cellVIEW's visibility equalizer, _spec/cellview.md §4.2): the parts it opens the
 * view onto (its uses), how far from their outline's edge it opens, how much of what is in front it keeps near the edge
 */
function ApertureClip(props: { clip: MockClip }) {
  const { clip } = props;
  const opening = observableState(0.6);
  const keep = observableState(0.4);
  const ghosts = observableState(false);
  const focus = derive(
    clipBook.uses.asReadonly,
    (all) => new Set(all.filter((u) => u.clip === clip.key).map((u) => u.node)),
  );
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
      circles[i].setAttribute('class', dotClass(cut, ghosts.value));
    }
  });
  const toggle = (node: string) => {
    const use = clipBook.uses.value.find((u) => u.clip === clip.key && u.node === node);
    if (use) clipBook.drop(use);
    else clipBook.use(clip.key, node, 'focus');
  };
  return (
    <div class={propertyClasses.stack}>
      <div class={propertyClasses.title}>
        <strong>Opens the view onto</strong>
        <span class={propertyClasses.hint}>what is in front of these is removed, most at their middle</span>
      </div>
      <div class={classes.chips}>
        {ClipTargets.filter(([k]) => k.startsWith('g:hiv')).map(([k, label]) => (
          <Toggle
            on={derive(focus, (f) => f.has(k))}
            label={label}
            title="A part the aperture opens onto"
            onClick={() => toggle(k)}
          />
        ))}
      </div>
      {line('Opening', slider("How far from the outline's edge it opens", opening, { min: 0, max: 1, step: 0.01 }))}
      {line(
        'Keep at edge',
        slider('How much of what is in front it keeps near the edge', keep, { min: 0, max: 1, step: 0.01 }),
      )}
      {preview}
      <span class={propertyClasses.hint}>The screen: the parts' outline faint, what is in front of them as dots</span>
      {line(
        'Ghosts',
        <Toggle
          on={ghosts.asReadonly}
          label="Outline what it opens"
          title="What the aperture removes, drawn as outlines"
          onClick={() => ghosts.set(!ghosts.value)}
        />,
      )}
    </div>
  );
}

const NewClipOptions: readonly (readonly [string, string])[] = [
  ['plane', 'Plane'],
  ['sphere', 'Sphere'],
  ['box', 'Box'],
  ['aperture', 'Aperture: open the view onto it'],
];
const newClipOptions = observableState(NewClipOptions).asReadonly;

/**
 * An object's or part's clips (Ludo, 2026-10-28: clips in their own category, pointed at from here): the clips on it,
 * each what it does to it (and remove it from that clip), a new clip that cuts it, or an existing clip used on it
 */
export function NodeClips(props: { node: MockNode }) {
  const { node } = props;
  if (node.key === 'c:clips')
    return <span class={propertyClasses.hint}>Every clip of the scene. Pick one to see what it cuts.</span>;
  if (!ClipTargets.some(([k]) => k === node.key))
    return (
      <span class={propertyClasses.hint}>
        In the mock, clips are given to the objects and the HIV model's compartments: pick one of those.
      </span>
    );
  const uses = derive(clipBook.uses.asReadonly, (all) => all.filter((u) => u.node === node.key));
  const others = derive([clipBook.clips.asReadonly, uses], (clips, us) =>
    clips.filter((c) => !us.some((u) => u.clip === c.key)).map((c) => [c.key, c.label] as const),
  );
  return (
    <div class={propertyClasses.stack}>
      <Show
        when={derive(uses, (us) => us.length > 0)}
        fallback={() => <span class={propertyClasses.hint}>No clip on it. Make one, or use one of the scene's.</span>}
      >
        {() => (
          <For each={uses} by={(u) => u.clip}>
            {(u) => <UseLine use={u} name={clipBook.clip(u.clip)?.label ?? u.clip} />}
          </For>
        )}
      </Show>
      {line(
        'New clip',
        <AddSelect
          label="A new clip that cuts it"
          placeholder="Its shape…"
          options={newClipOptions}
          onPick={(shape) => clipBook.add(shape as ClipShape, node.key)}
        />,
      )}
      {line(
        'Use a clip',
        <AddSelect
          label="A clip of the scene, used on it too"
          placeholder="A clip of the scene…"
          options={others}
          onPick={(k) => clipBook.use(k, node.key, clipBook.clip(k)?.shape === 'aperture' ? 'focus' : 'cut')}
        />,
      )}
    </div>
  );
}

/** A part shown in part (proposed with item b: the same stable random): a share of its instances, the same ones always */
export function ShownShare(props: { node: MockNode }) {
  const share = observableState(props.node.kind === 'group' ? 0.35 : 1);
  return (
    <div class={propertyClasses.stack}>
      {line('Shown', slider('The share of its instances shown', share, { min: 0, max: 1, step: 0.01 }))}
      <span class={propertyClasses.hint}>
        The same instances at every share and every frame: a crowded part thinned out
      </span>
    </div>
  );
}
