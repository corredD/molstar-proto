/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import {
  bind,
  Button,
  Choices,
  For,
  Icon,
  onCleanup,
  ParamsForm,
  Select,
  type SelectOption,
  Show,
  Slider,
  TextInput,
} from '@molstar/prism-ui';
import { latest, restartable } from '@molstar/prism-ui/dom/scoped';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { JSX } from '@molstar/prism-ui/dom/jsx-runtime';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { gestureSteps } from '@molstar/prism-viewer/sources/gesture-steps';
import { classes } from './_generated/controls.module.css.js';
import type { CryoetApi, DecorationsInfo, MeshInfo, ObliqueView, SliceAxis, TargetDecoration } from './operations.js';
import { mb, TiltSeriesPlaces } from './portal-run.js';

// The cryo-ET controls, shown by the extension's own rows and tab and by a host's panels (prism-me's properties):
// what decorates a list's targets, a volume's slice, a segmentation mesh's look. They read the `cryoet` area and act
// through it. Their lines on Prism's tokens and label column (controls.module.css).

/** A line: its label in the label column, then its control */
function Line(props: { label: string; children: JSX.Element }) {
  return (
    <div class={classes.line}>
      <span class={classes.label}>{props.label}</span>
      {props.children}
    </div>
  );
}

/**
 * A slider's changes at pointer rate, live: each preview applied as soon as the one before settles (the newest winning
 * per key, the ones between dropped), the release applying the last, a drag one undo step; keys pressed in a row are
 * one step too (no preview before their commits: the quiet ends it, as Prism's own sliders); the controls gone, what
 * they showed is applied. Prism's `gestureSteps`; no throttle but its own: a step waits as long as the last took, so the
 * page keeps up with the pointer. `overlay(key)`, read again on `changes`: what has not landed yet, for the sliders to
 * show over the state (an earlier step landing does not pull the knob back from the pointer).
 */
function live<C extends object>(
  api: ViewerApi,
  label: string,
  apply: (g: ViewerApi, key: string, change: C) => Promise<unknown>,
) {
  const changes = observableState(0);
  const steps = gestureSteps<C>(api, { label, apply, changed: () => changes.set(changes.value + 1), throttleMs: 0 });
  onCleanup(() => steps.settle());
  let dragged = false;
  return {
    changes: changes.asReadonly,
    overlay: (key = '') => steps.overlay(key),
    preview(c: C, key = '') {
      dragged = true;
      steps.change(key, c);
    },
    commit(c: C, key = '') {
      steps.change(key, c);
      if (!dragged) return;
      dragged = false;
      steps.settle();
    },
  };
}

/** Spheres: no decoration (the select's value) */
const Spheres = '';

/**
 * What decorates a list's targets: all of them (its Targets and All targets rows, every target), or some (`only`: a
 * part's row, its targets alone)
 */
export function Decorations(props: {
  area: CryoetApi;
  info: ReadonlyState<DecorationsInfo>;
  only?: (t: TargetDecoration) => boolean;
}) {
  const { area, info } = props;
  const particles = () => info.value.particles;
  const decorate = (targets: string, value: string) =>
    void area.decorate({
      particles: particles(),
      targets,
      ...(value === Spheres
        ? { with: 'none' }
        : value.startsWith('target:')
          ? { with: 'entity', entity: value }
          : { with: 'object', object: value }),
    } as never);
  // a part's: its targets' rows alone (what each is drawn as, its offset)
  const only = props.only;
  if (only) {
    return (
      <div class={classes.stack}>
        <For each={mapState(info, (i) => [JSON.stringify(i.objects)])} by={(k) => k}>
          {() => (
            <For each={mapState(info, (i) => i.targets.filter(only))} by={(t) => t.id}>
              {(t) => <TargetLine area={area} info={info} target={t} onPick={(v) => decorate(String(t.id), v)} />}
            </For>
          )}
        </For>
      </div>
    );
  }
  return (
    <div class={classes.stack}>
      {/* always shown: File alone, and why, when the file has no columns to split its targets by */}
      <For each={mapState(info, (i) => [i.attributes.map((a) => a.key).join(',')])} by={(k) => k}>
        {() => (
          <>
            <Choices
              label="Targets"
              choices={[
                {
                  id: '',
                  label: 'File',
                  title:
                    "The targets the file gives (one for all, or the file's own), each decorated apart; switching clears the decorations",
                },
                ...info.value.attributes.map((a) => ({
                  id: a.key,
                  label: a.label,
                  title: `Targets by ${a.label}: each of its values a target, decorated apart; switching clears the decorations`,
                })),
              ]}
              active={mapState(info, (i) => i.classes ?? '')}
              onPick={(attribute) => void area.classes({ attribute, particles: particles() })}
            />
            {info.value.attributes.length ? null : (
              <p class={classes.hint}>
                This file has no columns (CC, class, score) to split its targets by: its targets are the file's.
              </p>
            )}
          </>
        )}
      </For>
      {/* the options follow the objects of the scene: the rows are made again when they change */}
      <For each={mapState(info, (i) => [JSON.stringify(i.objects)])} by={(k) => k}>
        {() => (
          <>
            <OffsetLine area={area} particles={particles()} targets="" label="All targets">
              <Select
                size="sm"
                aria-label="Decorate every target with"
                options={options(info.value)}
                value={mapState(info, common)}
                onChange={(v) => decorate('', v)}
              />
            </OffsetLine>
            <For each={mapState(info, (i) => i.targets)} by={(t) => t.id}>
              {(t) => <TargetLine area={area} info={info} target={t} onPick={(v) => decorate(String(t.id), v)} />}
            </For>
          </>
        )}
      </For>
      <TextInput
        size="sm"
        placeholder="PDB id or URL, Enter: every target"
        aria-label="Decorate with a PDB id or URL"
        onSubmit={(id) => void area.decorate({ particles: particles(), with: 'pdb', id } as never)}
      />
      <p class={classes.hint}>
        An object of the scene swaps instantly: open a structure, a mesh (OBJ, PLY, VTP) or a map, then pick it here.
      </p>
    </div>
  );
}

function TargetLine(props: {
  area: CryoetApi;
  info: ReadonlyState<DecorationsInfo>;
  target: TargetDecoration;
  onPick(v: string): void;
}) {
  const { info, target } = props;
  const current = mapState(info, (i) => i.targets.find((t) => t.id === target.id));
  return (
    <OffsetLine area={props.area} particles={info.value.particles} targets={String(target.id)} label={target.name}>
      <span class={classes.hint}>{mapState(current, (t) => (t?.count ?? 0).toLocaleString('en'))}</span>
      <Select
        size="sm"
        aria-label={`Decorate ${target.name} with`}
        options={options(info.value, current.value)}
        value={mapState(current, (t) => t?.object ?? (t?.with ? '*' : Spheres))}
        onChange={(v) => v !== '*' && props.onPick(v)}
      />
    </OffsetLine>
  );
}

const OffsetAxes = [
  { key: 'x', label: 'X', unit: 'Å', of: 'translation', i: 0 },
  { key: 'y', label: 'Y', unit: 'Å', of: 'translation', i: 1 },
  { key: 'z', label: 'Z', unit: 'Å', of: 'translation', i: 2 },
  { key: 'ex', label: 'Turn X', unit: '°', of: 'euler', i: 0 },
  { key: 'ey', label: 'Turn Y', unit: '°', of: 'euler', i: 1 },
  { key: 'ez', label: 'Turn Z', unit: '°', of: 'euler', i: 2 },
] as const;

/**
 * A row of some targets (every one: '') with its offset by numbers on demand: the options button opens six sliders,
 * X, Y, Z (Å, along each particle's own axes) and Turn X, Y, Z (°, about them), each released one step
 * (`cryoet.offset`); lit while an offset is set
 */
function OffsetLine(props: {
  area: CryoetApi;
  particles: string;
  targets: string;
  label: string;
  children: JSX.Element | JSX.Element[];
}) {
  const { area, particles, targets } = props;
  const offset = area.offsetState(particles, targets);
  const open = observableState(false);
  const set = (key: string, v: number) => void area.offset({ particles, targets, [key]: v } as never);
  return (
    <div class={classes.tight}>
      <div class={classes.tools}>
        <span class={classes.name}>{props.label}</span>
        {props.children}
        <Button
          size="xs"
          variant="ghost"
          title="Its offset: placed off each particle, in its own frame"
          pressed={derive([open.asReadonly, offset], (o, off) => o || !!off)}
          icon={<Icon name="sliders-horizontal" />}
          onClick={() => open.set(!open.value)}
        />
      </div>
      <Show when={open.asReadonly}>
        {() => (
          <div class={classes.inline}>
            {OffsetAxes.map((a) => {
              const value = mapState(offset, (o) => o?.[a.of][a.i] ?? 0);
              const range = a.unit === 'Å' ? 200 : 180;
              return (
                <Line label={a.label}>
                  <Slider
                    aria-label={`${props.label} offset ${a.label}`}
                    value={value}
                    min={-range}
                    max={range}
                    step={a.unit === 'Å' ? 0.5 : 1}
                    clamp={false}
                    format={(v) => String(Math.round(v * 10) / 10)}
                    unit={a.unit}
                    onCommit={(v) => set(a.key, v)}
                  />
                </Line>
              );
            })}
          </div>
        )}
      </Show>
    </div>
  );
}

function options(info: DecorationsInfo, target?: TargetDecoration): SelectOption[] {
  const out: SelectOption[] = [
    [Spheres, 'Spheres'],
    // a model's entities under its name, its label the entity's
    ...info.objects.map((o) =>
      o.group ? ([o.ref, o.label.slice(o.group.length + 3), o.group] as const) : ([o.ref, o.label] as const),
    ),
  ];
  // a decoration that is not an object of the scene (a PDB id, the file's own): shown, not picked again
  if (target?.with && !target.object) out.push(['*', target.with]);
  return out;
}

/** The object every target is decorated with, if they all share one */
function common(info: DecorationsInfo): string {
  const objects = new Set(info.targets.map((t) => t.object ?? (t.with ? '*' : Spheres)));
  if (objects.size !== 1) return '';
  const [o] = objects;
  return o === '*' ? '' : o;
}

/**
 * An oblique slice: its handle (moved anywhere, tilted about X and Y), its point and tilt by numbers in the volume's
 * frame (its center, its axes: they stay as the volume moves), its contrast
 */
export function ObliqueSlice(props: { api: ViewerApi; area: CryoetApi; volume: string; slice: string }) {
  const { api, area, volume, slice } = props;
  const info = area.sliceState(volume);
  const view = mapState(info, (s) => s?.obliques.find((o) => o.ref === slice));
  const radius = mapState(info, (s) => Math.ceil(s?.radius ?? 100));
  const handles = area.useObliqueHandles(api);
  const on = mapState(handles.target, (t) => t?.slice === slice);
  const place = live<Partial<Record<'x' | 'y' | 'z' | 'ex' | 'ey' | 'contrast', number>>>(
    api,
    'Oblique slice',
    (g, _key, v) => g.cryoet!.oblique({ volume, slice, ...v } as never),
  );
  const number = (
    label: string,
    read: (o: ObliqueView) => number,
    key: 'x' | 'y' | 'z' | 'ex' | 'ey',
    range: { min: ReadonlyState<number> | number; max: ReadonlyState<number> | number; unit: string },
  ) => (
    <Line label={label}>
      <Slider
        aria-label={label}
        value={derive([view, place.changes], (o) => place.overlay()?.[key] ?? (o ? Math.round(read(o) * 10) / 10 : 0))}
        min={range.min}
        max={range.max}
        step={0.1}
        unit={range.unit}
        onPreview={(v) => place.preview({ [key]: v })}
        onCommit={(v) => place.commit({ [key]: v })}
      />
    </Line>
  );
  const across = { min: mapState(radius, (r) => -r), max: radius, unit: 'Å' };
  return (
    <div class={classes.tight}>
      <Line label="Handle">
        <Button size="sm" variant="ghost" onClick={() => (on.value ? handles.hide() : handles.show({ volume, slice }))}>
          {mapState(on, (o) => (o ? 'Hide the handle' : 'Show the handle'))}
        </Button>
      </Line>
      <span class={classes.hint}>
        In the volume's frame: from its center, along its axes (they stay as the volume moves).
      </span>
      {number('X', (o) => o.position[0], 'x', across)}
      {number('Y', (o) => o.position[1], 'y', across)}
      {number('Z', (o) => o.position[2], 'z', across)}
      {number('Tilt X', (o) => o.tilt[0], 'ex', { min: -90, max: 90, unit: '°' })}
      {number('Tilt Y', (o) => o.tilt[1], 'ey', { min: -180, max: 180, unit: '°' })}
      <Line label="Contrast">
        <Slider
          aria-label="Contrast"
          value={derive([view, place.changes], (o) => place.overlay()?.contrast ?? o?.contrast ?? 3)}
          min={0.5}
          max={10}
          step={0.1}
          unit="±σ"
          onPreview={(c) => place.preview({ contrast: c })}
          onCommit={(c) => place.commit({ contrast: c })}
        />
      </Line>
    </div>
  );
}

/** What the Data section says while a level is read, asked about or failed to read */
type LevelStatus =
  | { readonly kind: 'busy' | 'failed'; readonly text: string }
  | { readonly kind: 'confirm'; readonly text: string; readonly index: number };

/**
 * What a volume's data is: its source, grid, voxel and size; an OME-Zarr of several levels, the level it is read at, a
 * slider coarsest to finest read at the release (`cryoet.level`, one step: never while dragged, a finer level is a long
 * read). A level over the volume's size guard asks first (Read it / Cancel); a failure says why, on the level read.
 * Only the last release's answer is shown (`latest`): a read released over another in flight is still sent (the
 * operations run in turn), and the earlier answer lands on nothing.
 */
export function VolumeData(props: { area: CryoetApi; volume: string }) {
  const { area, volume } = props;
  const info = area.dataState(volume);
  const levels = mapState(info, (i) => i?.levels ?? []);
  const read = mapState(info, (i) => Math.max(0, i?.levels.findIndex((l) => l.path === i.level) ?? 0));
  // the level asked for (the slider stays on it while it is read or asked about), the one dragged over (its label)
  const asked = observableState<number | undefined>(undefined);
  const over = observableState<number | undefined>(undefined);
  const status = observableState<LevelStatus | undefined>(undefined);
  const value = derive([read, asked.asReadonly], (r, a) => a ?? r);
  const label = derive([levels, value, over.asReadonly], (ls, v, o) => ls[o ?? v]?.label ?? '');
  const readLevel = latest((_signal, level: string, large: boolean) => area.level({ volume, level, large } as never));
  const load = async (index: number, large = false) => {
    over.set(undefined);
    const l = levels.value[index];
    // the level read now, unless a read is in flight: then the volume may end at that one
    if (!l || (l.path === info.value?.level && status.value?.kind !== 'busy')) {
      readLevel.abort();
      asked.set(undefined);
      status.set(undefined);
      return;
    }
    asked.set(index);
    status.set({ kind: 'busy', text: `Reading ${l.label}…` });
    const r = await readLevel(l.path, large);
    if (!r) return;
    if (!r.ok && r.code === 'confirm') {
      status.set({ kind: 'confirm', text: `${r.message} Read it?`, index });
      return;
    }
    asked.set(undefined);
    status.set(r.ok ? undefined : { kind: 'failed', text: r.message });
  };
  const cancel = () => {
    readLevel.abort();
    asked.set(undefined);
    status.set(undefined);
  };
  const fact = (name: string, text: ReadonlyState<string>) => (
    <Line label={name}>
      <span>{text}</span>
    </Line>
  );
  return (
    <div class={classes.tight}>
      {fact(
        'Source',
        mapState(info, (i) => i?.source ?? ''),
      )}
      {fact(
        'Grid',
        mapState(info, (i) => i?.grid ?? ''),
      )}
      {fact(
        'Voxel',
        mapState(info, (i) => i?.voxel ?? ''),
      )}
      {fact(
        'Size',
        mapState(info, (i) => (i ? mb(i.bytes) : '')),
      )}
      <Show when={mapState(levels, (ls) => ls.length > 1)}>
        {() => (
          <>
            <Line label="Level">
              <Slider
                aria-label="Level"
                value={value}
                min={0}
                max={mapState(levels, (ls) => ls.length - 1)}
                step={1}
                format={(i) => `${levels.value[i]?.binning ?? ''}×`}
                parse={(text) => {
                  // a binning typed ("2", "2×"); another text: where it is
                  const i = levels.value.findIndex((l) => l.binning === Number.parseFloat(text));
                  return i < 0 ? value.value : i;
                }}
                onPreview={(i) => over.set(i)}
                onCommit={(i) => void load(i)}
              />
            </Line>
            <p class={classes.hint}>{label}</p>
          </>
        )}
      </Show>
      <Show when={mapState(status.asReadonly, (s) => s?.kind === 'confirm')}>
        {() => (
          <div class={classes.inline} role="group" aria-label="Read a large level?">
            <p class={classes.hint}>{mapState(status.asReadonly, (s) => s?.text ?? '')}</p>
            <div class={classes.tools}>
              <Button
                size="sm"
                onClick={() => {
                  const s = status.value;
                  if (s?.kind === 'confirm') void load(s.index, true);
                }}
              >
                Read it
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={mapState(status.asReadonly, (s) => s?.kind === 'busy' || s?.kind === 'failed')}>
        {() => (
          <p class={classes.hint} role="status">
            {mapState(status.asReadonly, (s) => s?.text ?? '')}
          </p>
        )}
      </Show>
    </div>
  );
}

/** The tilt angle of a tilt series' image at `index` (from 0), as the portal gives it: '−60.005°'; '' past its images */
export function tiltAngleText(angles: readonly number[] | undefined, index: number) {
  const a = angles?.[index];
  return a === undefined ? '' : `${String(Math.round(a * 1000) / 1000).replace('-', '−')}°`;
}

/**
 * A volume's slice along `axis` (one per axis): its position and its gray window; without `axis`, a choice of the axis
 * first (the slice it shows is edited), and the three slices at a click. A tilt series' `angles` (one an image): the Z
 * slice's image's on a Tilt line under it, and its Placement by its tomogram, a click each (_spec/portal.md §4)
 */
export function Slice(props: {
  api: ViewerApi;
  area: CryoetApi;
  volume: string;
  axis?: SliceAxis;
  angles?: readonly number[];
}) {
  const { api, area, volume } = props;
  const info = area.sliceState(volume);
  const picked = observableState<SliceAxis>(props.axis ?? 'z');
  const axis = props.axis ? undefined : picked;
  const current = () => props.axis ?? picked.value;
  const slice = derive([info, picked.asReadonly], (s, a) => s?.slices.find((x) => x.axis === (props.axis ?? a)));
  const index = mapState(slice, (s) => s?.index);
  const count = derive([info, picked.asReadonly], (s, a) =>
    s ? s.dimensions[{ x: 0, y: 1, z: 2 }[props.axis ?? a]] : 1,
  );
  const contrast = mapState(slice, (s) => s?.contrast);
  // a gesture's steps by axis (the picker may change it while one still lands)
  const move = live<{ index?: number; contrast?: number }>(api, 'Slice', (g, axis, v) =>
    g.cryoet!.slice({ volume, axis, ...v } as never),
  );
  // a value of the slice shown: what has not landed yet for its axis over the state's
  const shown = (key: 'index' | 'contrast', now: ReadonlyState<number | undefined>, none: number) =>
    derive([now, move.changes, picked.asReadonly], (v) => move.overlay(current())?.[key] ?? v ?? none);
  // on a line of its own, not the slider's unit: a unit of changing width would resize the track mid-drag; it follows
  // the slice shown (a drag's value before it lands)
  const angle = derive([count, shown('index', index, 0), picked.asReadonly], (n, i, a) =>
    (props.axis ?? a) === 'z' && props.angles?.length === n ? tiltAngleText(props.angles, i) : '',
  );
  return (
    <div class={classes.tight}>
      {axis ? (
        <Choices
          label="Axis"
          choices={[
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
            { id: 'z', label: 'Z (images)' },
          ]}
          active={axis.asReadonly}
          onPick={(id) => axis.set(id as SliceAxis)}
        />
      ) : null}
      <Show
        when={mapState(slice, (s) => !!s)}
        fallback={() => (
          <Button size="sm" onClick={() => void area.slice({ volume, axis: current() } as never)}>
            {mapState(picked.asReadonly, (a) => `Show slice ${(props.axis ?? a).toUpperCase()}`)}
          </Button>
        )}
      >
        {() => (
          <>
            {/* the box counts from 1, of the count */}
            <Line label="Slice">
              <Slider
                aria-label="Slice"
                value={shown('index', index, 0)}
                min={0}
                max={mapState(count, (n) => Math.max(0, n - 1))}
                step={1}
                format={(i) => String(i + 1)}
                parse={(text) => Math.round(Number.parseFloat(text)) - 1}
                unit={mapState(count, (n) => `/ ${n}`)}
                onPreview={(i) => move.preview({ index: i }, current())}
                onCommit={(i) => move.commit({ index: i }, current())}
              />
            </Line>
            <Show when={mapState(angle, (t) => !!t)}>
              {() => (
                <Line label="Tilt">
                  <span>{angle}</span>
                </Line>
              )}
            </Show>
            <Line label="Contrast">
              <Slider
                aria-label="Contrast"
                value={shown('contrast', contrast, 3)}
                min={0.5}
                max={10}
                step={0.1}
                unit="±σ"
                onPreview={(c) => move.preview({ contrast: c }, current())}
                onCommit={(c) => move.commit({ contrast: c }, current())}
              />
            </Line>
          </>
        )}
      </Show>
      {!!props.angles?.length && api?.cryoetPortal ? <Placement api={api} volume={volume} /> : null}
      {axis ? (
        <Show when={mapState(info, (s) => (s?.slices.length ?? 0) < 3)}>
          {() => (
            <Button size="sm" variant="ghost" onClick={() => void area.slices({ volume } as never)}>
              Show the three slices
            </Button>
          )}
        </Show>
      ) : null}
    </div>
  );
}

/**
 * A portal tilt series' place by its tomogram (`cryoetPortal.place`): beside as read, beside turned, overlay turned; the
 * one it is in pressed, none once moved elsewhere (a switch to compare: Ludo, 2026-11-04)
 */
function Placement(props: { api: ViewerApi; volume: string }) {
  const portal = props.api.cryoetPortal!;
  return (
    <Choices
      label="Placement"
      choices={TiltSeriesPlaces.map(([id, label]) => ({ id, label }))}
      active={portal.placeState(props.volume)}
      onPick={(place) => void portal.place({ volume: props.volume, place } as never)}
    />
  );
}

/**
 * A segmentation mesh's look: shown or hidden, its color (Prism's color row: its `ColorPicker`, one change a moment after
 * the last move), surface, wireframe or both, opacity, scale
 */
export function MeshControls(props: {
  api: ViewerApi;
  area: CryoetApi;
  /** The mesh by state ref (not its info: the controls stay as it changes, a drag goes on) */
  mesh: string;
  list: ReadonlyState<readonly MeshInfo[]>;
}) {
  const { api, area } = props;
  const ref = props.mesh;
  const mesh = mapState(props.list, (l) => l.find((m) => m.ref === ref));
  // one change a moment after the last (the picker dragged), made at once if the controls go first
  let pending: Record<string, unknown> | undefined;
  const write = () => {
    const values = pending;
    pending = undefined;
    if (values) void area.mesh({ mesh: ref, ...values } as never);
  };
  const timer = restartable(write);
  onCleanup(write);
  const set = (values: Record<string, unknown>, delay = 0) => {
    pending = { ...pending, ...values };
    timer.start(delay);
  };
  const opacity = live<{ opacity: number }>(api, 'Mesh opacity', (g, _key, v) =>
    g.cryoet!.mesh({ mesh: ref, ...v } as never),
  );
  const color = new ParamsFormModel({ color: PD.Color(Color(0xcccccc)) }, undefined, {
    onChange: ({ color }) => set({ color: Color.toHexStyle(color) }, 120),
  });
  bind(mesh, (m) => color.load({ color: Color(m?.color ?? 0xcccccc) }));
  return (
    <div class={classes.tight}>
      <div class={classes.tools}>
        <Button
          size="xs"
          variant="ghost"
          title="Show or hide"
          icon={
            <Show when={mapState(mesh, (m) => m?.visible ?? true)} fallback={() => <Icon name="eye-off" />}>
              {() => <Icon name="eye" />}
            </Show>
          }
          onClick={() => set({ visible: !(mesh.value?.visible ?? true) })}
        />
        <strong class={classes.name}>{mapState(mesh, (m) => m?.label ?? '')}</strong>
      </div>
      <ParamsForm form={color} />
      <Choices
        choices={[
          { id: 'mesh', label: 'Surface' },
          { id: 'wireframe', label: 'Wireframe' },
          { id: 'both', label: 'Both' },
        ]}
        active={mapState(mesh, (m) => (m && m.visuals.length > 1 ? 'both' : (m?.visuals[0] ?? 'mesh')))}
        onPick={(visuals) => set({ visuals })}
      />
      <Line label="Opacity">
        <Slider
          aria-label="Opacity"
          value={derive([mesh, opacity.changes], (m) => opacity.overlay()?.opacity ?? m?.opacity ?? 1)}
          min={0.05}
          max={1}
          step={0.01}
          onPreview={(o) => opacity.preview({ opacity: o })}
          onCommit={(o) => opacity.commit({ opacity: o })}
        />
      </Line>
      {/* a mesh in pixels (a segmentation of a tomogram): its scale is the pixel size; the slider goes by powers */}
      <Line label="Scale">
        <Slider
          aria-label="Scale"
          value={mapState(mesh, (m) => m?.scale ?? 1)}
          min={0.01}
          max={100}
          scale="log"
          clamp={false}
          onCommit={(scale) => set({ scale })}
        />
      </Line>
    </div>
  );
}
