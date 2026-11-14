/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Choices, Icon, Select, type SelectOption, Show, Slider, TextInput } from '@molstar/prism-ui';
import { effect, onCleanup } from '@molstar/prism-ui/dom/scope';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ViewerApi } from '@molstar/prism-viewer/api/area';
import { gestureSteps } from '@molstar/prism-viewer/sources/gesture-steps';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { classes } from './_generated/controls.module.css.js';
import { tilingTotal } from './grow.js';
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

/**
 * One object's graphics (apps/prism-me/_spec/ui.md §4, Graphics & Motion): its quality, and its wiggle and tumble when
 * it moves (`motion`: a structure, a particle list; not a volume). Each acts on that object alone.
 */
export function ObjectGraphics(props: { area: MesoscaleApi; object: string; motion: boolean }) {
  const graphics = props.area.graphicsState(props.object);
  return (
    <div class={classes.stack}>
      <Choices
        label="Quality"
        choices={ModeChoices}
        active={mapState(graphics, (g) => g?.mode ?? '')}
        onPick={(id) => void props.area.graphics({ mode: id as GraphicsMode, object: props.object } as never)}
      />
      {props.motion ? <MotionRows area={props.area} graphics={graphics} of={{ object: props.object }} /> : null}
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

/**
 * A model's colors that follow the zoom (`mesoscale.colorLevels`; apps/prism-me/_spec/ui.md §4 Look): on or off, and
 * where the entity, chain and atom colors start, in pixels an atom covers (the unit, `color-levels.md`); a slider once
 * released (one step)
 */
export function ZoomColors(props: { area: MesoscaleApi; particles: string }) {
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
            title="Colors that follow the zoom (compartment, entity, chain, atom): on or off"
            onClick={() => run({ on: !levels.value })}
          >
            By zoom
          </Button>
        </div>
      </div>
      <Show when={mapState(levels, (l) => !!l)}>
        {() =>
          ZoomEdges.map(([label, key]) => (
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

const OrientChoices = [
  { id: 'auto', label: 'Auto' },
  { id: 'normal', label: 'Normal' },
  { id: 'axis', label: 'Axis' },
  { id: 'view', label: 'View' },
  { id: 'random', label: 'Random' },
];

const OrientTitles: Record<string, string> = {
  auto: 'Upright on a membrane (its +z along the surface), anything else at random',
  normal: "Each copy's +z along the surface's normal",
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
}) {
  const mode = props.area.paintMode;
  const on = mapState(mode.brush.asReadonly, (b) =>
    props.structure
      ? b?.structure === props.structure
      : !b?.structure && b?.particles === props.particles && b.entity === props.entity,
  );
  const settings = mode.settings.asReadonly;
  const brush = () => ({
    particles: props.particles,
    entity: props.entity,
    name: props.name,
    ...(props.structure ? { structure: props.structure } : {}),
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
            title="Click or drag to paint copies (on a surface or at a depth); Alt moves the camera; Esc stops"
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
      <Show when={mapState(settings, (st) => !!props.structure && st.fiber !== 'off')}>
        {() => <StructureFiberSettings area={props.area} structure={props.structure!} />}
      </Show>
      <Show when={mapState(settings, (st) => !props.structure && st.fiber !== 'off')}>
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
          { id: 'depth', label: 'Depth', title: "At a depth along the pointer's ray; the wheel moves it" },
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

const FiberAxisOptions: readonly SelectOption[] = [
  ['auto', 'Auto'],
  ['x', 'X'],
  ['y', 'Y'],
  ['z', 'Z'],
];

const GrowModeChoices = [
  { id: 'walk', label: 'Random walk', title: 'A new fiber from the source: a persistent random walk, a rise a step' },
  { id: 'crystal', label: 'Crystal', title: "A lattice in the source's frame, each copy turned as the source" },
  { id: 'tiling', label: 'Tiling', title: "A plane of copies in the source's own plane, ring by ring" },
  { id: 'sphere', label: 'Sphere', title: 'Copies at random in a ball about the source' },
];

/**
 * The Grow block (progress/2026-11-11-grow.md; Ludo, 2026-11-11): copies of a source particle of the list by a rule,
 * one step a Grow (`mesoscale.grow`). It names its source (set by a particle's right-click, Grow from this instance…,
 * or by a paint, its last copy), its mode, the mode's params (a length unset: the source's size), a seed (none: at
 * random) and Grow. The settings are the area's (`growSettings`), no step. On (grow-mesh): None or a file mesh of the
 * scene (the one the source was painted on by default); on a mesh, Tiling's Rings becomes its Count; Crystal grows in
 * space. A walk's Rise, Twist and Jitter (paint-refine; unset: the entity's) are live on the last walk grown here: a
 * drag redraws it in place (`mesoscale.grown-fiber`), one step a drag; another Grow, another source or the block gone
 * ends it.
 */
export function GrowBlock(props: { area: MesoscaleApi; api: ViewerApi; particles: string }) {
  const area = props.area;
  /** The last walk grown here, live: its list and its grow's id */
  const live = observableState<{ particles: string; grow: number } | undefined>(undefined);
  const redraw = gestureSteps<Partial<Record<'rise' | 'twist' | 'jitter', number>>>(props.api, {
    label: "Set the grown fiber's rise and twist",
    apply: (g, _, change) => {
      const at = live.value;
      return at ? g.run('mesoscale.grown-fiber', { ...at, ...change }) : Promise.resolve();
    },
    // what a drag has not applied yet is shown (its overlay), not the state's last (review 6)
    changed: () => overlaid.set(overlaid.value + 1),
  });
  const overlaid = observableState(0);
  onCleanup(() => redraw.settle());
  /** The live fiber's rise, twist and jitter as the state has them (an undo) */
  const grown = area.grownFiberState(live.asReadonly);
  const source = mapState(area.growSourceState(), (s) => (s?.particles === props.particles ? s : undefined));
  // another source: the last walk is not live anymore
  effect(
    mapState(source, (s) => s && `${s.particles}:${s.index}`),
    () => live.set(undefined),
  );
  const settings = area.growSettings.asReadonly;
  const meshes = area.growMeshesState();
  /** The mesh chosen while it is in the scene */
  const onMesh = (s: GrowSettings, list: readonly { ref: string }[]) =>
    s.mesh && list.some((m) => m.ref === s.mesh) ? s.mesh : undefined;
  // following both: a mesh deleted after it was chosen is none (review S3)
  const chosen = derive([settings, meshes], (s, list) => onMesh(s, list));
  const set = (patch: Partial<GrowSettings>) => area.growSettings.set({ ...area.growSettings.value, ...patch });
  // the state's values kept in the settings set (an undo): the next Grow uses what is shown (review 7)
  effect(grown, (f) => {
    if (!f || redraw.overlay('fiber')) return;
    const s = area.growSettings.value;
    const patch: { rise?: number; twist?: number; jitter?: number } = {};
    for (const k of ['rise', 'twist', 'jitter'] as const) if (s[k] !== undefined && s[k] !== f[k]) patch[k] = f[k];
    if (Object.keys(patch).length) set(patch);
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
        onCommit={(v) => set({ [key]: v })}
      />,
    );
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
      set({ [key]: v });
      // the live fiber while it is there (undone: the next grow's only; review 5)
      if (live.value && grown.value) redraw.change('fiber', { [key]: v });
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
              onPick={(id) => set({ mode: id as GrowSettings['mode'] })}
            />
            <Show
              when={mapState(settings, (s) => s.mode !== 'crystal')}
              fallback={() =>
                line('On', 'A crystal is a 3D lattice', <div class={classes.label}>A crystal grows in space</div>)
              }
            >
              {() => (
                <Show when={mapState(meshes, (list) => ({ list }))}>
                  {({ list }) =>
                    line(
                      'On',
                      'A mesh of the scene the copies grow on, each turned to its normal; None: in space',
                      <Select
                        size="sm"
                        over
                        aria-label="Grow on a mesh"
                        options={[['', 'None'], ...list.map((m): SelectOption => [m.ref, m.label])]}
                        value={mapState(settings, (s) => onMesh(s, list) ?? '')}
                        onChange={(ref) => set({ mesh: ref || undefined })}
                      />,
                    )
                  }
                </Show>
              )}
            </Show>
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
                  {fiberSlider(
                    'rise',
                    'Rise',
                    "Between the fiber's units along its path (unset: the entity's)",
                    { min: 0.5, max: 500, scale: 'log', unit: 'Å' },
                    () => src.rise,
                  )}
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
                  <Show
                    when={mapState(chosen, (m) => !!m)}
                    fallback={() => number('rings', 'Rings', 'Rings about the source', { min: 1, max: 30, step: 1 })}
                  >
                    {() =>
                      number(
                        'tiles',
                        'Count',
                        "Its points on the mesh, the source's counted (unset: Rings' on a plane)",
                        { min: 2, max: 5000, step: 1 },
                        () => tilingTotal(settings.value.pattern, settings.value.rings),
                      )
                    }
                  </Show>
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
                  set({ seed: Number.isFinite(n) ? n : undefined });
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
                  // another Grow: the walk before it is not live anymore; this one is, when it is a walk
                  redraw.settle();
                  live.set(undefined);
                  const s = settings.value;
                  void area.grow(growParams(src, { ...s, mesh: onMesh(s, meshes.value) }) as never).then((r) => {
                    const id = r.ok && s.mode === 'walk' ? (r.value as { id?: number } | undefined)?.id : undefined;
                    if (id !== undefined) live.set({ particles: src.particles, grow: id });
                  });
                }}
              >
                Grow
              </Button>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
