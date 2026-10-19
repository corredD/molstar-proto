/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Choices, For, Icon, onCleanup, Select, Show, TextInput } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { CryoetApi, DecorationsInfo, MeshInfo, TargetDecoration } from './operations.js';

// The cryo-ET controls, shown by the extension's own rows and tab and by a host's panels (prism-me's properties):
// what decorates a list's targets, a volume's slice, a segmentation mesh's look. They read the `cryoet` area and act
// through it.

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';
const Line = 'display: flex; align-items: center; gap: var(--msp-space-2); min-height: 28px';

/** Spheres: no decoration (the select's value) */
const Spheres = '';

export function Decorations(props: { area: CryoetApi; info: ReadonlyState<DecorationsInfo> }) {
  const { area, info } = props;
  const particles = () => info.value.particles;
  const decorate = (targets: string, value: string) =>
    void area.decorate({
      particles: particles(),
      targets,
      ...(value === Spheres ? { with: 'none' } : { with: 'object', object: value }),
    } as never);
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <Show when={mapState(info, (i) => i.attributes.length > 0)}>
        {() => (
          <Choices
            label="Targets"
            choices={[{ id: '', label: 'File' }, ...info.value.attributes.map((a) => ({ id: a.key, label: a.label }))]}
            active={mapState(info, (i) => i.classes ?? '')}
            onPick={(attribute) => void area.classes({ attribute, particles: particles() })}
          />
        )}
      </Show>
      {/* the options follow the objects of the scene: the rows are made again when they change */}
      <For each={mapState(info, (i) => [JSON.stringify(i.objects)])} by={(k) => k}>
        {() => (
          <>
            <div style={Line}>
              <span style="flex: 1">All targets</span>
              <Select
                size="sm"
                aria-label="Decorate every target with"
                options={options(info.value)}
                value={mapState(info, common)}
                onChange={(v) => decorate('', v)}
              />
            </div>
            <For each={mapState(info, (i) => i.targets)} by={(t) => t.id}>
              {(t) => <TargetLine info={info} target={t} onPick={(v) => decorate(String(t.id), v)} />}
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
      <p style={`margin: 0; ${Muted}`}>
        An object of the scene swaps instantly: open a structure, a mesh (OBJ, PLY, VTP) or a map, then pick it here.
      </p>
    </div>
  );
}

function TargetLine(props: {
  info: ReadonlyState<DecorationsInfo>;
  target: TargetDecoration;
  onPick(v: string): void;
}) {
  const { info, target } = props;
  const current = mapState(info, (i) => i.targets.find((t) => t.id === target.id));
  return (
    <div style={Line}>
      <span style="flex: 1; overflow: hidden; white-space: nowrap">{target.name}</span>
      <span style={Muted}>{mapState(current, (t) => (t?.count ?? 0).toLocaleString('en'))}</span>
      <Select
        size="sm"
        aria-label={`Decorate ${target.name} with`}
        options={options(info.value, current.value)}
        value={mapState(current, (t) => t?.object ?? (t?.with ? '*' : Spheres))}
        onChange={(v) => v !== '*' && props.onPick(v)}
      />
    </div>
  );
}

function options(info: DecorationsInfo, target?: TargetDecoration): [string, string][] {
  const out: [string, string][] = [
    [Spheres, 'Spheres'],
    ...info.objects.map((o) => [o.ref, o.label] as [string, string]),
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

export function Slice(props: { area: CryoetApi; volume: string }) {
  const { area, volume } = props;
  const slice = area.sliceState(volume);
  const axis = mapState(slice, (s) => s?.shown?.axis ?? 'z');
  const index = mapState(slice, (s) => s?.shown?.index);
  const count = mapState(slice, (s) => (s ? s.dimensions[{ x: 0, y: 1, z: 2 }[s.shown?.axis ?? 'z']] : 1));
  const contrast = mapState(slice, (s) => s?.shown?.contrast ?? 3);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  // The sliders change at pointer rate: one call a moment after the last.
  const run = (values: { axis?: string; index?: number; contrast?: number }, delay = 60) => {
    clearTimeout(timer);
    timer = setTimeout(() => void area.slice({ volume, axis: axis.value, ...values } as never), delay);
  };
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <Choices
        label="Axis"
        choices={[
          { id: 'x', label: 'X' },
          { id: 'y', label: 'Y' },
          { id: 'z', label: 'Z (images)' },
        ]}
        active={axis}
        onPick={(id) => run({ axis: id }, 0)}
      />
      <div style={Line}>
        <span style="width: 64px">Slice</span>
        <input
          type="range"
          min="0"
          max={mapState(count, (n) => String(Math.max(0, n - 1)))}
          value={mapState(index, (i) => String(i ?? 0))}
          style="flex: 1"
          aria-label="Slice"
          onInput={(e) => run({ index: Number((e.target as HTMLInputElement).value) })}
        />
        <span style={Muted}>
          {derive([index, count], (i, n) => (i === undefined ? `– / ${n}` : `${i + 1} / ${n}`))}
        </span>
      </div>
      <div style={Line}>
        <span style="width: 64px">Contrast</span>
        <input
          type="range"
          min="0.5"
          max="10"
          step="0.1"
          value={mapState(contrast, String)}
          style="flex: 1"
          aria-label="Contrast"
          onInput={(e) => run({ contrast: Number((e.target as HTMLInputElement).value) })}
        />
        <span style={Muted}>{mapState(contrast, (c) => `±${c}σ`)}</span>
      </div>
      <Show when={mapState(index, (i) => i === undefined)}>
        {() => (
          <Button size="sm" onClick={() => run({}, 0)}>
            Show a slice
          </Button>
        )}
      </Show>
    </div>
  );
}

export function MeshControls(props: { area: CryoetApi; mesh: MeshInfo; list: ReadonlyState<readonly MeshInfo[]> }) {
  const { area } = props;
  const ref = props.mesh.ref;
  const mesh = mapState(props.list, (l) => l.find((m) => m.ref === ref));
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const set = (values: Record<string, unknown>, delay = 0) => {
    clearTimeout(timer);
    timer = setTimeout(() => void area.mesh({ mesh: ref, ...values } as never), delay);
  };
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <div style={Line}>
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
        <strong style="flex: 1; overflow: hidden; white-space: nowrap">{props.mesh.label}</strong>
        <input
          type="color"
          aria-label="Color"
          value={mapState(mesh, (m) => `#${(m?.color ?? 0xcccccc).toString(16).padStart(6, '0')}`)}
          onInput={(e) => set({ color: (e.target as HTMLInputElement).value }, 120)}
        />
      </div>
      <Choices
        choices={[
          { id: 'mesh', label: 'Surface' },
          { id: 'wireframe', label: 'Wireframe' },
          { id: 'both', label: 'Both' },
        ]}
        active={mapState(mesh, (m) => (m && m.visuals.length > 1 ? 'both' : (m?.visuals[0] ?? 'mesh')))}
        onPick={(visuals) => set({ visuals })}
      />
      <div style={Line}>
        <span style="width: 64px">Opacity</span>
        <input
          type="range"
          min="0.05"
          max="1"
          step="0.01"
          style="flex: 1"
          aria-label="Opacity"
          value={mapState(mesh, (m) => String(m?.opacity ?? 1))}
          onInput={(e) => set({ opacity: Number((e.target as HTMLInputElement).value) }, 80)}
        />
      </div>
    </div>
  );
}
