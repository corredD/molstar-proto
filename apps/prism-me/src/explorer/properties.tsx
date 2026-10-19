/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { Decorations, MeshControls, Slice } from '@molstar/cryoet-extension/controls';
import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { GraphicsMode, Motion } from '@molstar/mesoscale-extension/controls';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import { Button, ColorPicker, For, Icon, onCleanup, ParamsForm, Select, Show } from '@molstar/prism-ui';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { JSX } from '@molstar/prism-ui/dom/jsx-runtime';
import type { ExplorerApi, NodeRef } from './operations.js';
import type { Parts } from './rows.js';

// The properties of the row picked in the explorer's tree (_spec/ui.md §4): its name, then sections that fold, only
// those that apply: Look (color, opacity, glow; what the node shows now), Representation (a structure's preset),
// Decoration (a particle list's targets), Slice (a volume), the mesh's look, Graphics (a model's mode and motion).
// They act through the API as the person; a slider once released (one step).

/** The row picked: its key in the tree, what it is, what it stands for */
export interface Picked {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly node?: NodeRef;
}

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';
const Line = 'display: flex; align-items: center; gap: var(--msp-space-2); min-height: 28px';
const Label = 'width: 64px; flex: none';

export function Properties(props: {
  api: ViewerApi;
  area: ExplorerApi;
  picked: ReadonlyState<Picked | undefined>;
  parts: ReadonlyState<Parts>;
}) {
  // made again for each pick
  return (
    <For each={mapState(props.picked, (p) => (p ? [p] : []))} by={(p) => p.key}>
      {(p) => <NodeProperties api={props.api} area={props.area} picked={p} parts={props.parts} />}
    </For>
  );
}

function NodeProperties(props: { api: ViewerApi; area: ExplorerApi; picked: Picked; parts: ReadonlyState<Parts> }) {
  const { api, area, picked } = props;
  const node = picked.node;
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <div style="display: flex; align-items: baseline; gap: var(--msp-space-2); min-width: 0">
        <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{picked.label}</strong>
        <span style={Muted}>{picked.kind}</span>
      </div>
      {node ? sectionsOf(api, area, picked.kind, node, props.parts) : null}
    </div>
  );
}

function sectionsOf(
  api: ViewerApi,
  area: ExplorerApi,
  kind: string,
  node: NodeRef,
  parts: ReadonlyState<Parts>,
): JSX.Element[] {
  if ('particles' in node || kind === 'mesoscale model') {
    if (kind === 'target')
      return [<Section title="Decoration">{() => <ListDecoration api={api} node={node} />}</Section>];
    const out = [<Section title="Look">{() => <ParticleLook api={api} node={node} parts={parts} />}</Section>];
    if (kind === 'mesoscale model') {
      out.push(
        <Section title="Representation">{() => <ParticleRepresentations api={api} area={area} node={node} />}</Section>,
      );
    }
    if (kind === 'mesoscale model' && api.mesoscale) {
      const mesoscale = api.mesoscale;
      out.push(
        <Section title="Graphics">
          {() => (
            <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
              <GraphicsMode area={mesoscale} />
              <Motion area={mesoscale} />
            </div>
          )}
        </Section>,
      );
    }
    return out;
  }
  switch (kind) {
    case 'structure':
      return [
        <Section title="Look">{() => <StructureLook api={api} area={area} node={node} whole />}</Section>,
        <Section title="Representation">{() => <Representation api={api} area={area} node={node} />}</Section>,
      ];
    case 'entity':
    case 'chain':
      return [<Section title="Look">{() => <StructureLook api={api} area={area} node={node} />}</Section>];
    case 'particle list':
      return [
        <Section title="Decoration">{() => <ListDecoration api={api} node={node} />}</Section>,
        <Section title="Representation">{() => <ParticleRepresentations api={api} area={area} node={node} />}</Section>,
      ];
    case 'volume':
    case 'volume representation':
      return api.cryoet
        ? [<Section title="Slice">{() => <Slice area={api.cryoet!} volume={node.ref} />}</Section>]
        : [];
    case 'mesh':
      return [<Section title="Look">{() => <MeshLook api={api} node={node} />}</Section>];
  }
  return [];
}

// --- sections --------------------------------------------------------------------------------------------------------

function Section(props: { title: string; children: () => JSX.Element }) {
  const open = observableState(true);
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      <button
        type="button"
        style="display: flex; align-items: center; gap: var(--msp-space-1); padding: 0; border: none; background: none; color: inherit; font: inherit; font-weight: 600; cursor: pointer; text-align: left"
        aria-expanded={mapState(open.asReadonly, String)}
        onClick={() => open.set(!open.value)}
      >
        <Show when={open.asReadonly} fallback={() => <Icon name="chevron-right" />}>
          {() => <Icon name="chevron-down" />}
        </Show>
        {props.title}
      </button>
      <Show when={open.asReadonly}>{() => <div style="padding-left: var(--msp-space-4)">{props.children()}</div>}</Show>
    </div>
  );
}

/** A color: its swatch and value; a click opens the picker under it. `value` undefined: no color of its own */
function ColorField(props: { value: ReadonlyState<number | undefined>; none: string; onPick(color: string): void }) {
  const picking = observableState(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  // the picker changes as it is dragged across: one call a moment after the last
  const pick = (c: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => props.onPick(Color.toHexStyle(Color(c))), 150);
  };
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      <div style={Line}>
        <span style={Label}>Color</span>
        <button
          type="button"
          aria-label="Pick a color"
          style={mapState(
            props.value,
            (c) =>
              `width: 18px; height: 18px; border-radius: 50%; padding: 0; cursor: pointer; border: 1px solid var(--msp-color-border); background: ${c === undefined ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' : Color.toHexStyle(Color(c))}`,
          )}
          onClick={() => picking.set(!picking.value)}
        />
        <span style={Muted}>
          {mapState(props.value, (c) => (c === undefined ? props.none : Color.toHexStyle(Color(c))))}
        </span>
      </div>
      <Show when={picking.asReadonly}>
        {() => <ColorPicker value={mapState(props.value, (c) => c ?? 0xffffff)} onChange={pick} />}
      </Show>
    </div>
  );
}

/** A slider whose value is what the node shows; it acts once released. `undefined`: mixed */
function SliderField(props: {
  label: string;
  value: ReadonlyState<number | undefined>;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
  onCommit(v: number): void;
}) {
  const shown = observableState<number | undefined>(props.value.value);
  const sub = props.value.subscribe((v) => shown.set(v));
  onCleanup(() => sub.unsubscribe());
  return (
    <div style={Line}>
      <span style={Label}>{props.label}</span>
      <input
        type="range"
        min={String(props.min)}
        max={String(props.max)}
        step={String(props.step)}
        style="flex: 1; min-width: 0"
        aria-label={props.label}
        value={mapState(shown.asReadonly, (v) => String(v ?? props.min))}
        onInput={(e) => shown.set(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
      />
      <span style={`width: 44px; text-align: right; ${Muted}`}>
        {mapState(shown.asReadonly, (v) => (v === undefined ? 'mixed' : props.format(v)))}
      </span>
    </div>
  );
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

// --- structures ------------------------------------------------------------------------------------------------------

const Themes: [string, string][] = [
  ['', 'Color by…'],
  ['chain-id', 'Chain'],
  ['entity-id', 'Entity'],
  ['element-symbol', 'Element'],
  ['secondary-structure', 'Secondary structure'],
  ['sequence-id', 'Rainbow'],
  ['hydrophobicity', 'Hydrophobicity'],
  ['illustrative', 'Illustrative'],
];

function StructureLook(props: { api: ViewerApi; area: ExplorerApi; node: NodeRef; whole?: boolean }) {
  const { api, area, node } = props;
  const look = area.structureLookState(node);
  const at = () => ({ target: { loci: area.loci(node) }, structure: node.ref });
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      <ColorField
        value={mapState(look, (l) => l?.color)}
        none="its representation's"
        onPick={(color) => void api.run('representation.color', { ...at(), color })}
      />
      {props.whole ? (
        <div style={Line}>
          <span style={Label} />
          <Select
            size="sm"
            aria-label="Color by"
            options={Themes}
            value=""
            onChange={(theme) => theme && void api.run('representation.color', { ...at(), theme })}
          />
        </div>
      ) : null}
      <SliderField
        label="Opacity"
        value={mapState(look, (l) => 1 - (l?.transparency ?? 0))}
        min={0}
        max={1}
        step={0.01}
        format={percent}
        onCommit={(v) => void api.run('representation.transparency', { ...at(), alpha: 1 - v })}
      />
      <SliderField
        label="Glow"
        value={mapState(look, (l) => l?.emissive ?? 0)}
        min={0}
        max={1}
        step={0.01}
        format={percent}
        onCommit={(strength) => void api.run('representation.emissive', { ...at(), strength })}
      />
      {props.whole ? (
        <div style={Line}>
          <span style={Label} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void api.run('representation.reset', { layer: 'all', structure: node.ref })}
          >
            Reset colors, opacity and glow
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Representation(props: { api: ViewerApi; area: ExplorerApi; node: NodeRef }) {
  const { api, area, node } = props;
  return (
    <div style={Line}>
      <span style={Label}>Preset</span>
      <Select
        size="sm"
        aria-label="Representation preset"
        options={[['', 'Apply a preset…'], ...area.presets(node.ref)]}
        value=""
        onChange={(preset) => preset && void api.run('structure.preset', { preset, structure: node.ref })}
      />
    </div>
  );
}

// --- particles -------------------------------------------------------------------------------------------------------

/** One value if every entity has it, else undefined (mixed) */
function common<T>(values: readonly T[]): T | undefined {
  if (!values.length) return undefined;
  const [first] = values;
  return values.every((v) => v === first) ? first : undefined;
}

function ParticleLook(props: { api: ViewerApi; node: NodeRef; parts: ReadonlyState<Parts> }) {
  const { api, node } = props;
  const ids = 'particles' in node ? node.particles.entities : undefined;
  const entities = mapState(props.parts, (p) => {
    const info = p.get(node.ref) as MesoscaleInfo | undefined;
    const all = info?.entities ?? [];
    return ids ? all.filter((e) => ids.includes(e.id)) : all;
  });
  const selection = ids ? { entities: ids.join(',') } : {};
  const style = (patch: Record<string, unknown>) =>
    void api.run('mesoscale.style', { particles: node.ref, ...selection, ...patch });
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      <ColorField
        value={mapState(entities, (es) => common(es.map((e) => e.color as number | undefined)))}
        none={ids && ids.length === 1 ? 'the color theme' : 'mixed'}
        onPick={(color) => style({ color })}
      />
      <SliderField
        label="Opacity"
        value={mapState(entities, (es) => common(es.map((e) => 1 - (e.transparency ?? 0))))}
        min={0}
        max={1}
        step={0.01}
        format={percent}
        onCommit={(v) => style({ transparency: 1 - v })}
      />
      <SliderField
        label="Glow"
        value={mapState(entities, (es) => common(es.map((e) => e.emissive ?? 0)))}
        min={0}
        max={1}
        step={0.01}
        format={percent}
        onCommit={(emissive) => style({ emissive })}
      />
      {!ids || ids.length > 1 ? (
        <div style={`${Line}; flex-wrap: wrap`}>
          <span style={Label} />
          <Button
            size="sm"
            icon={<Icon name="palette" />}
            onClick={() => void api.run('mesoscale.colors', { scheme: 'generate', particles: node.ref, ...selection })}
          >
            Generate colors
          </Button>
          <Button size="sm" variant="ghost" onClick={() => style({ reset: true })}>
            Reset
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ListDecoration(props: { api: ViewerApi; node: NodeRef }) {
  const cryoet = props.api.cryoet;
  if (!cryoet) return <span style={Muted}>The cryo-ET extension is not loaded.</span>;
  const info = cryoet.decorationsState(props.node.ref);
  return (
    <Show when={mapState(info, (i) => !!i)}>
      {() => <Decorations area={cryoet} info={info as ReadonlyState<DecorationsInfo>} />}
    </Show>
  );
}

/**
 * A particle list's representations, each with its whole form (the type: spheres, orientation, the targets…, then its
 * params), as Prism's inspector shows one; a change acts a moment after the last (sliders change at pointer rate)
 */
function ParticleRepresentations(props: { api: ViewerApi; area: ExplorerApi; node: NodeRef }) {
  const { api, area } = props;
  const reprs = area.particleRepresentationsState(props.node.ref);
  return (
    <Show when={mapState(reprs, (r) => r.length > 0)} fallback={() => <span style={Muted}>Not shown.</span>}>
      {() => (
        // made again when a representation's type changes (its form is another), or it is shown or hidden
        <For each={reprs} by={(r) => `${r.ref}:${r.type}:${r.visible}`}>
          {(r) => {
            const form = area.representationForm(r.ref);
            if (!form) return <span style={Muted}>{r.label}</span>;
            let timer: ReturnType<typeof setTimeout> | undefined;
            onCleanup(() => clearTimeout(timer));
            const model = new ParamsFormModel(form.params, form.values, {
              onChange: (values) => {
                clearTimeout(timer);
                timer = setTimeout(() => void api.run('particles.update', { node: r.ref, params: values }), 150);
              },
            });
            return (
              <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
                <div style={Line}>
                  <Button
                    size="xs"
                    variant="ghost"
                    title="Show or hide"
                    icon={<Icon name={r.visible ? 'eye' : 'eye-off'} />}
                    onClick={() =>
                      void api.run('explorer.representationVisibility', { node: r.ref, visible: !r.visible })
                    }
                  />
                  <span style={Muted}>{r.label}</span>
                </div>
                <ParamsForm form={model} />
              </div>
            );
          }}
        </For>
      )}
    </Show>
  );
}

// --- meshes ----------------------------------------------------------------------------------------------------------

function MeshLook(props: { api: ViewerApi; node: NodeRef }) {
  const cryoet = props.api.cryoet;
  if (!cryoet) return <span style={Muted}>The cryo-ET extension is not loaded.</span>;
  const list = cryoet.meshesState();
  const ref = props.node.ref;
  return (
    <For each={mapState(list, (l) => l.filter((m) => m.ref === ref).slice(0, 1))} by={(m) => m.ref}>
      {(m) => <MeshControls area={cryoet} mesh={m} list={list} />}
    </For>
  );
}
