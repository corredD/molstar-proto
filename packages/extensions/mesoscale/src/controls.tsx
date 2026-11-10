/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Choices, ColorPicker, For, Icon, Show, Slider } from '@molstar/prism-ui';
import { Color } from '@molstar/core/util/color';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
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
import type { GraphicsInfo, GraphicsMode, MesoscaleApi } from './operations.js';

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
const FarChoices: { id: MembraneFar; label: string }[] = [
  { id: 'both', label: 'Both' },
  { id: 'spheres', label: 'Spheres' },
  { id: 'texture', label: 'Texture' },
];

/** A cut membrane's middle distance (round 8; Ludo compares them live and picks the default; shells not built yet) */
const MiddleChoices: { id: MembraneMiddle; label: string }[] = [
  { id: 'coarse', label: 'Coarse' },
  { id: 'parallax', label: 'Parallax' },
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
    key: 'atomsPx' | 'spheresPx' | 'budget' | 'middlePx',
    min: number,
    max: number,
    unit?: string,
  ) => (
    <div class={classes.line}>
      <div class={classes.label}>{label}</div>
      <Slider
        aria-label={label}
        value={mapState(state, (s) => s?.[key] ?? 0)}
        min={min}
        max={max}
        scale="log"
        {...(unit ? { unit } : {})}
        onCommit={(v) => run({ [key]: v })}
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
            <Choices label="Far" choices={FarChoices} active={far} onPick={(id) => run({ far: id as MembraneFar })} />
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
                  {/* the gate's M1, S5: a middle look takes the lipids at a cut by the far look's switch (the cut band) */}
                  <Show when={mapState(state, (s) => s?.middle === 'parallax' && s?.far === 'texture')}>
                    {() => viewRow('Cut lipids down to', 'atomsPx', 0.25, 16, 'px')}
                  </Show>
                  <Show when={mapState(state, (s) => s?.middle === 'parallax' && s?.far === 'both')}>
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
            choices={FarChoices.filter((c) => c.id !== 'texture')}
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
