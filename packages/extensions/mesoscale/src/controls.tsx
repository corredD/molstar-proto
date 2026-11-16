/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  Button,
  Choices,
  ColorPicker,
  For,
  Icon,
  Select,
  type SelectOption,
  Show,
  Slider,
  TextInput,
} from '@molstar/prism-ui';
import { Color } from '@molstar/core/util/color';
import { effect, onCleanup } from '@molstar/prism-ui/dom/scope';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ViewerApi } from '@molstar/prism-viewer/api/area';
import { gestureSteps } from '@molstar/prism-viewer/sources/gesture-steps';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { classes } from './_generated/controls.module.css.js';
import {
  DefaultCustomLevels,
  type MembraneDetail,
  type MembraneLevel,
  type MembraneMiddle,
  MiddlePxMin,
} from './lipids/membrane.js';
import type { MembraneFar } from './lipids/procedural.js';
import { GrowFit, PaintFit } from './fit-controls.js';
import { type GrowRecord, tilingTotal } from './grow.js';
import { linkedValue } from './grow-link.js';
import { symmetryContact } from './grow-symmetry.js';
import {
  type GraphicsInfo,
  type GraphicsMode,
  type GrowSettings,
  growParams,
  type MesoscaleApi,
} from './operations.js';
import type { PaintSettings } from './paint-mode.js';

// The mesoscale controls, shown by the extension's Entities tab and by a host's panels (prism-me's properties): the
// graphics mode (every object's, or one object's) and the motion, as the representations have them, and the color
// file import. They act through the `mesoscale` area: a slider once released (one step). Prism's tokens and label
// column (controls.module.css).

const ModeChoices = [
  { id: 'ultra', label: 'Ultra' },
  { id: 'quality', label: 'Quality' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'performance', label: 'Fast' },
];

/** The graphics mode of every object and the canvas's resolution */
export function GraphicsMode(props: { area: MesoscaleApi }) {
  const graphics = props.area.graphicsState();
  return (
    <Choices
      choices={ModeChoices}
      active={mapState(graphics, (g) => g?.mode ?? '')}
      onPick={(id) => void props.area.graphics({ mode: id as GraphicsMode })}
    />
  );
}

/** Far proteins (`mesoscale.impostors`, lod-impostor.md): silhouettes (impostors) or spheres */
const FarChoices = [
  { id: 'silhouettes', label: 'Silhouettes' },
  { id: 'spheres', label: 'Spheres' },
];

/**
 * One object's graphics (apps/prism-me/_spec/ui.md §4, Graphics & Motion): its quality, its far proteins as silhouettes
 * or spheres (a model drawn by its structures), and its wiggle and tumble when it moves (`motion`: a structure, a
 * particle list; not a volume). Each acts on that object alone.
 */
export function ObjectGraphics(props: { area: MesoscaleApi; object: string; motion: boolean; api?: ViewerApi }) {
  const graphics = props.area.graphicsState(props.object);
  return (
    <div class={classes.stack}>
      <Choices
        label="Quality"
        choices={ModeChoices}
        active={mapState(graphics, (g) => g?.mode ?? '')}
        onPick={(id) => void props.area.graphics({ mode: id as GraphicsMode, object: props.object } as never)}
      />
      <Show when={mapState(graphics, (g) => g?.impostors !== undefined)}>
        {() => (
          <div class={classes.tight}>
            <Choices
              label="Far proteins"
              choices={FarChoices}
              active={mapState(graphics, (g) => (g?.impostors === false ? 'spheres' : 'silhouettes'))}
              onPick={(id) => void props.area.impostors({ on: id === 'silhouettes', particles: props.object } as never)}
            />
            {/* where they start, while they are silhouettes (Ludo, 2026-11-15) */}
            <Show when={mapState(graphics, (g) => !!props.api && g?.impostors === true)}>
              {() => <FarSwitch area={props.area} api={props.api!} object={props.object} graphics={graphics} />}
            </Show>
          </div>
        )}
      </Show>
      {props.motion ? <MotionRows area={props.area} graphics={graphics} of={{ object: props.object }} /> : null}
    </div>
  );
}

/** Where the silhouettes start (`mesoscale.impostors` by, pixels, distance; lod-impostor.md) */
const SwitchChoices = [
  { id: 'size', label: 'Size on screen' },
  { id: 'distance', label: 'Distance' },
];

/** The far-distance slider's end: 20 times the model's radius, 4 times the distance set, at least 1000 Å */
export function farDistanceMax(radius: number, committed: number) {
  return Math.max(1000, Math.round(radius * 20), Math.round(committed * 4));
}

/** The thinning's threshold in the box: "off" at 0 (and typed) */
const formatThin = (v: number) => (v > 0 ? `${+v.toFixed(2)}` : 'off');
/** "off" 0; a number with a point or a comma; anything else NaN (the box goes back) */
const parseThin = (text: string) => (/^\s*off\s*$/i.test(text) ? 0 : Number(text.trim().replace(',', '.') || NaN));

/**
 * Where a model's far proteins turn into silhouettes, shown while they do: by each protein's size on screen (below N
 * pixels) or its distance from the eye (beyond D); the far silhouettes thinned out (below a size, 0 off) and how much
 * the kept ones are enlarged; a slider live while dragged (previews), one step on release
 */
function FarSwitch(props: {
  area: MesoscaleApi;
  api: ViewerApi;
  object: string;
  graphics: ReadonlyState<GraphicsInfo | undefined>;
}) {
  const sw = mapState(props.graphics, (g) => g?.impostorSwitch);
  const overlaid = observableState(0);
  const steps = gestureSteps<{ pixels?: number; distance?: number }>(props.api, {
    label: 'Where the silhouettes start',
    apply: (g, _key, change) => g.run('mesoscale.impostors', { particles: props.object, ...change }),
    changed: () => overlaid.set(overlaid.value + 1),
  });
  // the thinning's steps their own (their label in the history)
  const thinSteps = gestureSteps<{ thin?: number; thinScale?: number }>(props.api, {
    label: 'How far silhouettes thin out',
    apply: (g, _key, change) => g.run('mesoscale.impostors', { particles: props.object, ...change }),
    changed: () => overlaid.set(overlaid.value + 1),
  });
  onCleanup(() => {
    steps.settle();
    thinSteps.settle();
  });
  // the slider's end, held while dragged: the previews apply, so a max of the state's distance would follow the knob
  let max = 0;
  let dragging = false;
  const shown = derive([sw, overlaid.asReadonly] as const, (s) => {
    const o = steps.overlay('switch');
    const t = thinSteps.overlay('thin');
    if (!dragging || !max) max = farDistanceMax(s?.radius ?? 0, s?.distance || s?.applied || 1000);
    return {
      by: s?.by ?? 'size',
      pixels: o?.pixels ?? s?.pixels ?? 12,
      distance: o?.distance ?? (s?.distance || s?.applied || 1000),
      max,
      thin: t?.thin ?? s?.thin ?? 8,
      thinScale: t?.thinScale ?? s?.thinScale ?? 1,
    };
  });
  const change = (patch: { pixels?: number; distance?: number }, end: boolean) => {
    dragging = !end;
    steps.change('switch', patch);
    if (end) steps.settle();
  };
  const changeThin = (patch: { thin?: number; thinScale?: number }, end: boolean) => {
    thinSteps.change('thin', patch);
    if (end) thinSteps.settle();
  };
  return (
    <div class={classes.tight}>
      <Choices
        label="Switch by"
        choices={SwitchChoices}
        active={mapState(shown, (s) => s.by)}
        onPick={(id) => void props.area.impostors({ by: id as 'size' | 'distance', particles: props.object } as never)}
      />
      <Show when={mapState(shown, (s) => s.by === 'size')}>
        {() => (
          <div class={classes.line}>
            <div class={classes.label}>Below</div>
            <Slider
              aria-label="Silhouettes below this size on screen"
              value={mapState(shown, (s) => s.pixels)}
              min={4}
              max={64}
              step={1}
              scale="log"
              unit="px"
              onPreview={(v) => change({ pixels: v }, false)}
              onCommit={(v) => change({ pixels: v }, true)}
            />
          </div>
        )}
      </Show>
      <Show when={mapState(shown, (s) => s.by === 'distance')}>
        {() => (
          <div class={classes.line}>
            <div class={classes.label}>Beyond</div>
            <Slider
              aria-label="Silhouettes beyond this distance"
              value={mapState(shown, (s) => s.distance)}
              min={100}
              max={mapState(shown, (s) => s.max)}
              step={1}
              scale="log"
              unit="Å"
              onPreview={(v) => change({ distance: v }, false)}
              onCommit={(v) => change({ distance: v }, true)}
            />
          </div>
        )}
      </Show>
      {/* the far silhouettes thinned out, and how much the kept ones grow (Ludo, 2026-11-15) */}
      <div class={classes.line}>
        <div class={classes.label}>Thin below</div>
        <Slider
          aria-label="Far silhouettes thinned out below this size on screen; off at 0"
          value={mapState(shown, (s) => s.thin)}
          min={0}
          max={16}
          step={0.5}
          unit="px"
          format={formatThin}
          parse={parseThin}
          onPreview={(v) => changeThin({ thin: v }, false)}
          onCommit={(v) => changeThin({ thin: v }, true)}
        />
      </div>
      <Show when={mapState(shown, (s) => s.thin > 0)}>
        {() => (
          <div class={classes.line}>
            <div class={classes.label}>Kept grow</div>
            <Slider
              aria-label="How much the silhouettes kept by the thinning are enlarged: 0 not, 1 the area covered kept"
              value={mapState(shown, (s) => s.thinScale)}
              min={0}
              max={1.5}
              step={0.05}
              onPreview={(v) => changeThin({ thinScale: v }, false)}
              onCommit={(v) => changeThin({ thinScale: v }, true)}
            />
          </div>
        )}
      </Show>
    </div>
  );
}

/** The particles' wiggle and tumble: one model's when it is given (a host's properties), else every list's */
export function Motion(props: { area: MesoscaleApi; particles?: string }) {
  const graphics = props.area.graphicsState(props.particles);
  return (
    <MotionRows area={props.area} graphics={graphics} of={props.particles ? { particles: props.particles } : {}} />
  );
}

/** The amplitude a motion switched on starts at */
const MotionOn = { wiggle: 1, tumble: 1 } as const;

/** Wiggle and tumble (the Mesoscale Explorer's procedural animation): each on or off, and its amplitude */
function MotionRows(props: {
  area: MesoscaleApi;
  graphics: ReadonlyState<GraphicsInfo | undefined>;
  of: { object?: string; particles?: string };
}) {
  const run = (key: 'wiggle' | 'tumble', v: number) => void props.area.motion({ [key]: v, ...props.of } as never);
  const row = (label: string, max: number, key: 'wiggle' | 'tumble') => {
    const value = mapState(props.graphics, (g) => g?.[key] ?? 0);
    return (
      <div class={classes.line}>
        <div class={classes.label}>
          <Button
            size="xs"
            variant="ghost"
            pressed={mapState(value, (v) => v > 0)}
            title={`${label}: on or off`}
            onClick={() => run(key, value.value > 0 ? 0 : MotionOn[key])}
          >
            {label}
          </Button>
        </div>
        <Slider
          aria-label={`${label} amplitude`}
          value={value}
          min={0}
          max={max}
          step={0.1}
          unit="Å"
          onCommit={(v) => run(key, v)}
        />
      </div>
    );
  };
  return (
    <div class={classes.tight}>
      {row('Wiggle', 5, 'wiggle')}
      {row('Tumble', 10, 'tumble')}
    </div>
  );
}

/** The edges `ZoomColors` shows: where each level's colors start, in pixels an atom covers */
const ZoomEdges = [
  ['Entity', 'entity'],
  ['Chain', 'chain'],
  ['Atom', 'atom'],
] as const;

/** A lipid membrane's (round 7 item 6): its chain is its species, so no chain edge (the operation keeps it between) */
const MembraneZoomEdges = [
  ['Species', 'entity'],
  ['Atoms', 'atom'],
] as const;

/**
 * A model's colors that follow the zoom (`mesoscale.colorLevels`; apps/prism-me/_spec/ui.md §4 Look): on or off, and
 * where the entity, chain and atom colors start, in pixels an atom covers (the unit, `color-levels.md`); a slider once
 * released (one step). A lipid membrane's (`membrane`): its species' and its atoms' edges
 */
export function ZoomColors(props: { area: MesoscaleApi; particles: string; membrane?: boolean }) {
  const levels = mapState(props.area.graphicsState(props.particles), (g) => g?.colorLevels);
  const run = (patch: object) => void props.area.colorLevels({ particles: props.particles, ...patch } as never);
  return (
    <div class={classes.tight}>
      <div class={classes.line}>
        <div class={classes.label}>
          <Button
            size="xs"
            variant="ghost"
            pressed={mapState(levels, (l) => !!l)}
            title={
              props.membrane
                ? 'Colors that follow the zoom (the membrane, its species, its atoms): on or off'
                : 'Colors that follow the zoom (compartment, entity, chain, atom): on or off'
            }
            onClick={() => run({ on: !levels.value })}
          >
            By zoom
          </Button>
        </div>
      </div>
      <Show when={mapState(levels, (l) => !!l)}>
        {() =>
          (props.membrane ? MembraneZoomEdges : ZoomEdges).map(([label, key]) => (
            <div class={classes.line}>
              <div class={classes.label}>{label}</div>
              <Slider
                aria-label={`${label} colors from, pixels an atom covers`}
                value={mapState(levels, (l) => l?.[key])}
                min={0.1}
                max={200}
                scale="log"
                unit="px"
                onCommit={(v) => run({ [key]: v })}
              />
            </div>
          ))
        }
      </Show>
    </div>
  );
}

/**
 * Import colors…: a JSON color file picked, its colors put on the entities it names (`mesoscale.importColors`, one
 * step). The result, with the names not found, is the run's message (the status line), as for every person's run; a
 * file that cannot be read is said there too (`fileUnreadable`).
 */
export function ImportColors(props: { area: MesoscaleApi; particles?: string }) {
  const input = (
    <input
      type="file"
      accept=".json,application/json"
      hidden
      onChange={(e) => {
        const picked = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!picked) return;
        picked.text().then(
          (json) => void props.area.importColors({ json, particles: props.particles ?? '' }),
          (err) => props.area.fileUnreadable(picked.name, err),
        );
      }}
    />
  ) as HTMLInputElement;
  return (
    <>
      {input}
      <Button
        size="sm"
        variant="ghost"
        icon={<Icon name="upload" />}
        title="Color the entities from a JSON file: the Mesoscale Explorer's, or entity names to colors"
        onClick={() => input.click()}
      >
        Import colors…
      </Button>
    </>
  );
}

/** A membrane's far look (lipid-procedural; Ludo compares them, 2026-11-08) */
const MembraneFarChoices: { id: MembraneFar; label: string }[] = [
  { id: 'both', label: 'Both' },
  { id: 'spheres', label: 'Spheres' },
  { id: 'texture', label: 'Texture' },
];

/** A cut membrane's middle distance (round 8; Ludo compares them live and picks the default; round 10: shells) */
const MiddleChoices: { id: MembraneMiddle; label: string }[] = [
  { id: 'coarse', label: 'Coarse' },
  { id: 'parallax', label: 'Parallax' },
  { id: 'shells', label: 'Shells' },
];

const DetailChoices: { id: MembraneDetail; label: string }[] = [
  { id: 'off', label: 'Atoms' },
  { id: 'quality', label: 'Quality' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'performance', label: 'Fast' },
  { id: 'custom', label: 'Custom' },
];

/**
 * A lipid membrane's levels of detail (Ludo, 2026-11-08: he tunes them to set the defaults; apps/prism-me/_spec/ui.md
 * §4): a preset, or custom levels, each where it starts (Å from the camera), its stride and its bias, a slider once
 * released (one step, never a new cut); the levels as text to copy
 */
export function MembraneDetailControls(props: { area: MesoscaleApi; membrane: string }) {
  const state = props.area.membraneDetailState(props.membrane);
  const levels = mapState(state, (s) => s?.levels ?? DefaultCustomLevels);
  const run = (patch: {
    detail?: MembraneDetail;
    levels?: readonly MembraneLevel[];
    far?: MembraneFar;
    atomsPx?: number;
    spheresPx?: number;
    budget?: number;
    middle?: MembraneMiddle;
    middlePx?: number;
  }) => void props.area.membraneDetail({ membrane: props.membrane, ...patch } as never);
  /** a switch of the far look (lipid-procedural): a slider committing once */
  const viewRow = (
    label: string,
    key: 'atomsPx' | 'spheresPx' | 'budget' | 'middlePx' | 'shells',
    min: number,
    max: number,
    unit?: string,
    scale: 'log' | 'linear' = 'log',
  ) => (
    <div class={classes.line}>
      <div class={classes.label}>{label}</div>
      <Slider
        aria-label={label}
        value={mapState(state, (s) => s?.[key] ?? 0)}
        min={min}
        max={max}
        scale={scale}
        {...(key === 'shells' ? { step: 1 } : {})}
        {...(unit ? { unit } : {})}
        onCommit={(v) => run({ [key]: key === 'shells' ? Math.round(v) : v })}
      />
    </div>
  );
  const cutter = mapState(state, (s) => s?.method === 'cutter');
  const tiles = mapState(state, (s) => !!s && s.method !== 'cutter');
  const far = mapState(state, (s) => s?.far ?? 'both');
  const middle = mapState(state, (s) => s?.middle ?? 'parallax');
  const setLevel = (j: number, key: keyof MembraneLevel, v: number) =>
    run({ levels: levels.value.map((l, k) => (k === j ? { ...l, [key]: key === 'stride' ? Math.round(v) : v } : l)) });
  const row = (j: number, label: string, key: keyof MembraneLevel, min: number, max: number, unit?: string) => (
    <div class={classes.line}>
      <div class={classes.label}>{label}</div>
      <Slider
        aria-label={`Level ${j + 1} ${key === 'distance' ? 'from' : key}`}
        value={mapState(levels, (l) => l[j]?.[key] ?? 0)}
        // a level starts between its neighbours' starts (the operation refuses others: review S5)
        min={key === 'distance' ? mapState(levels, (l) => (l[j - 1]?.distance ?? 0) + 1) : min}
        max={key === 'distance' ? mapState(levels, (l) => (l[j + 1]?.distance ?? max + 1) - 1) : max}
        scale={key === 'bias' ? undefined : 'log'}
        {...(unit ? { unit } : {})}
        onCommit={(v) => setLevel(j, key, v)}
      />
    </div>
  );
  return (
    <div class={classes.tight}>
      <Show when={cutter}>
        {() => (
          <div class={classes.tight}>
            <Choices
              label="Far"
              choices={MembraneFarChoices}
              active={far}
              onPick={(id) => run({ far: id as MembraneFar })}
            />
            <Show when={mapState(state, (s) => s?.far === 'texture' && s?.middle !== 'parallax')}>
              {() => viewRow('Lipids from', 'atomsPx', 0.25, 16, 'px')}
            </Show>
            <Show when={mapState(far, (f) => f !== 'spheres')}>
              {() => (
                <div class={classes.tight}>
                  <Choices
                    label="Middle"
                    choices={MiddleChoices}
                    active={middle}
                    onPick={(id) => run({ middle: id as MembraneMiddle })}
                  />
                  <Show when={mapState(middle, (m) => m !== 'coarse')}>
                    {() => viewRow('Atoms down to', 'middlePx', MiddlePxMin, 32, 'px')}
                  </Show>
                  {/* round 10: shells' layers, a build each (their instances) */}
                  <Show when={mapState(middle, (m) => m === 'shells')}>
                    {() => viewRow('Shells', 'shells', 4, 12, undefined, 'linear')}
                  </Show>
                  {/* the gate's M1, S5: a middle look takes the lipids at a cut by the far look's switch (the cut band) */}
                  <Show when={mapState(state, (s) => !!s && s.middle !== 'coarse' && s.far === 'texture')}>
                    {() => viewRow('Cut lipids down to', 'atomsPx', 0.25, 16, 'px')}
                  </Show>
                  <Show when={mapState(state, (s) => !!s && s.middle !== 'coarse' && s.far === 'both')}>
                    {() => viewRow('Cut lipids down to', 'spheresPx', 0.05, 8, 'px')}
                  </Show>
                </div>
              )}
            </Show>
            <Show
              when={mapState(state, (s) => s?.far !== 'texture' && (s?.far === 'spheres' || s?.middle === 'coarse'))}
            >
              {() => viewRow('Lipids down to', 'spheresPx', 0.05, 8, 'px')}
            </Show>
            {viewRow('Lipids at most', 'budget', 10_000, 8_000_000)}
          </div>
        )}
      </Show>
      {/* tiles: the far surfaces or not; built whole, no switch by size on screen (round 4b item 5) */}
      <Show when={tiles}>
        {() => (
          <Choices
            label="Far"
            choices={MembraneFarChoices.filter((c) => c.id !== 'texture')}
            active={far}
            onPick={(id) => run({ far: id as MembraneFar })}
          />
        )}
      </Show>
      <Choices
        label="Levels"
        choices={DetailChoices}
        active={mapState(state, (s) => s?.detail ?? '')}
        onPick={(id) => run({ detail: id as MembraneDetail })}
      />
      <Show when={mapState(state, (s) => s?.detail === 'custom')}>
        {() => (
          <div class={classes.tight}>
            <For each={mapState(levels, (l) => l.map((_, j) => j))}>
              {(j) => (
                <div class={classes.tight}>
                  {j > 0 ? row(j, `Level ${j + 1} from`, 'distance', 10, 100000, 'Å') : null}
                  {j > 0 ? row(j, 'Stride', 'stride', 1, 4096) : null}
                  {j > 0 ? row(j, 'Bias', 'bias', 1, 3) : null}
                </div>
              )}
            </For>
            <code class={classes.copy}>
              {mapState(levels, (l) => l.map((x) => `${Math.round(x.distance)} Å ×${x.stride} b${x.bias}`).join(' · '))}
            </code>
          </div>
        )}
      </Show>
    </div>
  );
}

const OrientChoices = [
  { id: 'auto', label: 'Auto' },
  { id: 'normal', label: 'Normal' },
  { id: 'axis', label: 'Axis' },
  { id: 'view', label: 'View' },
  { id: 'random', label: 'Random' },
];

const OrientTitles: Record<string, string> = {
  auto: 'On a surface (Place Surface) along its normal: +z, or the Fiber Axis when set; a membrane protein upright; else at random',
  normal: "Each copy's +z (or its Fiber Axis when set) along the surface's normal",
  axis: "Each copy's principal axis along the surface's normal",
  view: "Each copy's +z toward the viewer",
  random: 'Each copy turned at random',
};

/**
 * An entity's brush (apps/prism-me/_spec/ui.md §4, Paint): Paint with it (the canvas's paint mode: a stroke a step,
 * `mesoscale.paint`) or Stop, and how it paints: the spacing (0: the copies touch), how each copy is turned, the side
 * of the surface, its spin (random, or an angle). The settings are the mode's, not the state's (no step).
 */
export function PaintBrush(props: {
  area: MesoscaleApi;
  particles: string;
  entity: number;
  name: string;
  /** A structure of the scene as the brush (paint-layer round 2): painted into a list or the Painting list */
  structure?: string;
  /** A group of the list as the brush (paint-group; its id, `entity` too): its strokes copies, no Fiber */
  group?: number;
}) {
  const mode = props.area.paintMode;
  const on = mapState(mode.brush.asReadonly, (b) =>
    props.structure
      ? b?.structure === props.structure
      : !b?.structure && b?.particles === props.particles && b.entity === props.entity && b.group === props.group,
  );
  const fibers = props.group === undefined;
  const settings = mode.settings.asReadonly;
  const brush = () => ({
    particles: props.particles,
    entity: props.entity,
    name: props.name,
    ...(props.structure ? { structure: props.structure } : {}),
    ...(props.group !== undefined ? { group: props.group } : {}),
  });
  return (
    <div class={classes.tight}>
      <div class={classes.line}>
        <div class={classes.label}>
          <Button
            size="xs"
            variant="ghost"
            icon={<Icon name="paintbrush" />}
            pressed={on}
            title="Click or drag to paint copies (on a surface or at a depth); the rest is the camera; Alt+wheel: the depth; Esc stops"
            onClick={() => (on.value ? mode.stop() : void mode.start(brush()))}
          >
            {mapState(on, (o) => (o ? 'Stop' : 'Paint'))}
          </Button>
        </div>
        <Slider
          aria-label="Spacing between copies, 0: touching"
          value={mapState(settings, (s) => s.spacing)}
          min={0}
          max={500}
          step={1}
          unit="Å"
          onCommit={(v) => mode.set({ spacing: v })}
        />
      </div>
      <Choices
        label="Turn"
        choices={OrientChoices.map((c) => ({ ...c, title: OrientTitles[c.id] }))}
        active={mapState(settings, (s) => s.orient)}
        onPick={(id) => mode.set({ orient: id as PaintSettings['orient'] })}
      />
      {props.structure ? <PaintInto area={props.area} /> : null}
      {/* a group's strokes are copies (paint-group): its fibers are grown */}
      <Show when={fibers}>
        {() => (
          <Choices
            label="Fiber"
            choices={[
              {
                id: 'auto',
                label: 'Auto',
                title: props.structure
                  ? 'A new fiber when the structure has fibers where it paints, else copies'
                  : 'A new fiber when the entity has fibers, else copies',
              },
              { id: 'on', label: 'On', title: 'A stroke is a new fiber: its points a step apart, turned along it' },
              { id: 'off', label: 'Off', title: 'A stroke is copies' },
            ]}
            active={mapState(settings, (s) => s.fiber)}
            onPick={(id) => mode.set({ fiber: id as PaintSettings['fiber'] })}
          />
        )}
      </Show>
      <Show when={mapState(settings, (st) => fibers && !!props.structure && st.fiber !== 'off')}>
        {() => <StructureFiberSettings area={props.area} structure={props.structure!} />}
      </Show>
      <Show when={mapState(settings, (st) => fibers && !props.structure && st.fiber !== 'off')}>
        {() => (
          <div class={classes.tight}>
            <FiberSettings area={props.area} particles={props.particles} entity={props.entity} />
            <div class={classes.line}>
              <div class={classes.label} title="The next fibers' sequence, one-letter codes; empty: at random">
                Sequence
              </div>
              <TextInput
                size="sm"
                aria-label="Fiber sequence"
                placeholder="at random"
                value={mapState(settings, (st) => st.sequence ?? '')}
                onInput={(sequence) => mode.set({ sequence })}
              />
            </div>
            <div class={classes.line}>
              <div class={classes.label} title="The letters of the sequence used, 1-based (3-120); empty: all">
                Range
              </div>
              <TextInput
                size="sm"
                aria-label="Fiber sequence range"
                placeholder="all"
                value={mapState(settings, (st) => st.range ?? '')}
                onInput={(range) => mode.set({ range })}
              />
            </div>
          </div>
        )}
      </Show>
      <Choices
        label="Place"
        choices={[
          { id: 'auto', label: 'Auto', title: 'A membrane protein on the surface, anything else at the depth' },
          { id: 'surface', label: 'Surface', title: 'On the surface under the pointer' },
          {
            id: 'depth',
            label: 'Depth',
            title: "At a depth along the pointer's ray: what is under it; Alt+wheel moves it",
          },
        ]}
        active={mapState(settings, (s) => s.place)}
        onPick={(id) => mode.set({ place: id as PaintSettings['place'] })}
      />
      <Choices
        label="Side"
        choices={[
          { id: 'out', label: 'Out', title: 'Along the normal (a membrane: outside)' },
          { id: 'in', label: 'In', title: 'Against the normal (a membrane: inside)' },
        ]}
        active={mapState(settings, (s) => s.side)}
        onPick={(id) => mode.set({ side: id as PaintSettings['side'] })}
      />
      <PaintFit area={props.area} />
      <div class={classes.line}>
        <div class={classes.label}>
          <Button
            size="xs"
            variant="ghost"
            pressed={mapState(settings, (s) => s.spin === undefined)}
            title="Each copy spun at random about its axis, or all by the angle"
            onClick={() => mode.set({ spin: settings.value.spin === undefined ? 0 : undefined })}
          >
            Random spin
          </Button>
        </div>
        <Slider
          aria-label="Spin about the copy's axis"
          value={mapState(settings, (s) => s.spin)}
          min={0}
          max={360}
          step={1}
          unit="°"
          onCommit={(v) => mode.set({ spin: v })}
        />
      </div>
    </div>
  );
}

/**
 * A lipid membrane's species as a particle system's entities (Ludo, 2026-11-08): each shown or hidden (an eye) and its
 * colour (a swatch opening the shared picker); `mesoscale.membraneSpecies`, one step each
 */
export function MembraneSpeciesControls(props: { area: MesoscaleApi; membrane: string }) {
  const species = props.area.membraneSpeciesState(props.membrane);
  const names = mapState(species, (s) => (s ?? []).map((x) => x.name));
  const picking = observableState<string | undefined>(undefined);
  const run = (patch: { species: string; shown?: boolean; color?: number }) =>
    void props.area.membraneSpecies({ membrane: props.membrane, ...patch } as never);
  return (
    <div class={classes.tight}>
      <For each={names}>
        {(name) => {
          const one = mapState(species, (s) => s?.find((x) => x.name === name));
          return (
            <div class={classes.tight}>
              <div class={classes.line}>
                <Button
                  size="xs"
                  variant="ghost"
                  pressed={mapState(one, (x) => !!x?.shown)}
                  title={`${name}: shown or hidden`}
                  onClick={() => run({ species: name, shown: !one.value?.shown })}
                >
                  <Icon name="eye" />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  title={`${name}: its colour`}
                  onClick={() => picking.set(picking.value === name ? undefined : name)}
                >
                  <span
                    class={classes.swatch}
                    style={mapState(
                      one,
                      (x) => `background: ${Color.toHexStyle(Color(x?.color ?? x?.shownColor ?? 0xffffff))}`,
                    )}
                  />
                </Button>
                <div class={classes.label}>{name}</div>
              </div>
              <Show when={mapState(picking.asReadonly, (p) => p === name)}>
                {() => {
                  // previewed here, committed once by Apply (review M3: a drag was a step per move)
                  const color = observableState(one.value?.color ?? one.value?.shownColor ?? 0xffffff);
                  return (
                    <div class={classes.tight}>
                      <ColorPicker value={color.asReadonly} onChange={(c) => color.set(c)} />
                      <Button
                        size="xs"
                        onClick={() => {
                          run({ species: name, color: color.value });
                          picking.set(undefined);
                        }}
                      >
                        Apply
                      </Button>
                    </div>
                  );
                }}
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/**
 * A structure brush's fiber settings (Ludo, 2026-11-10: "from a pdb structure I want the Fiber option as well"): its
 * entity's in the list it paints into (`structureBrushState`), once its first stroke (copies or a fiber) made it; its
 * rise its length along its axis until set; no bank (`fiberState`'s `banks` false: its units are the structure
 * itself), so no sequence
 */
function StructureFiberSettings(props: { area: MesoscaleApi; structure: string }) {
  const into = mapState(props.area.paintMode.settings.asReadonly, (s) => ({ into: s.into ?? '' }));
  return (
    <Show when={into}>
      {({ into }) => (
        <Show
          when={props.area.structureBrushState(props.structure, into)}
          fallback={() => (
            <div class={classes.line}>
              <div class={classes.label} title="Its rise and twist are set once a stroke has painted it here">
                Rise, twist
              </div>
              <div class={classes.label}>after its first stroke here; a fiber's units touch</div>
            </div>
          )}
        >
          {(b) => <FiberSettings area={props.area} particles={b.particles} entity={b.entity} />}
        </Show>
      )}
    </Show>
  );
}

/**
 * Where a structure brush paints (paint-layer round 2, Ludo 2026-11-10: asked each time): a particle list of the scene,
 * or the Painting list (made by the first stroke); the settings' `into`, no step
 */
function PaintInto(props: { area: MesoscaleApi }) {
  const mode = props.area.paintMode;
  const lists = props.area.listsState();
  const choices = mapState(lists, (ls) => [
    { id: '', label: 'Painting', title: 'The Painting list (made by the first stroke)' },
    ...ls
      .filter((l) => !l.painting)
      .map((l) => ({ id: l.ref, label: l.label, title: `Into ${l.label}: a new entity of it` })),
  ]);
  return (
    <Show when={choices}>
      {(cs) => (
        <Choices
          label="Paint into"
          choices={cs}
          active={mapState(mode.settings.asReadonly, (s) => s.into ?? '')}
          onPick={(id) => mode.set({ into: id })}
        />
      )}
    </Show>
  );
}

/**
 * An entity's fiber settings (`mesoscale.fiber`; progress/2026-11-08-paint.md, Round 3): its painted fibers' rise (Å a
 * point along the path), twist (° a point) and jitter (± ° a point, random); a change makes every painted fiber of the
 * entity again, one step (a slider once released). A DNA: 3.4 Å, 34.3°, 0; an RNA: its rise, jitter 180. Round 4: the
 * unit's axis along the path (a pull-down) and its offset off the path, along a perpendicular of that axis.
 */
export function FiberSettings(props: { area: MesoscaleApi; particles: string; entity: number }) {
  const fiber = props.area.fiberState(props.particles, props.entity);
  const run = (patch: object) =>
    void props.area.fiber({ particles: props.particles, entity: String(props.entity), ...patch } as never);
  const line = (label: string, title: string, slider: Node) => (
    <div class={classes.line}>
      <div class={classes.label} title={title}>
        {label}
      </div>
      {slider}
    </div>
  );
  return (
    <div class={classes.tight}>
      {line(
        'Rise',
        "Between a fiber's points along its path",
        <Slider
          aria-label="Fiber rise, Å a point"
          value={mapState(fiber, (f) => f?.rise)}
          min={0.5}
          max={500}
          scale="log"
          unit="Å"
          onCommit={(v) => run({ rise: v })}
        />,
      )}
      {line(
        'Twist',
        'The turn about the fiber from one point to the next',
        <Slider
          aria-label="Fiber twist, ° a point"
          value={mapState(fiber, (f) => f?.twist)}
          min={-180}
          max={180}
          step={0.1}
          unit="°"
          onCommit={(v) => run({ twist: v })}
        />,
      )}
      {line(
        'Jitter',
        'A random turn within ± this a point (180: at random)',
        <Slider
          aria-label="Fiber twist jitter, ± ° a point"
          value={mapState(fiber, (f) => f?.jitter)}
          min={0}
          max={180}
          step={1}
          unit="°"
          onCommit={(v) => run({ jitter: v })}
        />,
      )}
      {line(
        'Axis',
        "The unit's own axis that follows the path (Auto: its fibers', else its longest)",
        <Select
          size="sm"
          over
          aria-label="Fiber axis along the path"
          options={FiberAxisOptions}
          value={mapState(fiber, (f) => f?.axis ?? 'auto')}
          onChange={(axis) => run({ axis })}
        />,
      )}
      <Show when={mapState(fiber, (f) => !!f?.banks)}>
        {() =>
          line(
            'Bank',
            'The units painted fibers switch between by their sequences: DNA a base pair a letter (A, T, G, C), RNA a nucleotide (A, U, G, C); none: the entity itself',
            <Select
              size="sm"
              over
              aria-label="Fiber bank of units"
              options={FiberBankOptions}
              value={mapState(fiber, (f) => f?.bank ?? 'none')}
              onChange={(bank) => run({ bank })}
            />,
          )
        }
      </Show>
      {line(
        'Offset',
        'Off the path, along a perpendicular of the axis that turns with the unit (with a twist: a helix)',
        <Slider
          aria-label="Fiber offset off the path, Å"
          value={mapState(fiber, (f) => f?.offset)}
          min={-50}
          max={50}
          step={0.1}
          unit="Å"
          onCommit={(v) => run({ offset: v })}
        />,
      )}
    </div>
  );
}

const FiberBankOptions: readonly SelectOption[] = [
  ['none', 'None'],
  ['dna', 'DNA'],
  ['rna', 'RNA'],
];

const HelixAxisOptions: readonly SelectOption[] = [
  ['auto', 'Auto'],
  ['view', 'View'],
  ['x', 'X'],
  ['y', 'Y'],
  ['z', 'Z'],
];

const FiberAxisOptions: readonly SelectOption[] = [
  ['auto', 'Auto'],
  ['x', 'X'],
  ['y', 'Y'],
  ['z', 'Z'],
];

const GrowModeChoices = [
  { id: 'walk', label: 'Random walk', title: 'A new fiber from the source: a persistent random walk, a rise a step' },
  {
    id: 'helix',
    label: 'Helix',
    title:
      "A new fiber from the source winding as a helix: on a mesh about its axis, on its surface; in space about the source's Fiber Axis",
  },
  {
    id: 'spiral',
    label: 'Spiral',
    title: 'A new fiber winding flat outward from the source, its center: on a mesh carried over its surface',
  },
  { id: 'crystal', label: 'Crystal', title: "A lattice in the source's frame, each copy turned as the source" },
  { id: 'tiling', label: 'Tiling', title: "A plane of copies in the source's own plane, ring by ring" },
  { id: 'sphere', label: 'Sphere', title: 'Copies at random in a ball about the source' },
  {
    id: 'symmetry',
    label: 'Symmetry',
    title: 'Copies by a point group (Cn, Dn, T, O, I) about a center a Radius from the source',
  },
];

const SymmetryGroupChoices = [
  { id: 'c', label: 'Cn', title: 'Cyclic: n copies about an axis (a ring)' },
  { id: 'd', label: 'Dn', title: 'Dihedral: 2n, Cn and n 2-folds across its axis (a barrel)' },
  { id: 't', label: 'T', title: 'Tetrahedral: 12' },
  { id: 'o', label: 'O', title: 'Octahedral: 24' },
  { id: 'i', label: 'I', title: 'Icosahedral: 60 (a shell)' },
];

/** On's value for the source's slice (slice-constraint): no state ref is one */
const SliceOn = '#slice';

/** A grow's record as the Grow section's settings (round 2: the section follows the live grow back) */
function settingsOfGrow(g: GrowRecord): Partial<GrowSettings> {
  const p = g.params;
  const keys: Record<GrowSettings['mode'], readonly [string, keyof GrowSettings][]> = {
    walk: [
      ['steps', 'steps'],
      ['persistence', 'persistence'],
    ],
    helix: [
      ['pitch', 'pitch'],
      ['turns', 'turns'],
      ['count', 'count'],
      ['hand', 'hand'],
      ['direction', 'direction'],
      ['sliceAxis', 'sliceAxis'],
      ['axis', 'axis'],
      ['radius', 'helixRadius'],
    ],
    spiral: [
      ['spacing', 'spacing'],
      ['count', 'count'],
      ['turns', 'turns'],
      ['hand', 'hand'],
    ],
    crystal: [
      ['a', 'a'],
      ['b', 'b'],
      ['c', 'c'],
      ['alpha', 'alpha'],
      ['beta', 'beta'],
      ['gamma', 'gamma'],
      ['na', 'na'],
      ['nb', 'nb'],
      ['nc', 'nc'],
    ],
    tiling: [
      ['pattern', 'pattern'],
      ['spacing', 'spacing'],
      ['count', 'tiles'],
    ],
    sphere: [
      ['count', 'count'],
      ['radius', 'radius'],
      ['turn', 'turn'],
    ],
    symmetry: [
      ['group', 'group'],
      ['n', 'n'],
      ['radius', 'symmetryRadius'],
      ['side', 'side'],
      ['axis', 'symmetryAxis'],
    ],
  };
  const out: Record<string, unknown> = { mode: g.mode };
  // On: the grow's mesh or slice (a crystal grows in space whatever On says)
  if (g.mode !== 'crystal') {
    out.mesh = g.mesh?.ref;
    // its slice as kept (review 9); grown in space with a slice set: On None (review 4)
    if (g.slice) Object.assign(out, { slice: g.slice, inSpace: false });
    else if (!g.mesh) out.inSpace = true;
  }
  for (const [from, to] of keys[g.mode]) if (p[from] !== undefined) out[to] = p[from];
  // Helix, Spiral: the driver of Count and Turns comes back with `by`, never the follower (a shared value: the
  // follower is the grow's to show, not the settings' to keep; review S1, M6)
  if (g.mode === 'helix' || g.mode === 'spiral') {
    const by = p.by === 'count' || p.by === 'turns' ? p.by : g.mode === 'spiral' ? 'count' : 'turns';
    out.by = by;
    delete out[by === 'turns' ? 'count' : 'turns'];
  }
  // a session's Tiling by Rings reads as its count (decisions 11)
  if (g.mode === 'tiling' && out.tiles === undefined && typeof p.rings === 'number') {
    out.tiles = tilingTotal(p.pattern === 'square' ? 'square' : 'hex', p.rings);
  }
  if (g.mode === 'symmetry') {
    out.snap = p.snap === 1;
    // its Radius unset: touching as it changes (review S1)
    if (p.touching === 1) out.symmetryRadius = undefined;
  }
  // fitted (density-fit): its volume, contrast and threshold; none: not fitted
  out.fit = p.fit;
  if (p.fit !== undefined) Object.assign(out, { contrast: p.contrast, threshold: p.threshold });
  return out as Partial<GrowSettings>;
}

/**
 * The Grow block (progress/2026-11-11-grow.md; Ludo, 2026-11-11): copies of a source particle of the list by a rule,
 * one step a Grow (`mesoscale.grow`). It names its source (set by a particle's right-click, Grow from this instance…,
 * or by a paint, its last copy), its mode, the mode's params (a length unset: the source's size), a seed (none: at
 * random) and Grow. The settings are the area's (`growSettings`), no step. On (grow-mesh): None or a file mesh of the
 * scene (the one the source was painted on by default); Tiling's Count is in space too; Crystal grows in
 * space. The last grow made here is live (round 2): any setting (each mode's, Seed, On and Mode: a Mode picked turns it
 * into one of that mode) makes it again in place (`mesoscale.grow { replace }`), one step a drag or a pick, and the
 * settings follow it back (an undo, a drag refused); a fiber's Rise, Twist and Jitter redraw it on its path
 * (`mesoscale.grown-fiber`). Another Grow, another source, Clear or the block gone ends it. Clear removes every grow
 * from the source (`mesoscale.clear-grown`).
 */
export function GrowBlock(props: { area: MesoscaleApi; api: ViewerApi; particles: string }) {
  const area = props.area;
  /** The last grow made here, live (round 2: every setting of it): its list and its grow's id */
  const live = observableState<{ particles: string; grow: number } | undefined>(undefined);
  const redraw = gestureSteps<Partial<Record<'rise' | 'twist' | 'jitter', number>>>(props.api, {
    label: 'Change the last grow',
    apply: (g, key, change) => {
      const at = live.value;
      if (!at) return Promise.resolve();
      // a fiber's rise, twist and jitter: its units made again on the same path
      // (fitted: its units are copies, the grow made again by the settings)
      if (key === 'fiber' && liveGrow.value?.params.fit === undefined) {
        return g.run('mesoscale.grown-fiber', { ...at, ...change });
      }
      // any other setting: the grow made again in place by the settings shown (its seed kept unless set)
      const src = source.value;
      const s = area.growSettings.value;
      if (!src) return Promise.resolve();
      return g.run('mesoscale.grow', {
        ...growParams(src, {
          ...s,
          mesh: onMesh(s, meshes.value),
          slice: onSlice(s, volumes.value),
          fit: onVolume(s, volumes.value),
        }),
        replace: at.grow,
      });
    },
    // what a drag has not applied yet is shown (its overlay), not the state's last (review 6); a drag ended (refused:
    // nothing applied) shows the grow as it is (round 2 review S1)
    changed: () => {
      overlaid.set(overlaid.value + 1);
      resync();
    },
  });
  const overlaid = observableState(0);
  onCleanup(() => redraw.settle());
  /** The live fiber's rise, twist and jitter as the state has them (an undo) */
  const grown = area.grownFiberState(live.asReadonly);
  /** The live grow while its stroke is there (undone: a change is the next grow's only) */
  const liveGrow = area.grownState(live.asReadonly);
  const source = mapState(area.growSourceState(), (s) => (s?.particles === props.particles ? s : undefined));
  /** The grows from the source, for Clear */
  const grownFrom = area.grownFromState(source);
  // another source: the last walk is not live anymore
  effect(
    mapState(source, (s) => s && `${s.particles}:${s.index}`),
    () => live.set(undefined),
  );
  const settings = area.growSettings.asReadonly;
  const meshes = area.growMeshesState();
  const volumes = area.fitVolumesState();
  /** The volume chosen to fit to while it is in the scene (density-fit review M2) */
  const onVolume = (s: GrowSettings, list: readonly { ref: string }[]) =>
    s.fit && list.some((v) => v.ref === s.fit) ? s.fit : undefined;
  /** The mesh chosen while it is in the scene */
  const onMesh = (s: GrowSettings, list: readonly { ref: string }[]) =>
    s.mesh && list.some((m) => m.ref === s.mesh) ? s.mesh : undefined;
  /** The source's slice while its volume is in the scene (slice-constraint) */
  const onSlice = (s: GrowSettings, list: readonly { ref: string }[]) =>
    s.slice && !s.inSpace && list.some((v) => v.ref === s.slice!.volume) ? s.slice : undefined;
  /** On the source's slice, no mesh picked: a helix's Axis (Ludo, 2026-11-14) */
  const onSurfaceSlice = derive([settings, meshes, volumes], (s, ml, vl) => !onMesh(s, ml) && !!onSlice(s, vl));
  /** On a surface, a mesh or a slice: Symmetry's Snap */
  const onSurface = derive(
    [settings, meshes, volumes],
    (s, ml, vl) => !!onMesh(s, ml) || (s.mode !== 'crystal' && !!onSlice(s, vl)),
  );
  // following both: a mesh deleted after it was chosen is none (review S3)
  const chosen = derive([settings, meshes], (s, list) => onMesh(s, list));
  /** The settings changed, nothing grown */
  const store = (patch: Partial<GrowSettings>) => area.growSettings.set({ ...area.growSettings.value, ...patch });
  /**
   * The settings changed, and the last grow made again by them while it is there (round 2, Ludo 2026-11-13: "all the
   * parameters … update the latest grow"; its Mode too: it becomes a grow of that mode); `end`, the change done (a
   * slider let go, a pick): its step taken at once
   */
  const set = (patch: Partial<GrowSettings>, end = true) => {
    const s = area.growSettings.value;
    // the same again (a release after its last preview): nothing to grow, but the step ends (review M2)
    if ((Object.keys(patch) as (keyof GrowSettings)[]).every((k) => s[k] === patch[k])) {
      if (end) redraw.settle();
      return;
    }
    // live read first: reading it may tell its watchers, and the settings must not follow it back before the change
    const growing = !!live.value && !!liveGrow.value;
    store(patch);
    if (!growing) return;
    redraw.change('grow', {});
    if (end) redraw.settle();
  };
  /**
   * The live grow's settings back in the section when no change of it is pending (round 2 review S1): an undo, a drag
   * refused, a Mode undone show the grow as it is, and the next change starts from it
   */
  const resync = () => {
    const g = liveGrow.value;
    if (!live.value || !g || redraw.overlay('grow')) return;
    const patch = settingsOfGrow(g);
    const s = area.growSettings.value;
    const changed = (Object.keys(patch) as (keyof GrowSettings)[]).filter((k) => s[k] !== patch[k]);
    if (changed.length) store(Object.fromEntries(changed.map((k) => [k, patch[k]])));
  };
  effect(liveGrow, resync);
  // the state's values kept in the settings set (an undo): the next Grow uses what is shown (review 7)
  effect(grown, (f) => {
    // a change of the grow pending (a spiral's Step drag): not the state's older rise back (second review, note)
    if (!f || redraw.overlay('fiber') || redraw.overlay('grow')) return;
    const s = area.growSettings.value;
    const patch: { rise?: number; twist?: number; jitter?: number } = {};
    for (const k of ['rise', 'twist', 'jitter'] as const) if (s[k] !== undefined && s[k] !== f[k]) patch[k] = f[k];
    if (Object.keys(patch).length) store(patch);
  });
  const line = (label: string, title: string, control: Node) => (
    <div class={classes.line}>
      <div class={classes.label} title={title}>
        {label}
      </div>
      {control}
    </div>
  );
  const number = (
    key: keyof GrowSettings,
    label: string,
    title: string,
    range: { min: number; max: number; step?: number; unit?: string; scale?: 'log' },
    fallback?: () => number,
  ) =>
    line(
      label,
      title,
      <Slider
        aria-label={`Grow ${label}`}
        value={mapState(settings, (s) => (s[key] as number | undefined) ?? fallback?.())}
        min={range.min}
        max={range.max}
        step={range.step}
        scale={range.scale}
        unit={range.unit}
        onPreview={(v) => set({ [key]: v }, false)}
        onCommit={(v) => set({ [key]: v })}
      />,
    );
  /**
   * Count and Turns of a Helix or a Spiral, linked (decisions 8 and 21): setting one makes the grow by it; the other is
   * shown as the live grow made it, else (in space) as flat geometry says
   */
  const linked = (
    key: 'turns' | 'count',
    label: string,
    title: string,
    range: { min: number; max: number; step?: number },
  ) => {
    const by = (s: GrowSettings) => s.by ?? (s.mode === 'spiral' ? 'count' : 'turns');
    const shown = derive([settings, liveGrow, chosen] as const, (s, g, m): number | undefined => {
      if (by(s) === key) return s[key];
      if (g && g.mode === s.mode) {
        const v = key === 'count' ? (g.params.copies ?? g.params.count) : g.params.turns;
        if (typeof v === 'number') return v;
      }
      const src = source.value;
      const other = src && linkedValue(s, by(s), src.rise, Math.round(2 * src.radius * 10) / 10, !!m);
      return other ? (other as Record<string, number>)[key] : s[key];
    });
    const change = (v: number, end: boolean) => set({ [key]: v, by: key }, end);
    return line(
      label,
      title,
      <Slider
        aria-label={`Grow ${label}`}
        value={shown}
        min={range.min}
        max={range.max}
        step={range.step}
        onPreview={(v) => change(v, false)}
        onCommit={(v) => change(v, true)}
      />,
    );
  };
  const mode = (m: GrowSettings['mode']) => mapState(settings, (s) => s.mode === m);
  /** A walk's fiber setting: the live fiber's own (it follows an undo), else the settings', else the entity's */
  const fiberSlider = (
    key: 'rise' | 'twist' | 'jitter',
    label: string,
    title: string,
    range: { min: number; max: number; step?: number; unit: string; scale?: 'log' },
    entity: () => number,
  ) => {
    const shown = derive(
      [settings, grown, overlaid.asReadonly] as const,
      (s, fiber): number => redraw.overlay('fiber')?.[key] ?? fiber?.[key] ?? s[key] ?? entity(),
    );
    const change = (v: number, end: boolean) => {
      store({ [key]: v });
      // the live fiber while it is there (undone: the next grow's only; review 5); a fitted one's grow made again
      if (live.value && (grown.value || liveGrow.value?.params.fit !== undefined)) redraw.change('fiber', { [key]: v });
      if (end) redraw.settle();
    };
    return line(
      label,
      title,
      <Slider
        aria-label={`Grow ${label}`}
        value={shown}
        {...range}
        onPreview={(v) => change(v, false)}
        onCommit={(v) => change(v, true)}
      />,
    );
  };
  return (
    <Show
      when={source}
      fallback={() => (
        <div class={classes.line}>
          <div class={classes.label}>Right-click a particle: Grow from this instance…, or paint a copy</div>
        </div>
      )}
    >
      {(src) => {
        const diameter = () => Math.round(2 * src.radius * 10) / 10;
        return (
          <div class={classes.tight}>
            {line(
              'From',
              'The source: its copies go by the rule from its pose',
              <div class={classes.label}>{src.name}</div>,
            )}
            <Choices
              label="Mode"
              choices={GrowModeChoices}
              active={mapState(settings, (s) => s.mode)}
              onPick={(id) =>
                // Count shared with Sphere (1 at least): a spiral's is 2 at least (second review 4)
                set({
                  mode: id as GrowSettings['mode'],
                  ...(id === 'spiral' && settings.value.count < 2 ? { count: 2 } : {}),
                })
              }
            />
            <Show
              when={mapState(settings, (s) => s.mode !== 'crystal')}
              fallback={() =>
                line('On', 'A crystal is a 3D lattice', <div class={classes.label}>A crystal grows in space</div>)
              }
            >
              {() => (
                <Show
                  when={derive(
                    [meshes, volumes, settings],
                    (list, vl, s) => ({
                      list,
                      // the source's slice (slice-constraint): an On of its own
                      // listed while its volume is there, picked or not (review 4)
                      slice: s.slice && vl.find((v) => v.ref === s.slice!.volume)?.label,
                    }),
                    // rebuilt when the meshes or the slice's name change, not a setting (a drag)
                    (a, b) => a.list === b.list && a.slice === b.slice,
                  )}
                >
                  {({ list, slice }) =>
                    line(
                      'On',
                      "A mesh of the scene or the source's slice the copies grow on, each turned to its normal; None: in space",
                      <Select
                        size="sm"
                        over
                        aria-label="Grow on a mesh"
                        options={[
                          ['', 'None'],
                          ...(slice ? [[SliceOn, `Slice of ${slice}`] as SelectOption] : []),
                          ...list.map((m): SelectOption => [m.ref, m.label]),
                        ]}
                        value={mapState(
                          settings,
                          (s) => onMesh(s, list) ?? (slice && s.slice && !s.inSpace ? SliceOn : ''),
                        )}
                        onChange={(ref) =>
                          set(
                            ref === SliceOn
                              ? { mesh: undefined, inSpace: false }
                              : ref
                                ? { mesh: ref }
                                : { mesh: undefined, inSpace: true },
                          )
                        }
                      />,
                    )
                  }
                </Show>
              )}
            </Show>
            <GrowFit area={area} set={set} />
            <Show when={mode('walk')}>
              {() => (
                <div class={classes.tight}>
                  {number('steps', 'Steps', "The fiber's points, a rise apart", { min: 2, max: 500, step: 1 })}
                  {number('persistence', 'Persistence', 'The most the fiber turns a step', {
                    min: 0,
                    max: 180,
                    step: 1,
                    unit: '°',
                  })}
                </div>
              )}
            </Show>
            <Show when={mode('helix')}>
              {() => (
                <div class={classes.tight}>
                  {number(
                    'pitch',
                    'Pitch',
                    "Along its axis a turn, Å (unset: 4 × the copy's diameter)",
                    { min: 1, max: 5000, scale: 'log', unit: 'Å' },
                    () => 4 * diameter(),
                  )}
                  {linked('turns', 'Turns', 'Its turns (on a mesh, fewer where the surface ends); sets Count', {
                    min: 0.5,
                    max: 50,
                    step: 0.5,
                  })}
                  {linked('count', 'Count', 'Its copies, a rise apart along it from the source; sets Turns', {
                    min: 2,
                    max: 5000,
                    step: 1,
                  })}
                  <Choices
                    label="Hand"
                    choices={[
                      { id: 'right', label: 'Right', title: 'Right-handed' },
                      { id: 'left', label: 'Left', title: 'Left-handed' },
                    ]}
                    active={mapState(settings, (s) => s.hand)}
                    onPick={(id) => set({ hand: id as GrowSettings['hand'] })}
                  />
                  <Show when={mapState(onSurfaceSlice, (x) => x)}>
                    {() => (
                      <Choices
                        label="Axis"
                        choices={[
                          {
                            id: 'along',
                            label: 'Along plane',
                            title: "Its axis a line of the slice's plane through the source (the copy's side)",
                          },
                          { id: 'normal', label: 'Normal', title: "Its axis the slice's normal through the source" },
                        ]}
                        active={mapState(settings, (s) => s.sliceAxis)}
                        onPick={(id) => set({ sliceAxis: id as GrowSettings['sliceAxis'] })}
                      />
                    )}
                  </Show>
                  <Choices
                    label="Direction"
                    choices={[
                      { id: 'up', label: 'Up', title: 'Up its axis from the source' },
                      { id: 'down', label: 'Down', title: 'Down its axis from the source' },
                    ]}
                    active={mapState(settings, (s) => s.direction)}
                    onPick={(id) => set({ direction: id as GrowSettings['direction'] })}
                  />
                  <Show
                    when={mapState(chosen, (m) => !!m)}
                    fallback={() =>
                      number(
                        'helixRadius',
                        'Radius',
                        "About the source's Fiber Axis, Å, the source on it; on a slice, about its Axis through the source (unset: the copy's diameter)",
                        { min: 1, max: 5000, scale: 'log', unit: 'Å' },
                        diameter,
                      )
                    }
                  >
                    {() =>
                      line(
                        'Axis',
                        "The axis it winds about, through the mesh's center: Auto, its longest; View, toward the viewer",
                        <Select
                          size="sm"
                          over
                          aria-label="Grow Axis"
                          options={HelixAxisOptions}
                          value={mapState(settings, (s) => s.axis)}
                          onChange={(axis) => set({ axis: axis as GrowSettings['axis'] })}
                        />,
                      )
                    }
                  </Show>
                </div>
              )}
            </Show>
            <Show when={mode('spiral')}>
              {() => (
                <div class={classes.tight}>
                  {linked('count', 'Count', 'Its copies, a Step apart along it from the source (copy 0); sets Turns', {
                    min: 2,
                    max: 2000,
                    step: 1,
                  })}
                  {number(
                    'spacing',
                    'Arm spacing',
                    "Between its arms, Å: its radius this more a turn (unset: the copy's diameter, so they touch)",
                    { min: 1, max: 1000, scale: 'log', unit: 'Å' },
                    diameter,
                  )}
                  {number(
                    'rise',
                    'Step',
                    "Between its copies along it, Å: the fiber's rise (unset: the entity's)",
                    { min: 0.5, max: 500, scale: 'log', unit: 'Å' },
                    () => src.rise,
                  )}
                  <Choices
                    label="Hand"
                    choices={[
                      { id: 'right', label: 'Right', title: 'Counterclockwise about its normal' },
                      { id: 'left', label: 'Left', title: 'Clockwise about its normal' },
                    ]}
                    active={mapState(settings, (s) => s.hand)}
                    onPick={(id) => set({ hand: id as GrowSettings['hand'] })}
                  />
                  {linked(
                    'turns',
                    'Turns',
                    'Its turns (on a mesh, fewer where it ends, or where it skips so many that it reaches 4 × Count Steps); sets Count',
                    { min: 0.5, max: 50, step: 0.5 },
                  )}
                </div>
              )}
            </Show>
            <Show when={mapState(settings, (s) => s.mode === 'walk' || s.mode === 'helix' || s.mode === 'spiral')}>
              {() => (
                <div class={classes.tight}>
                  {/* a spiral's rise is its Step (above): its Count copies made again Step apart */}
                  <Show when={mapState(settings, (s) => s.mode !== 'spiral')}>
                    {() =>
                      fiberSlider(
                        'rise',
                        'Rise',
                        "Between the fiber's units along its path (unset: the entity's)",
                        { min: 0.5, max: 500, scale: 'log', unit: 'Å' },
                        () => src.rise,
                      )
                    }
                  </Show>
                  {fiberSlider(
                    'twist',
                    'Twist',
                    "The turn from one unit to the next (unset: the entity's)",
                    { min: -180, max: 180, step: 0.1, unit: '°' },
                    () => src.twist,
                  )}
                  {fiberSlider(
                    'jitter',
                    'Jitter',
                    "A random turn within ± this a unit (unset: the entity's)",
                    { min: 0, max: 180, step: 1, unit: '°' },
                    () => src.jitter,
                  )}
                </div>
              )}
            </Show>
            <Show when={mode('crystal')}>
              {() => (
                <div class={classes.tight}>
                  {(['a', 'b', 'c'] as const).map((k) =>
                    number(
                      k,
                      k,
                      `The cell's ${k}, Å (unset: the copy's diameter)`,
                      { min: 1, max: 1000, scale: 'log', unit: 'Å' },
                      diameter,
                    ),
                  )}
                  {(
                    [
                      ['alpha', 'α', 'b and c'],
                      ['beta', 'β', 'a and c'],
                      ['gamma', 'γ', 'a and b'],
                    ] as const
                  ).map(([k, label, between]) =>
                    number(k, label, `The angle between ${between}`, { min: 1, max: 179, step: 0.1, unit: '°' }),
                  )}
                  {(['na', 'nb', 'nc'] as const).map((k) =>
                    number(k, k, `Cells along ${k.slice(1)}, the source's counted`, { min: 1, max: 20, step: 1 }),
                  )}
                </div>
              )}
            </Show>
            <Show when={mode('tiling')}>
              {() => (
                <div class={classes.tight}>
                  <Choices
                    label="Pattern"
                    choices={[
                      { id: 'hex', label: 'Hex', title: 'Hexagonal: six neighbours a copy' },
                      { id: 'square', label: 'Square', title: 'Square: four neighbours a copy' },
                    ]}
                    active={mapState(settings, (s) => s.pattern)}
                    onPick={(id) => set({ pattern: id as GrowSettings['pattern'] })}
                  />
                  {number(
                    'spacing',
                    'Spacing',
                    "Between copies, Å (unset: the copy's diameter)",
                    { min: 1, max: 1000, scale: 'log', unit: 'Å' },
                    diameter,
                  )}
                  {number(
                    'tiles',
                    'Count',
                    "Its points, the source's counted (unset: 3 rings')",
                    { min: 2, max: 5000, step: 1 },
                    () => tilingTotal(settings.value.pattern, 3),
                  )}
                </div>
              )}
            </Show>
            <Show when={mode('sphere')}>
              {() => (
                <div class={classes.tight}>
                  {number('count', 'Count', 'The copies', { min: 1, max: 2000, step: 1 })}
                  {number(
                    'radius',
                    'Radius',
                    "The ball's, Å (unset: 5 × the copy's radius)",
                    { min: 1, max: 5000, scale: 'log', unit: 'Å' },
                    () => Math.round(5 * src.radius * 10) / 10,
                  )}
                  <Choices
                    label="Turn"
                    choices={[
                      { id: 'random', label: 'Random', title: 'Each copy turned at random' },
                      { id: 'source', label: 'As the source', title: 'Each copy turned as the source' },
                    ]}
                    active={mapState(settings, (s) => s.turn)}
                    onPick={(id) => set({ turn: id as GrowSettings['turn'] })}
                  />
                </div>
              )}
            </Show>
            <Show when={mode('symmetry')}>
              {() => (
                <div class={classes.tight}>
                  <Choices
                    label="Group"
                    choices={SymmetryGroupChoices}
                    active={mapState(settings, (s) => s.group)}
                    onPick={(id) => set({ group: id as GrowSettings['group'] })}
                  />
                  <Show when={mapState(settings, (s) => s.group === 'c' || s.group === 'd')}>
                    {() => number('n', 'n', 'Cn: n copies; Dn: 2n (the source counted)', { min: 2, max: 60, step: 1 })}
                  </Show>
                  {line(
                    'Radius',
                    "The center's distance from the source along its axis, Å (unset: the copies touching)",
                    <Slider
                      aria-label="Grow Radius"
                      value={derive([settings, liveGrow] as const, (s, g) => {
                        if (s.symmetryRadius !== undefined) return s.symmetryRadius;
                        // unset: the live grow's (touching where the source is), else the general position's
                        if (g?.mode === 'symmetry' && typeof g.params.radius === 'number') {
                          return Math.round(g.params.radius * 10) / 10;
                        }
                        return Math.round((diameter() / symmetryContact(s.group, s.n)) * 10) / 10;
                      })}
                      min={1}
                      max={5000}
                      scale="log"
                      unit="Å"
                      onPreview={(v) => set({ symmetryRadius: v }, false)}
                      onCommit={(v) => set({ symmetryRadius: v })}
                    />,
                  )}
                  <Choices
                    label="Side"
                    choices={[
                      { id: 'inside', label: 'Inside', title: 'The center against its axis (a subunit pointing out)' },
                      { id: 'outside', label: 'Outside', title: 'The center along its axis' },
                    ]}
                    active={mapState(settings, (s) => s.side)}
                    onPick={(id) => set({ side: id as GrowSettings['side'] })}
                  />
                  {line(
                    'Axis',
                    "The group's principal axis through the center: Auto, across the source's (it sits on the shell); View, toward the viewer",
                    <Select
                      size="sm"
                      over
                      aria-label="Grow Symmetry Axis"
                      options={HelixAxisOptions}
                      value={mapState(settings, (s) => s.symmetryAxis)}
                      onChange={(axis) => set({ symmetryAxis: axis as GrowSettings['symmetryAxis'] })}
                    />,
                  )}
                  <Show when={onSurface}>
                    {() => (
                      <Choices
                        label="Snap"
                        choices={[
                          { id: 'off', label: 'Exact', title: 'The copies where the group puts them' },
                          { id: 'on', label: 'Snap', title: 'Each copy projected onto the mesh, turned to its normal' },
                        ]}
                        active={mapState(settings, (s) => (s.snap ? 'on' : 'off'))}
                        onPick={(id) => set({ snap: id === 'on' })}
                      />
                    )}
                  </Show>
                </div>
              )}
            </Show>
            {line(
              'Seed',
              'The random draws (the same seed, the same copies); empty: at random each Grow',
              <TextInput
                size="sm"
                aria-label="Grow seed"
                placeholder="at random"
                value={mapState(settings, (s) => (s.seed === undefined ? '' : String(s.seed)))}
                onInput={(t) => {
                  const n = Number.parseInt(t, 10);
                  set({ seed: Number.isFinite(n) ? n : undefined }, false);
                }}
              />,
            )}
            <div class={classes.line}>
              <Button
                size="xs"
                variant="ghost"
                icon={<Icon name="sparkles" />}
                title="Grow the copies by the rule: one step"
                onClick={() => {
                  // another Grow: the one before it is not live anymore; this one is
                  redraw.settle();
                  live.set(undefined);
                  const s = settings.value;
                  void area
                    .grow(
                      growParams(src, {
                        ...s,
                        mesh: onMesh(s, meshes.value),
                        slice: onSlice(s, volumes.value),
                        fit: onVolume(s, volumes.value),
                      }) as never,
                    )
                    .then((r) => {
                      const id = r.ok ? (r.value as { id?: number } | undefined)?.id : undefined;
                      if (id !== undefined) live.set({ particles: src.particles, grow: id });
                    });
                }}
              >
                Grow
              </Button>
              <Button
                size="xs"
                variant="ghost"
                icon={<Icon name="trash-2" />}
                title="Clear every grow from this instance (it stays): one step"
                disabled={mapState(grownFrom, (n) => !n)}
                onClick={() => {
                  redraw.settle();
                  live.set(undefined);
                  void area.clearGrown({ particles: src.particles, index: src.index });
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
