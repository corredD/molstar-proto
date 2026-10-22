/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { Decorations, MeshControls, Slice } from '@molstar/cryoet-extension/controls';
import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { ClipControls, cutIndexOf, cutsFor, GraphicsMode, Motion } from '@molstar/mesoscale-extension/controls';
import { startDrag } from '@molstar/stage-tools-extension/drag';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import {
  Button,
  ColorPicker,
  For,
  Icon,
  onCleanup,
  openContextMenu,
  ParamsForm,
  Select,
  Show,
  TextInput,
} from '@molstar/prism-ui';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { JSX } from '@molstar/prism-ui/dom/jsx-runtime';
import { clipItems, clippable, clipsWhole, showClipHandles } from './menu.js';
import type { ExplorerApi, NodeRef, RepresentationInfo } from './operations.js';
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
  /** A representation's row: its state ref */
  readonly representation?: string;
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
        <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
          {picked.kind === 'label' && api.stage
            ? mapState(api.stage.labelsState(), (l) => l.find((x) => x.ref === node?.ref)?.text ?? picked.label)
            : picked.label}
        </strong>
        <span style={Muted}>{picked.kind}</span>
      </div>
      {node ? sectionsOf(api, area, picked, node, props.parts) : null}
      {node && clippable(picked.kind, node) ? (
        <Section title="Clips">{() => <Clips api={api} area={area} kind={picked.kind} node={node} />}</Section>
      ) : null}
    </div>
  );
}

function sectionsOf(
  api: ViewerApi,
  area: ExplorerApi,
  picked: Picked,
  node: NodeRef,
  parts: ReadonlyState<Parts>,
): JSX.Element[] {
  const kind = picked.kind;
  if ('particles' in node || kind === 'mesoscale model') {
    if (kind === 'target')
      return [<Section title="Decoration">{() => <ListDecoration api={api} node={node} />}</Section>];
    const out = [<Section title="Look">{() => <ParticleLook api={api} node={node} parts={parts} />}</Section>];
    if (kind === 'mesoscale model') {
      out.push(
        <Section title="Representation">
          {() => <Representations api={api} area={area} owner={node.ref} operation="particles.update" />}
        </Section>,
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
        <Section title="Representation">
          {() => <Representations api={api} area={area} owner={node.ref} operation="particles.update" />}
        </Section>,
      ];
    // a volume: each of its slices (x, y, z) and its isosurfaces; a slice's row, that slice (its position and window,
    // then its whole form); another's, its own form
    case 'volume':
      return [
        <VolumeSlices api={api} volume={node.ref} />,
        <Section title="Isosurface">
          {() => (
            <Representations
              api={api}
              area={area}
              owner={node.ref}
              operation="volume.update"
              only={(r) => r.type !== 'slice'}
              none={() => (
                <Button
                  size="sm"
                  onClick={() => void api.run('volume.representation', { type: 'isosurface', volume: node.ref })}
                >
                  Add an isosurface
                </Button>
              )}
            />
          )}
        </Section>,
      ];
    case 'slice': {
      // its axis: the slice of this representation
      const axis = api.cryoet?.sliceState(node.ref).value?.slices.find((x) => x.ref === picked.representation)?.axis;
      return [
        ...(api.cryoet && axis
          ? [<Section title="Slice">{() => <Slice area={api.cryoet!} volume={node.ref} axis={axis} />}</Section>]
          : []),
        <Section title="Representation">
          {() => (
            <Representations
              api={api}
              area={area}
              owner={node.ref}
              operation="volume.update"
              only={(r) => r.ref === picked.representation}
            />
          )}
        </Section>,
      ];
    }
    case 'isosurface':
    case 'volume representation':
      return [
        <Section title={kind === 'isosurface' ? 'Isosurface' : 'Representation'}>
          {() => (
            <Representations
              api={api}
              area={area}
              owner={node.ref}
              operation="volume.update"
              only={(r) => r.ref === picked.representation}
            />
          )}
        </Section>,
      ];
    case 'mesh':
      return [<Section title="Look">{() => <MeshLook api={api} node={node} />}</Section>];
    case 'label':
      return [<Section title="Label">{() => <LabelProps api={api} node={node} />}</Section>];
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
function ColorField(props: {
  value: ReadonlyState<number | undefined>;
  none: string;
  onPick(color: string): void;
  /** Its name ('Color') */
  label?: string;
}) {
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
        <span style={Label}>{props.label ?? 'Color'}</span>
        <button
          type="button"
          aria-label={`Pick a ${(props.label ?? 'color').toLowerCase()}`}
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

/**
 * A size over decades (a label's: an atom's to a cell's): the slider goes by powers of ten, a field takes any value;
 * it acts once released or entered
 */
function LogSliderField(props: {
  label: string;
  value: ReadonlyState<number>;
  min: number;
  max: number;
  unit: string;
  onCommit(v: number): void;
}) {
  const shown = observableState(props.value.value);
  const sub = props.value.subscribe((v) => shown.set(v));
  onCleanup(() => sub.unsubscribe());
  const round = (v: number) => Number(v.toPrecision(v < 10 ? 2 : 3));
  return (
    <div style={Line}>
      <span style={Label}>{props.label}</span>
      <input
        type="range"
        min={String(Math.log10(props.min))}
        max={String(Math.log10(props.max))}
        step="0.01"
        style="flex: 1; min-width: 0"
        aria-label={props.label}
        value={mapState(shown.asReadonly, (v) => String(Math.log10(Math.max(props.min, v))))}
        onInput={(e) => shown.set(round(10 ** Number((e.target as HTMLInputElement).value)))}
        onChange={(e) => props.onCommit(round(10 ** Number((e.target as HTMLInputElement).value)))}
      />
      <input
        type="number"
        min="0.1"
        step="any"
        style="width: 64px"
        aria-label={`${props.label} (${props.unit})`}
        value={mapState(shown.asReadonly, (v) => String(round(v)))}
        onChange={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (v > 0) props.onCommit(v);
        }}
      />
      <span style={Muted}>{props.unit}</span>
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
 * The representations of a particle list or a volume (`owner`; those `only` keeps), each with its eye and whole form
 * (the type: spheres, orientation, the targets; isosurface…, then its params), as Prism's inspector shows one; a change
 * runs `operation` a moment after the last (sliders change at pointer rate)
 */
function Representations(props: {
  api: ViewerApi;
  area: ExplorerApi;
  owner: string;
  operation: 'particles.update' | 'volume.update';
  only?: (r: RepresentationInfo) => boolean;
  none?: () => JSX.Element;
}) {
  const { api, area } = props;
  const all = area.representationsState(props.owner);
  const reprs = mapState(all, (rs) => (props.only ? rs.filter(props.only) : rs));
  return (
    <Show
      when={mapState(reprs, (r) => r.length > 0)}
      fallback={() => (props.none ? props.none() : <span style={Muted}>Not shown.</span>)}
    >
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
                timer = setTimeout(() => void api.run(props.operation, { node: r.ref, params: values }), 150);
              },
            });
            // the type's own params open (the iso level, the spheres' size): what is changed most
            model.fold('/type#params', true);
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

/** A volume's slices, a section each (Slice X, Y, Z: position and window), and the three at a click if some are missing */
function VolumeSlices(props: { api: ViewerApi; volume: string }) {
  const cryoet = props.api.cryoet;
  if (!cryoet) return <span />;
  const info = cryoet.sliceState(props.volume);
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <For each={mapState(info, (i) => i?.slices.map((x) => x.axis) ?? [])} by={(a) => a}>
        {(axis) => (
          <Section title={`Slice ${axis.toUpperCase()}`}>
            {() => <Slice area={cryoet} volume={props.volume} axis={axis} />}
          </Section>
        )}
      </For>
      <Show when={mapState(info, (i) => (i?.slices.length ?? 0) < 3)}>
        {() => (
          <Button size="sm" onClick={() => void cryoet.slices({ volume: props.volume, isosurface: true } as never)}>
            Show the three slices
          </Button>
        )}
      </Show>
    </div>
  );
}

// --- labels ----------------------------------------------------------------------------------------------------------

/** A label's text (changed as typed, a moment after the last key), size, color; remove */
function LabelProps(props: { api: ViewerApi; node: NodeRef }) {
  const { api } = props;
  const stage = api.stage;
  if (!stage) return <span style={Muted}>The stage tools are not loaded.</span>;
  const ref = props.node.ref;
  const label = mapState(stage.labelsState(), (l) => l.find((x) => x.ref === ref));
  const edit = (values: Record<string, unknown>) => void api.run('stage.editLabel', { label: ref, ...values });
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const text = (value: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => edit({ text: value }), 400);
  };
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      <div style={Line}>
        <span style={Label}>Text</span>
        <div style="flex: 1">
          <TextInput
            size="sm"
            aria-label="The label's text"
            value={mapState(label, (l) => l?.text ?? '')}
            onInput={text}
            onSubmit={(v) => {
              clearTimeout(timer);
              edit({ text: v });
            }}
          />
        </div>
      </div>
      <LogSliderField
        label="Size"
        value={mapState(label, (l) => l?.size ?? 4)}
        min={0.5}
        max={5000}
        unit="Å"
        onCommit={(size) => edit({ size })}
      />
      <ColorField value={mapState(label, (l) => l?.color)} none="white" onPick={(color) => edit({ color })} />
      <div style={Line}>
        <span style={Label}>Plate</span>
        <Button
          size="sm"
          variant="ghost"
          pressed={mapState(label, (l) => !!l?.background)}
          onClick={() => edit({ background: !label.value?.background })}
        >
          {mapState(label, (l) => (l?.background ? 'Shown' : 'Hidden'))}
        </Button>
      </div>
      <Show when={mapState(label, (l) => !!l?.background)}>
        {() => (
          <>
            <ColorField
              label="Plate color"
              value={mapState(label, (l) => l?.backgroundColor)}
              none="dark"
              onPick={(color) => edit({ backgroundColor: color })}
            />
            <SliderField
              label="Opacity"
              value={mapState(label, (l) => l?.backgroundOpacity ?? 0.7)}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onCommit={(backgroundOpacity) => edit({ backgroundOpacity })}
            />
          </>
        )}
      </Show>
      <div style={Line}>
        <span style={Label}>Tether</span>
        <Button
          size="sm"
          variant="ghost"
          pressed={mapState(label, (l) => !!l?.tether)}
          onClick={() => edit({ tether: !label.value?.tether })}
        >
          {mapState(label, (l) => (l?.tether ? 'On' : 'Off'))}
        </Button>
      </div>
      <Show when={mapState(label, (l) => !!l?.tether)}>
        {() => (
          <SliderField
            label="Length"
            value={mapState(label, (l) => l?.tetherLength ?? 1)}
            min={0.1}
            max={10}
            step={0.1}
            format={(v) => `${Math.round(v * 10) / 10}×`}
            onCommit={(tetherLength) => edit({ tetherLength })}
          />
        )}
      </Show>
      <div style={Line}>
        <span style={Label} />
        <Button size="sm" variant="ghost" icon={<Icon name="x" />} onClick={() => edit({ remove: true })}>
          Remove the label
        </Button>
      </div>
    </div>
  );
}

// --- clips -----------------------------------------------------------------------------------------------------------

const ClipNames: Record<string, string> = {
  plane: 'Plane',
  sphere: 'Sphere',
  cube: 'Box',
  cylinder: 'Cylinder',
  infiniteCone: 'Cone',
};

/**
 * The clips at a node's level, each: its name, its guide's eye, remove; moved, turned or sized in 3D (a drag on the
 * canvas, one step); a part's clip also its type, invert and placement by sliders
 */
function Clips(props: { api: ViewerApi; area: ExplorerApi; kind: string; node: NodeRef }) {
  const { api, area, node } = props;
  const stage = api.stage;
  if (!stage) return <span style={Muted}>The stage tools are not loaded.</span>;
  const add = (e: MouseEvent) => {
    const button = e.currentTarget as HTMLElement;
    const r = button.getBoundingClientRect();
    const picked = { key: '', label: '', kind: props.kind, node };
    openContextMenu(rootOf(button), { x: r.left, y: r.bottom }, clipItems(api, picked));
  };
  const addButton = (
    <Button size="sm" icon={<Icon name="scissors" />} onClick={add}>
      Add a clip
    </Button>
  );
  // the line of one clip: its name, Move / Turn / Size in 3D, its guide's eye, remove
  const line = (
    index: () => number,
    name: ReadonlyState<string>,
    round: ReadonlyState<boolean>,
    remove: () => void,
  ) => {
    const drag = (mode: 'move' | 'rotate' | 'scale') => (e: MouseEvent) =>
      startDrag(stage, rootOf(e.currentTarget as Element), area.canvasElement(), node.ref, index(), mode);
    const shown = stage.guideShownState(node.ref, index());
    return (
      <div style={Line}>
        <strong style="flex: 1">{name}</strong>
        <Button size="xs" variant="ghost" title="Move it in 3D" icon={<Icon name="move-3d" />} onClick={drag('move')} />
        <Button
          size="xs"
          variant="ghost"
          title="Turn it in 3D"
          icon={<Icon name="rotate-ccw" />}
          onClick={drag('rotate')}
        />
        <Show when={round}>
          {() => (
            <Button
              size="xs"
              variant="ghost"
              title="Size it in 3D"
              icon={<Icon name="maximize-2" />}
              onClick={drag('scale')}
            />
          )}
        </Show>
        <Button
          size="xs"
          variant="ghost"
          title="Show or hide its shape"
          icon={
            <Show when={shown} fallback={() => <Icon name="eye-off" />}>
              {() => <Icon name="eye" />}
            </Show>
          }
          onClick={() => stage.setGuideShown(node.ref, index(), !shown.value)}
        />
        <Button size="xs" variant="ghost" title="Remove it" icon={<Icon name="x" />} onClick={remove} />
      </div>
    );
  };
  if (clipsWhole(props.kind)) return <ObjectClips api={api} area={area} node={node} add={addButton} />;
  const mesoscale = api.mesoscale;
  if (!mesoscale || !('particles' in node)) return addButton;
  const ids = node.particles.entities ?? node.particles.targets ?? [];
  const info = mesoscale.infoState(node.ref);
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <For each={mapState(info, (i) => (i ? cutsFor(i, ids).map((_, k) => k) : []))} by={(k) => k}>
        {(k) => {
          const cut = mapState(info, (i) => (i ? cutsFor(i, ids)[k] : undefined));
          return (
            <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
              {line(
                () => (info.value ? cutIndexOf(info.value, ids, k) : -1),
                mapState(cut, (c) => `${ClipNames[c?.type ?? 'plane'] ?? c?.type} ${k + 1}`),
                mapState(cut, (c) => c?.type !== 'plane'),
                () =>
                  void api.run('mesoscale.clip', {
                    particles: node.ref,
                    entities: ids.join(','),
                    type: 'none',
                    cut: k,
                  }),
              )}
              <ClipControls
                area={mesoscale}
                info={info as ReadonlyState<MesoscaleInfo>}
                entities={ids}
                selection={{ entities: ids.join(',') }}
                depth={0}
                cut={k}
              />
            </div>
          );
        }}
      </For>
      {addButton}
    </div>
  );
}

/**
 * An object's cuts, Prism's (its clipping: the cuts through its representations): each, its shape, its handles to
 * move, turn and size it in 3D, its drawing in the scene, its side, remove
 */
function ObjectClips(props: { api: ViewerApi; area: ExplorerApi; node: NodeRef; add: JSX.Element }) {
  const { api, area, node } = props;
  const clipping = api.clipping;
  const cuts = mapState(clipping.cuts, (all) =>
    all.filter((c) => c.object.tag && c.targets.some((t) => area.isUnder(t.ref, node.ref))),
  );
  const handled = derive([clipping.gizmos.shown, clipping.gizmos.handled], (shown, h) => (shown ? h : []));
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <For each={mapState(cuts, (l) => l.map((c) => c.object.tag!))} by={(tag) => tag}>
        {(tag) => {
          const cut = mapState(cuts, (l) => l.find((c) => c.object.tag === tag));
          const run = (id: string, values: Record<string, unknown>) => void api.run(id, { tag, ...values });
          const handles = derive([cut, handled], (c, h) => !!c && h.includes(c.index));
          return (
            <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
              <div style={Line}>
                <strong style="flex: 1">
                  {mapState(cut, (c) => (c ? `${ClipNames[c.object.type] ?? c.object.type} ${c.index}` : ''))}
                </strong>
                <Button
                  size="xs"
                  variant="ghost"
                  title="Its handles: move, turn and size it in 3D"
                  pressed={handles}
                  icon={<Icon name="move-3d" />}
                  onClick={() => {
                    const c = cut.value;
                    if (!c) return;
                    if (handles.value) clipping.gizmos.hide();
                    else showClipHandles(api, c.index);
                  }}
                />
                <Button
                  size="xs"
                  variant="ghost"
                  title="Show or hide its shape in the scene"
                  icon={
                    <Show when={mapState(cut, (c) => !!c?.drawing)} fallback={() => <Icon name="eye-off" />}>
                      {() => <Icon name="eye" />}
                    </Show>
                  }
                  onClick={() => run('clipping.show', { on: !cut.value?.drawing })}
                />
                <Button
                  size="xs"
                  variant="ghost"
                  title="Remove it"
                  icon={<Icon name="x" />}
                  onClick={() => run('clipping.remove', {})}
                />
              </div>
              <div style={Line}>
                <span style={Label}>Shape</span>
                <Select
                  size="sm"
                  aria-label="Its shape"
                  options={Object.entries(ClipNames) as [string, string][]}
                  value={mapState(cut, (c) => c?.object.type ?? 'plane')}
                  onChange={(shape) => shape !== cut.value?.object.type && run('clipping.update', { shape })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  pressed={mapState(cut, (c) => !!c?.object.invert)}
                  onClick={() => run('clipping.update', { invert: !cut.value?.object.invert })}
                >
                  {mapState(cut, (c) => (c?.object.type === 'plane' ? 'Other side' : 'Keep inside'))}
                </Button>
              </div>
            </div>
          );
        }}
      </For>
      {props.add}
    </div>
  );
}

/** The app's root around an element (its tokens and styles apply in it) */
function rootOf(el: Element | null): HTMLElement {
  return el?.closest<HTMLElement>('.msp-root') ?? document.body;
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
