/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Choices, Icon, Select, type SelectOption, Show, Slider, TextInput } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { classes } from './_generated/controls.module.css.js';
import type { GraphicsInfo, GraphicsMode, MesoscaleApi } from './operations.js';
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
