/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { type ObjectPose, placementWith, poseOf } from '@molstar/stage-tools-extension/move';
import type { LabelInfo, StageApi } from '@molstar/stage-tools-extension/operations';
import { Decorations, MeshControls, ObliqueSlice, Slice } from '@molstar/cryoet-extension/controls';
import type { CryoetApi, DecorationsInfo, TargetDecoration } from '@molstar/cryoet-extension/operations';
import { ImportColors, ObjectGraphics } from '@molstar/mesoscale-extension/controls';
import type { MesoGroupBy } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import {
  ActionFooter,
  bind,
  Button,
  type Child,
  ColorPicker,
  Choices,
  type ContextMenuItem,
  domView,
  For,
  Icon,
  onCleanup,
  openContextMenu,
  ParamsForm,
  Select,
  type ShellModel,
  type ShellViewContext,
  Show,
  Slider,
  type SliderProps,
  TextInput,
} from '@molstar/prism-ui';
import { restartable } from '@molstar/prism-ui/dom/scoped';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import type { KeyedState } from '@molstar/prism-ui/reactive/keyed-state';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { DistanceProps } from './distance-properties.js';
import { addClip, clippable, hideHandles, movable, showClipHandles, showHandles, showTheme } from './menu.js';
import type { ExplorerApi, NodeRef, RepresentationInfo } from './operations.js';
import { Hint, Line, PropertiesFrame, PropertiesSlot, propertiesClasses as classes } from './properties-view.js';
import {
  ClipShapes,
  ClipsKey,
  type ClipUse,
  categoryTheme,
  clipName,
  clipTargetsOf,
  type Parts,
  whatItCuts,
  allItCuts,
} from './rows.js';
import { CategoryThemes } from './tree-view.js';

// The properties of the row picked in the explorer's tree (_spec/ui.md §4): its name and kind, a model's Group by
// above the sections (the tree's grouping of its rows: view state), then the sections that apply on Prism's
// `SectionList` (properties-view.tsx), in ui.md §4's order: Look, Representation, Decoration, Slice, Position, Clips,
// Labels, Graphics & Motion; a clip's, a label's and a distance's own section. They act through the API as the person;
// a slider once released (one step).

/** The row picked: its key in the tree, what it is, what it stands for */
export interface Picked {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly node?: NodeRef;
  /** A representation's row: its state ref */
  readonly representation?: string;
  /** A clip's row: its cut's tag (Prism's) */
  readonly clip?: string;
}

/** What a section is given: the pick and what acts on it (the section list's subject, one per pick) */
interface Subject {
  readonly api: ViewerApi;
  readonly area: ExplorerApi;
  readonly picked: Picked;
  readonly parts: ReadonlyState<Parts>;
  /** A model's grouping as its rows show it */
  groupByOf(model: string): MesoGroupBy | undefined;
}

export function Properties(props: {
  api: ViewerApi;
  area: ExplorerApi;
  picked: ReadonlyState<Picked | undefined>;
  parts: ReadonlyState<Parts>;
  /** Each model's grouping in the tree, by ref (the explorer's view state) */
  groupings: KeyedState<string, MesoGroupBy>;
  groupByOf(model: string): MesoGroupBy | undefined;
  /** Kept by the owner for the session: the sections' open state, from pick to pick */
  shell: ShellModel;
}) {
  registerSections(props.shell);
  // made again for each pick
  return (
    <For each={mapState(props.picked, (p) => (p ? [p] : []))} by={(p) => p.key}>
      {(picked) => {
        const subject: Subject = {
          api: props.api,
          area: props.area,
          picked,
          parts: props.parts,
          groupByOf: props.groupByOf,
        };
        return (
          <PropertiesFrame
            shell={props.shell}
            name={nameOf(subject)}
            kind={picked.kind}
            subject={subject}
            above={
              picked.node && picked.kind === 'mesoscale model' ? (
                <GroupBy model={picked.node.ref} parts={props.parts} groupings={props.groupings} />
              ) : undefined
            }
            collapsed
          />
        );
      }}
    </For>
  );
}

/** A label's name is its text, a clip's its shape: as they change */
function nameOf({ api, picked }: Subject): Child {
  const ref = picked.node?.ref;
  if (picked.kind === 'label' && api.stage) {
    return mapState(api.stage.labelsState(), (l) => l.find((x) => x.ref === ref)?.text ?? picked.label);
  }
  if (picked.kind === 'clip' && picked.clip) {
    return mapState(api.clipping.cuts, (all) => {
      const c = all.find((x) => x.object.tag === picked.clip);
      return c ? clipName(c) : picked.label;
    });
  }
  return picked.label;
}

// --- the sections (ui.md §4) -------------------------------------------------------------------------------------------

/** What has particles' looks: a model, its groups and entities (a list's targets: their decoration only) */
const particled = ({ picked }: Subject) =>
  !!picked.node &&
  ('particles' in picked.node || picked.kind === 'mesoscale model') &&
  picked.kind !== 'target' &&
  picked.kind !== 'particle list';
const structural = ({ picked }: Subject) =>
  !!picked.node && !('particles' in picked.node) && ['structure', 'entity', 'chain'].includes(picked.kind);
const kinds =
  (...ks: string[]) =>
  ({ picked }: Subject) =>
    !!picked.node && ks.includes(picked.kind);

/** What was made at a node: a section of its own, not a node's */
const Made: ReadonlySet<string> = new Set(['clip', 'label', 'distance']);

/** The objects with graphics, by their row's kind, and whether they move (wiggle, tumble): a volume does not */
const GraphicsKinds: ReadonlyMap<string, boolean> = new Map([
  ['structure', true],
  ['mesoscale model', true],
  ['particle list', true],
  ['volume', false],
]);

interface Section {
  readonly id: string;
  readonly title: string;
  when(s: Subject): boolean;
  render(s: Subject): Child;
}

const Sections: readonly Section[] = [
  {
    id: 'look',
    title: 'Look',
    when: (s) =>
      (s.picked.kind === 'category' && s.picked.key !== ClipsKey) ||
      structural(s) ||
      particled(s) ||
      (s.picked.kind === 'mesh' && !!s.picked.node),
    render: (s) => {
      const { api, area, picked } = s;
      if (picked.kind === 'category') return <CategoryLook subject={s} />;
      if (picked.kind === 'mesh') return <MeshLook api={api} node={picked.node!} />;
      if (particled(s)) return <ParticleLook api={api} node={picked.node!} parts={s.parts} />;
      return <StructureLook api={api} area={area} node={picked.node!} whole={picked.kind === 'structure'} />;
    },
  },
  {
    id: 'representation',
    title: 'Representation',
    when: kinds('structure', 'mesoscale model', 'particle list', 'slice', 'oblique slice', 'volume representation'),
    render: ({ api, area, picked }) => {
      const node = picked.node!;
      if (picked.kind === 'structure') return <Representation api={api} area={area} node={node} />;
      if (picked.kind === 'mesoscale model' || picked.kind === 'particle list') {
        return <Representations api={api} area={area} owner={node.ref} operation="particles.update" />;
      }
      const only = (r: RepresentationInfo) => r.ref === picked.representation;
      const form = <Representations api={api} area={area} owner={node.ref} operation="volume.update" only={only} />;
      if (picked.kind !== 'oblique slice') return form;
      return (
        <div class={classes.stack}>
          {form}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void api.run('volume.remove', { node: picked.representation! })}
          >
            Remove the oblique slice
          </Button>
        </div>
      );
    },
  },
  {
    // a volume's isosurfaces (its slices are Slice's); an isosurface's row: its own
    id: 'isosurface',
    title: 'Isosurface',
    when: kinds('volume', 'isosurface'),
    render: ({ api, area, picked }) => {
      const node = picked.node!;
      if (picked.kind === 'isosurface') {
        return (
          <Representations
            api={api}
            area={area}
            owner={node.ref}
            operation="volume.update"
            only={(r) => r.ref === picked.representation}
          />
        );
      }
      return (
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
      );
    },
  },
  {
    // what each target is drawn as: a list's or a model's all, a part's (a target, an entity, a group) its own
    id: 'decoration',
    title: 'Decoration',
    when: (s) =>
      !!s.picked.node &&
      (['target', 'mesoscale model', 'particle list'].includes(s.picked.kind) ||
        ('particles' in s.picked.node && (s.picked.kind === 'entity' || s.picked.kind === 'group'))),
    render: ({ api, picked }) => <ListDecoration api={api} node={picked.node!} />,
  },
  {
    id: 'slice',
    title: 'Slice',
    when: (s) => {
      if (!s.api.cryoet) return false;
      if (s.picked.kind === 'volume') return true;
      return s.picked.kind === 'slice' && !!sliceAxis(s);
    },
    render: (s) => {
      const cryoet = s.api.cryoet!;
      const volume = s.picked.node!.ref;
      if (s.picked.kind === 'volume') return <VolumeSlices api={s.api} cryoet={cryoet} volume={volume} />;
      return <Slice area={cryoet} volume={volume} axis={sliceAxis(s)!} />;
    },
  },
  {
    // its place (its handle, its numbers in the volume's frame) and contrast
    id: 'oblique',
    title: 'Oblique slice',
    when: (s) => s.picked.kind === 'oblique slice' && !!s.api.cryoet && !!s.picked.node,
    render: ({ api, picked }) => (
      <ObliqueSlice api={api} area={api.cryoet!} volume={picked.node!.ref} slice={picked.representation!} />
    ),
  },
  {
    id: 'position',
    title: 'Position',
    when: ({ picked }) => !!picked.node && movable(picked.kind),
    render: ({ api, area, picked }) => <Position api={api} area={area} kind={picked.kind} node={picked.node!} />,
  },
  {
    id: 'clips',
    title: 'Clips',
    when: ({ picked }) => picked.kind === 'category' || clippable(picked.kind, picked.node),
    render: (s) => (s.picked.kind === 'category' ? <CategoryClips subject={s} /> : <Clips subject={s} />),
  },
  {
    // the labels made at this node (ui.md §4): not at a category, nor at what was made at a node
    id: 'labels',
    title: 'Labels',
    when: ({ api, picked }) => !!api.stage && !!picked.node && picked.kind !== 'category' && !Made.has(picked.kind),
    render: ({ api, picked }) => <Labels api={api} stage={api.stage!} at={picked.key} />,
  },
  {
    id: 'graphics',
    title: 'Graphics & Motion',
    when: ({ api, picked }) => !!api.mesoscale && !!picked.node && GraphicsKinds.has(picked.kind),
    render: ({ api, picked }) => (
      <ObjectGraphics area={api.mesoscale!} object={picked.node!.ref} motion={GraphicsKinds.get(picked.kind)!} />
    ),
  },
  {
    id: 'clip',
    title: 'Clip',
    when: ({ picked }) => picked.kind === 'clip' && !!picked.clip,
    render: (s) => <ClipProperties subject={s} />,
  },
  {
    id: 'label',
    title: 'Label',
    when: ({ api, picked }) => picked.kind === 'label' && !!api.stage && !!picked.node,
    render: ({ api, picked }) => {
      const ref = picked.node!.ref;
      const label = mapState(api.stage!.labelsState(), (l) => l.find((x) => x.ref === ref));
      return <LabelFields api={api} label={label} labelRef={ref} full />;
    },
  },
  {
    id: 'distance',
    title: 'Distance',
    when: ({ picked }) => picked.kind === 'distance' && !!picked.node,
    render: ({ api, area, picked }) => <DistanceProps api={api} area={area} node={picked.node!} />,
  },
];

/** The shells whose sections are registered (once each: the owner keeps one for the session) */
const Registered = new WeakSet<ShellModel>();

function registerSections(shell: ShellModel) {
  if (Registered.has(shell)) return;
  Registered.add(shell);
  shell.registerSections(
    Sections.map((s) => ({
      id: s.id,
      slot: PropertiesSlot,
      title: s.title,
      when: (ctx: ShellViewContext) => s.when(ctx.subject as Subject),
      render: domView<ShellViewContext>(({ ctx }) => s.render(ctx.subject as Subject)),
    })),
  );
}

/** A slice row's axis: the slice of its representation */
function sliceAxis({ api, picked }: Subject) {
  if (!picked.node) return undefined;
  return api.cryoet?.sliceState(picked.node.ref).value?.slices.find((x) => x.ref === picked.representation)?.axis;
}

/**
 * A model's grouping in the tree: by compartment or by function, shown when it has compartments (_spec/ui.md §4). Its
 * narrowest sources: whether the model has compartments (a boolean of its own info), and the model's key of the
 * explorer's groupings for the choice (none set: by compartment, the default of a model with compartments).
 */
function GroupBy(props: { model: string; parts: ReadonlyState<Parts>; groupings: KeyedState<string, MesoGroupBy> }) {
  const hasCompartments = mapState(
    props.parts,
    (p) => !!(p.get(props.model) as MesoscaleInfo | undefined)?.hasCompartments,
  );
  return (
    <Show when={hasCompartments}>
      {() => (
        <Choices
          label="Group by"
          choices={[
            { id: 'compartment', label: 'Compartment' },
            { id: 'function', label: 'Function' },
          ]}
          active={mapState(props.groupings.key(props.model), (g) => g ?? 'compartment')}
          onPick={(id) => props.groupings.set(props.model, id as MesoGroupBy)}
        />
      )}
    </Show>
  );
}

// --- shared fields -----------------------------------------------------------------------------------------------------

/**
 * A color: Prism's color row (`ParamsForm`'s: the swatch, the channels, its `ColorPicker` under it). `value` undefined:
 * no color of its own (a theme's, mixed): said in words, not a white swatch, until the person picks one. The picker
 * changes as it is dragged across: one call a moment after the last (one step).
 */
function ColorField(props: {
  value: ReadonlyState<number | undefined>;
  /** What it shows without a color of its own ("Its representation's") */
  none: string;
  onPick(color: string): void;
  /** Its name ('Color') */
  label?: string;
}) {
  const label = props.label ?? 'Color';
  const form = new ParamsFormModel({ color: PD.Color(Color(0xffffff), { label }) }, undefined, {
    onChange: () => apply.start(150),
  });
  const apply = lastWrite(() => props.onPick(Color.toHexStyle(form.values.value.color)));
  const picking = observableState(false);
  // a color of its own shown; none again (a reset, an undo): said so, the person's picking over
  bind(props.value, (c) => (c === undefined ? picking.set(false) : form.load({ color: Color(c) })));
  return (
    <Show
      when={derive([props.value, picking.asReadonly], (c, p) => c !== undefined || p)}
      fallback={() => (
        <Line label={label}>
          <Button size="sm" variant="ghost" class={classes.fit} onClick={() => picking.set(true)}>
            {`${props.none} · pick one`}
          </Button>
        </Line>
      )}
    >
      {() => <ParamsForm form={form} />}
    </Show>
  );
}

/**
 * A slider in a line, Prism's (ParamsForm's) with its label: its value is what the node shows (`undefined`: mixed); it
 * acts once released or typed, `onPreview` as it goes. A size over decades (a label's: an atom's to a cell's) is
 * `scale: 'log'`, its box taking any value (`clamp: false`)
 */
function SliderField(props: SliderProps & { label: string }) {
  const { label, ...slider } = props;
  return (
    <Line label={label}>
      <Slider aria-label={label} {...slider} />
    </Line>
  );
}

/**
 * A write a moment after the last change (a field typed, a picker or a slider dragged: the scope's `restartable`), made
 * at once if the view goes first (another row picked, the panel closed), so what was typed is not lost
 */
function lastWrite(write: () => unknown) {
  let pending = false;
  const timer = restartable(() => {
    pending = false;
    void write();
  });
  onCleanup(() => {
    if (!pending) return;
    pending = false;
    void write();
  });
  return {
    start(ms: number) {
      pending = true;
      timer.start(ms);
    },
    cancel() {
      pending = false;
      timer.cancel();
    },
  };
}

/** A fraction shown as a percent: the box reads and takes 50 for 0.5 */
const Percent = {
  format: (v: number) => String(Math.round(v * 100)),
  // "50", "50%", "0,5" (a comma as the decimal point)
  parse: (text: string) => Number.parseFloat(text.replace(',', '.')) / 100,
  unit: '%',
} as const;

/** A place or a turn: to a tenth */
const tenths = (v: number) => String(Math.round(v * 10) / 10);

// --- a category (ui.md §3, §4) -------------------------------------------------------------------------------------------

/**
 * A category's Look: its eye for every object under it, and a color theme for all of them, the themes its kind takes
 * (`mesoscale.theme`, one step; as its row's brush); Uniform picks its color in Prism's picker, applied once
 */
function CategoryLook(props: { subject: Subject }) {
  const { api, area, picked, groupByOf } = props.subject;
  // the objects under it now (one loaded or removed while it stays picked too), its key's category (`c:<id>`)
  const category = picked.key.slice(2);
  const under = mapState(area.objectsState(), (os) => os.filter((o) => o.category === category));
  const shown = mapState(under, (os) => os.some((o) => o.visible));
  const refs = () => under.value.map((o) => o.ref);
  const form = new ParamsFormModel(
    { visible: PD.Boolean(true, { label: 'Visible', description: 'Every object under it' }) },
    undefined,
    {
      onChange: ({ visible }) =>
        void api.run('state.visibility', {
          node: refs()
            .map((r) => `#${r}`)
            .join(', '),
          visible,
        }),
    },
  );
  bind(shown, (visible) => form.load({ visible }));
  const uniform = observableState(false);
  const color = observableState(0xffffff);
  return (
    <div class={classes.stack}>
      <ParamsForm form={form} />
      <Choices
        label="Color theme"
        choices={(CategoryThemes[picked.key] ?? []).map(([id, label]) => ({ id, label }))}
        onPick={(theme) =>
          theme === 'uniform' ? uniform.set(!uniform.value) : void categoryTheme(api, refs(), theme, groupByOf)
        }
      />
      <Show when={uniform.asReadonly}>
        {() => (
          <div class={classes.inline}>
            <ColorPicker value={color.asReadonly} onChange={(c) => color.set(c)} />
            <ActionFooter
              icon="palette"
              label="Apply"
              onApply={() => {
                void categoryTheme(api, refs(), 'uniform', groupByOf, color.value);
                uniform.set(false);
              }}
            />
          </div>
        )}
      </Show>
    </div>
  );
}

/**
 * A category's Clips: a new clip of every object in it, or one of the scene used on all of them (one step each); the
 * Clips category's: where its clips are
 */
function CategoryClips(props: { subject: Subject }) {
  const { api, area, picked } = props.subject;
  if (picked.key === ClipsKey) return <Hint>Every clip of the scene. Pick one to see what it cuts.</Hint>;
  const category = picked.key.slice(2);
  const objects = mapState(area.objectsState(), (os) => os.filter((o) => o.category === category).map((o) => o.ref));
  const clips = mapState(api.clipping.cuts, (all) =>
    all.filter((c) => !!c.object.tag).map((c) => [c.object.tag!, clipName(c)] as const),
  );
  return (
    <div class={classes.stack}>
      <Hint>A clip made or used here cuts every object in it.</Hint>
      <Line label="New clip">
        <AddSelect
          label="A new clip that cuts every object in it"
          placeholder="Its shape…"
          options={NewClipOptions}
          onPick={(shape) =>
            void api.run('clipping.add', { shape, node: objects.value.map((r) => `#${r}`).join(', ') }).then((r) => {
              const cut = (r as { value?: { index: number } }).value;
              if (r.ok && cut) showClipHandles(api, cut.index);
            })
          }
        />
      </Line>
      <Line label="Use a clip">
        <AddSelect
          label="A clip of the scene, used on every object in it"
          placeholder="A clip of the scene…"
          options={clips}
          onPick={(tag) =>
            void api.run('explorer.clipUse', { tag, nodes: objects.value.map((ref) => ({ ref })), on: true })
          }
        />
      </Line>
    </div>
  );
}

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
    <div class={classes.tight}>
      <ColorField
        value={mapState(look, (l) => l?.color)}
        none="Its representation's"
        onPick={(color) => void api.run('representation.color', { ...at(), color })}
      />
      {props.whole ? (
        <Line>
          <Select
            size="sm"
            aria-label="Color by"
            options={Themes}
            value=""
            onChange={(theme) => theme && void api.run('representation.color', { ...at(), theme })}
          />
        </Line>
      ) : null}
      <SliderField
        label="Opacity"
        value={mapState(look, (l) => 1 - (l?.transparency ?? 0))}
        min={0}
        max={1}
        step={0.01}
        {...Percent}
        onCommit={(v) => void api.run('representation.transparency', { ...at(), alpha: 1 - v })}
      />
      <SliderField
        label="Glow"
        value={mapState(look, (l) => l?.emissive ?? 0)}
        min={0}
        max={1}
        step={0.01}
        {...Percent}
        onCommit={(strength) => void api.run('representation.emissive', { ...at(), strength })}
      />
      {props.whole ? (
        <Line>
          <Button
            size="sm"
            variant="ghost"
            class={classes.fit}
            onClick={() => void api.run('representation.reset', { layer: 'all', structure: node.ref })}
          >
            Reset colors, opacity and glow
          </Button>
        </Line>
      ) : null}
    </div>
  );
}

function Representation(props: { api: ViewerApi; area: ExplorerApi; node: NodeRef }) {
  const { api, area, node } = props;
  return (
    <Line label="Preset">
      <Select
        size="sm"
        aria-label="Representation preset"
        options={[['', 'Apply a preset…'], ...area.presets(node.ref)]}
        value=""
        onChange={(preset) => preset && void api.run('structure.preset', { preset, structure: node.ref })}
      />
    </Line>
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
  const wanted = ids ? new Set(ids) : undefined;
  const entities = mapState(props.parts, (p) => {
    const info = p.get(node.ref) as MesoscaleInfo | undefined;
    const all = info?.entities ?? [];
    return wanted ? all.filter((e) => wanted.has(e.id)) : all;
  });
  const selection = ids ? { entities: ids.join(',') } : {};
  const style = (patch: Record<string, unknown>) =>
    void api.run('mesoscale.style', { particles: node.ref, ...selection, ...patch });
  return (
    <div class={classes.tight}>
      <ColorField
        value={mapState(entities, (es) => common(es.map((e) => e.color as number | undefined)))}
        none={ids && ids.length === 1 ? 'The color theme’s' : 'Mixed'}
        onPick={(color) => style({ color })}
      />
      <SliderField
        label="Opacity"
        value={mapState(entities, (es) => common(es.map((e) => 1 - (e.transparency ?? 0))))}
        min={0}
        max={1}
        step={0.01}
        {...Percent}
        onCommit={(v) => style({ transparency: 1 - v })}
      />
      <SliderField
        label="Glow"
        value={mapState(entities, (es) => common(es.map((e) => e.emissive ?? 0)))}
        min={0}
        max={1}
        step={0.01}
        {...Percent}
        onCommit={(emissive) => style({ emissive })}
      />
      {!ids || ids.length > 1 ? (
        <div class={classes.tools}>
          <Button
            size="sm"
            icon={<Icon name="palette" />}
            onClick={() => {
              // a hue per group as the tree groups them
              const groupBy = (props.parts.value.get(node.ref) as MesoscaleInfo | undefined)?.groupBy;
              void api.run('mesoscale.colors', {
                scheme: 'generate',
                particles: node.ref,
                ...(groupBy ? { groupBy } : {}),
                ...selection,
              });
            }}
          >
            Generate colors
          </Button>
          <Button size="sm" variant="ghost" onClick={() => style({ reset: true })}>
            Reset
          </Button>
          {!ids && api.mesoscale ? <ImportColors area={api.mesoscale} particles={node.ref} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What decorates a list's targets: all of them for the list or model; a part's (a target, an entity, a group of
 * entities) only its own targets' rows
 */
function ListDecoration(props: { api: ViewerApi; node: NodeRef }) {
  const cryoet = props.api.cryoet;
  if (!cryoet) return <Hint>The cryo-ET extension is not loaded.</Hint>;
  const info = cryoet.decorationsState(props.node.ref);
  const part = 'particles' in props.node ? props.node.particles : undefined;
  const targets = part?.targets ? new Set(part.targets) : undefined;
  const entities = part?.entities ? new Set(part.entities) : undefined;
  const only = part
    ? (t: TargetDecoration) => !!targets?.has(t.id) || (t.entity !== undefined && !!entities?.has(t.entity))
    : undefined;
  return (
    <Show when={mapState(info, (i) => !!i)}>
      {() => <Decorations area={cryoet} info={info as ReadonlyState<DecorationsInfo>} {...(only ? { only } : {})} />}
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
  none?: () => Child;
}) {
  const { api, area } = props;
  const all = area.representationsState(props.owner);
  const reprs = mapState(all, (rs) => (props.only ? rs.filter(props.only) : rs));
  const list = (
    <Show
      when={mapState(reprs, (r) => r.length > 0)}
      fallback={() => (props.none ? props.none() : <Hint>Not shown.</Hint>)}
    >
      {() => (
        // made again when a representation's type changes (its form is another), or it is shown or hidden
        <For each={reprs} by={(r) => `${r.ref}:${r.type}:${r.visible}`}>
          {(r) => {
            const form = area.representationForm(r.ref);
            if (!form) return <Hint>{r.label}</Hint>;
            // a list's color theme changed: the colors set in Look (painted over it) cleared, so it shows
            let theme = JSON.stringify((form.values as { colorTheme?: unknown }).colorTheme);
            const update = lastWrite(async () => {
              const values = model.values.value;
              await api.run(props.operation, { node: r.ref, params: values });
              const next = JSON.stringify((values as { colorTheme?: unknown }).colorTheme);
              if (props.operation === 'particles.update' && next !== theme) await showTheme(api, props.owner);
              theme = next;
            });
            const model = new ParamsFormModel(form.params, form.values, { onChange: () => update.start(150) });
            // the type's own params open (the iso level, the spheres' size): what is changed most
            model.fold('/type#params', true);
            return (
              <div class={classes.tight}>
                <div class={classes.tools}>
                  <Button
                    size="xs"
                    variant="ghost"
                    title="Show or hide"
                    icon={<Icon name={r.visible ? 'eye' : 'eye-off'} />}
                    onClick={() =>
                      void api.run('explorer.representationVisibility', { node: r.ref, visible: !r.visible })
                    }
                  />
                  <span class={classes.itemName}>{r.label}</span>
                  {props.operation === 'particles.update' ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      title="Remove this representation"
                      icon={<Icon name="x" />}
                      onClick={() => void api.run('particles.remove', { node: `#${r.ref}` })}
                    />
                  ) : null}
                </div>
                <ParamsForm form={model} />
              </div>
            );
          }}
        </For>
      )}
    </Show>
  );
  if (props.operation !== 'particles.update') return list;
  return (
    <div class={classes.stack}>
      {list}
      <AddParticleRepresentation api={api} area={area} list={props.owner} present={all} />
    </div>
  );
}

/**
 * Adds a representation to a particle list (Prism's `particles.representation`, one of a type): spheres, axes, the
 * decorations' objects, …; and the default spheres and axes at once when both are gone
 */
function AddParticleRepresentation(props: {
  api: ViewerApi;
  area: ExplorerApi;
  list: string;
  present: ReadonlyState<readonly RepresentationInfo[]>;
}) {
  const { api, area, list } = props;
  const add = (type: string) => api.run('particles.representation', { type, particles: list });
  const open = (e: MouseEvent) => {
    const button = e.currentTarget as HTMLElement;
    const r = button.getBoundingClientRect();
    const present = new Set(props.present.value.map((x) => x.type));
    const missing = area.particleTypes(list).filter((t) => !present.has(t.type));
    const items: ContextMenuItem[] = missing.map((t) => ({
      id: `add-${t.type}`,
      label: t.label,
      run: () => void add(t.type),
    }));
    if (!present.has('spacefill') && !present.has('orientation') && missing.some((t) => t.type === 'orientation')) {
      items.unshift({
        id: 'add-defaults',
        label: 'Spheres and axes',
        run: () => void add('spacefill').then(() => add('orientation')),
      });
    }
    if (!items.length)
      items.push({ id: 'none', label: 'Nothing to add', disabled: 'Every kind is shown already', run: () => {} });
    openContextMenu(rootOf(button), { x: r.left, y: r.bottom }, items);
  };
  return (
    <Button size="sm" icon={<Icon name="plus" />} onClick={open}>
      Add a representation
    </Button>
  );
}

// --- volumes ---------------------------------------------------------------------------------------------------------

/** A new oblique slice through the volume's middle, its handle shown on it */
async function addOblique(api: ViewerApi, cryoet: CryoetApi, volume: string) {
  const r = await api.run('cryoet.oblique', { volume });
  const slice = r.ok ? (r.value as { slice?: string } | undefined)?.slice : undefined;
  if (!slice) return;
  hideHandles(api);
  cryoet.useObliqueHandles(api).show({ volume, slice });
}

/**
 * A volume's slices, each a block in its Slice section (Slice X, Y, Z: position and window; its oblique slices: place
 * and contrast), the three at a click if some are missing, a new oblique one
 */
function VolumeSlices(props: { api: ViewerApi; cryoet: CryoetApi; volume: string }) {
  const { api, cryoet, volume } = props;
  const info = cryoet.sliceState(volume);
  return (
    <div class={classes.stack}>
      <For each={mapState(info, (i) => i?.slices.map((x) => x.axis) ?? [])} by={(a) => a}>
        {(axis) => (
          <div class={classes.tight}>
            <span class={classes.itemName}>{`Slice ${axis.toUpperCase()}`}</span>
            <Slice area={cryoet} volume={volume} axis={axis} />
          </div>
        )}
      </For>
      <Show when={mapState(info, (i) => (i?.slices.length ?? 0) < 3)}>
        {() => (
          <Button size="sm" onClick={() => void api.run('cryoet.slices', { volume, isosurface: true })}>
            Show the three slices
          </Button>
        )}
      </Show>
      <For each={mapState(info, (i) => i?.obliques.map((o) => o.ref) ?? [])} by={(r) => r}>
        {(slice) => (
          <div class={classes.tight}>
            <span class={classes.itemName}>Oblique slice</span>
            <ObliqueSlice api={api} area={cryoet} volume={volume} slice={slice} />
          </div>
        )}
      </For>
      <Button size="sm" variant="ghost" onClick={() => void addOblique(api, cryoet, volume)}>
        Add an oblique slice
      </Button>
    </div>
  );
}

// --- labels ----------------------------------------------------------------------------------------------------------

/** The labels made at a node (its row's key), each: its text, size, remove (ui.md §4) */
function Labels(props: { api: ViewerApi; stage: StageApi; at: string }) {
  const all = props.stage.labelsState();
  // indexed once a change (each label's fields read by ref)
  const byRef = mapState(all, (ls) => new Map(ls.map((l) => [l.ref, l])));
  const refs = mapState(all, (ls) => ls.filter((l) => l.node === props.at).map((l) => l.ref));
  return (
    <div class={classes.stack}>
      <For each={refs} by={(r) => r}>
        {(ref) => <LabelFields api={props.api} label={mapState(byRef, (m) => m.get(ref))} labelRef={ref} />}
      </For>
      <Show when={mapState(refs, (r) => r.length === 0)}>
        {() => <Hint>No labels. Add one from the right-click.</Hint>}
      </Show>
    </div>
  );
}

/**
 * A label's text (changed as typed, a moment after the last key; Enter at once), size, remove; `full` (its own row's
 * section): its color, its plate and its tether too
 */
function LabelFields(props: {
  api: ViewerApi;
  label: ReadonlyState<LabelInfo | undefined>;
  labelRef: string;
  full?: boolean;
}) {
  const { api, label } = props;
  const edit = (values: Record<string, unknown>) =>
    void api.run('stage.editLabel', { label: props.labelRef, ...values });
  let typed = '';
  const typing = lastWrite(() => edit({ text: typed }));
  return (
    <div class={classes.tight}>
      <Line label="Text">
        <TextInput
          size="sm"
          aria-label="The label's text"
          value={mapState(label, (l) => l?.text ?? '')}
          onInput={(v) => {
            typed = v;
            typing.start(400);
          }}
          onSubmit={(v) => {
            typing.cancel();
            edit({ text: v });
          }}
        />
      </Line>
      <SliderField
        label="Size"
        value={mapState(label, (l) => l?.size ?? 4)}
        min={0.5}
        max={5000}
        scale="log"
        clamp={false}
        unit="Å"
        onCommit={(size) => edit({ size })}
      />
      {props.full ? <LabelLook label={label} edit={edit} /> : null}
      <Line>
        <Button
          size="sm"
          variant="ghost"
          class={classes.fit}
          icon={<Icon name="x" />}
          onClick={() => edit({ remove: true })}
        >
          Remove the label
        </Button>
      </Line>
    </div>
  );
}

/** A label's color, its plate (shown, its color and opacity) and its tether (on, its length) */
function LabelLook(props: {
  label: ReadonlyState<LabelInfo | undefined>;
  edit(values: Record<string, unknown>): void;
}) {
  const { label, edit } = props;
  return (
    <>
      <ColorField value={mapState(label, (l) => l?.color)} none="White" onPick={(color) => edit({ color })} />
      <Line label="Plate">
        <Button
          size="sm"
          variant="ghost"
          pressed={mapState(label, (l) => !!l?.background)}
          onClick={() => edit({ background: !label.value?.background })}
        >
          {mapState(label, (l) => (l?.background ? 'Shown' : 'Hidden'))}
        </Button>
      </Line>
      <Show when={mapState(label, (l) => !!l?.background)}>
        {() => (
          <>
            <ColorField
              label="Plate color"
              value={mapState(label, (l) => l?.backgroundColor)}
              none="Dark"
              onPick={(color) => edit({ backgroundColor: color })}
            />
            <SliderField
              label="Opacity"
              value={mapState(label, (l) => l?.backgroundOpacity ?? 0.7)}
              min={0}
              max={1}
              step={0.01}
              {...Percent}
              onCommit={(backgroundOpacity) => edit({ backgroundOpacity })}
            />
          </>
        )}
      </Show>
      <Line label="Tether">
        <Button
          size="sm"
          variant="ghost"
          pressed={mapState(label, (l) => !!l?.tether)}
          onClick={() => edit({ tether: !label.value?.tether })}
        >
          {mapState(label, (l) => (l?.tether ? 'On' : 'Off'))}
        </Button>
      </Line>
      <Show when={mapState(label, (l) => !!l?.tether)}>
        {() => (
          <SliderField
            label="Length"
            value={mapState(label, (l) => l?.tetherLength ?? 1)}
            min={0.1}
            max={10}
            step={0.1}
            unit="×"
            onCommit={(tetherLength) => edit({ tetherLength })}
          />
        )}
      </Show>
    </>
  );
}

// --- position ----------------------------------------------------------------------------------------------------------

/** An object's position: Prism's handles on it, to move and turn it in 3D (each release one step) */
function Position(props: { api: ViewerApi; area: ExplorerApi; kind: string; node: NodeRef }) {
  const { api, node } = props;
  // the six numbers of its place and turn, shown on demand (the handles' twin: both move it)
  const exact = observableState(false);
  const shownOn = derive(
    [
      api.move?.gizmos.shown ?? observableState(false).asReadonly,
      api.move?.gizmos.target ?? observableState<string | undefined>(undefined).asReadonly,
      api.stage?.moveGizmos.shown ?? observableState(false).asReadonly,
      api.stage?.moveGizmos.target ?? observableState<string | undefined>(undefined).asReadonly,
    ],
    (a, ta, b, tb) => (a && ta === node.ref) || (b && tb === node.ref),
  );
  const listed = props.kind === 'particle list' || props.kind === 'mesoscale model';
  return (
    <div class={classes.tight}>
      <Line label="Handles">
        <div class={classes.tools}>
          <Button
            size="sm"
            icon={<Icon name="move-3d" />}
            pressed={shownOn}
            onClick={() => (shownOn.value ? hideHandles(api) : showHandles(api, node.ref, props.kind))}
          >
            {mapState(shownOn, (on) => (on ? 'Hide' : 'Move and turn'))}
          </Button>
          {api.stage ? (
            <Button
              size="xs"
              variant="ghost"
              title="Its place and turn, by numbers"
              pressed={exact.asReadonly}
              icon={<Icon name="sliders-horizontal" />}
              onClick={() => exact.set(!exact.value)}
            />
          ) : null}
          <OnTop api={api} area={props.area} />
        </div>
      </Line>
      {api.stage ? (
        <Show when={exact.asReadonly}>{() => <PoseSliders stage={api.stage!} api={api} target={node.ref} />}</Show>
      ) : null}
      <HandleLook area={props.area} />
      {listed && api.stage && api.cryoet ? <LocalHandle api={api} stage={api.stage} list={node.ref} /> : null}
      {/* a particle list's positions in Å: its file's unit times this (a tomogram's pixel size) */}
      {listed && api.stage ? (
        <SliderField
          label="Scale"
          value={api.stage.scaleState(node.ref)}
          min={0.01}
          max={100}
          scale="log"
          clamp={false}
          unit="Å/unit"
          onCommit={(scale) => void api.run('stage.scale', { target: node.ref, scale })}
        />
      ) : null}
    </div>
  );
}

const PoseAxes = [
  { key: 'x', label: 'X', unit: 'Å' },
  { key: 'y', label: 'Y', unit: 'Å' },
  { key: 'z', label: 'Z', unit: 'Å' },
  { key: 'ex', label: 'Turn X', unit: '°' },
  { key: 'ey', label: 'Turn Y', unit: '°' },
  { key: 'ez', label: 'Turn Z', unit: '°' },
] as const;

/**
 * An object's place and turn by numbers, the handles' twin: where its center is (X, Y, Z, Å, within its size of where
 * it was loaded) and its Euler turn (X, then Y, then Z, °); a slider shows the object as it goes, and its release is
 * one step (`stage.pose`); the handles show the same pose
 */
function PoseSliders(props: { api: ViewerApi; stage: StageApi; target: string }) {
  const { api, stage, target } = props;
  const pose = stage.poseState(target);
  const placement = stage.placementOf(target);
  const reach = Math.max(placement?.radius ?? 100, 10) * 2;
  const home = placement ? Vec3.transformMat4(Vec3(), placement.center, placement.matrix) : Vec3();
  const valueOf = (p: ObjectPose | undefined, i: number) => (p ? (i < 3 ? p.position[i] : p.euler[i - 3]) : 0);
  const withValue = (p: ObjectPose, i: number, v: number): ObjectPose => {
    const position = [...p.position] as [number, number, number];
    const euler = [...p.euler] as [number, number, number];
    if (i < 3) position[i] = v;
    else euler[i - 3] = v;
    return { position, euler };
  };
  return (
    <div class={classes.inline}>
      {PoseAxes.map((axis, i) => {
        const min = i < 3 ? home[i] - reach : -180;
        const max = i < 3 ? home[i] + reach : 180;
        const value = mapState(pose, (p) => valueOf(p, i));
        // committed, then the drawing back to the state's (now moved): else the preview's move would stay on it
        const commit = async (v: number) => {
          await api.run('stage.pose', { target, [axis.key]: v });
          stage.previewMove(target, Mat4.identity());
        };
        return (
          <SliderField
            label={axis.label}
            value={value}
            min={min}
            max={max}
            step={i < 3 ? 'any' : 1}
            clamp={false}
            format={tenths}
            unit={axis.unit}
            onPreview={(v) => {
              const p = pose.value;
              if (p) stage.previewPose(target, withValue(p, i, v));
            }}
            onCommit={(v) => void commit(v)}
          />
        );
      })}
    </div>
  );
}

/**
 * A particle's local handle on this list, while shown (a right-click on a particle opens it): what it edits, All on (the
 * offset of its kind: every particle like it) or off (it alone), hidden; and that offset by numbers, X, Y, Z along the
 * particle's own axes and Turn X, Y, Z about them, each released one step
 */
function LocalHandle(props: { api: ViewerApi; stage: StageApi; list: string }) {
  const { api, stage, list } = props;
  const handles = stage.useParticleHandles(api);
  const here = mapState(handles.target, (t) => (t?.list === list ? t : undefined));
  return (
    <For
      each={mapState(here, (t) =>
        t ? [`${t.index}:${t.edit.kind}:${'targets' in t.edit ? t.edit.targets : ''}`] : [],
      )}
      by={(k) => k}
    >
      {() => {
        const t = here.value!;
        const all = t.edit.kind === 'offset';
        const targets = t.edit.kind === 'offset' ? t.edit.targets : '';
        const cryoet = api.cryoet!;
        const offset = all ? cryoet.offsetState(list, targets) : cryoet.instanceState(list, t.index);
        const set = (key: string, v: number) =>
          void (all
            ? api.run('cryoet.offset', { particles: list, targets, [key]: v })
            : api.run('cryoet.instance', { particles: list, index: t.index, [key]: v }));
        return (
          <div class={classes.tight}>
            <Line label="Local handle">
              <div class={classes.tools}>
                <span class={classes.itemName}>
                  {all ? `particle ${t.index}: all like it` : `particle ${t.index} alone`}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  pressed={all}
                  title="All on: the offset of every particle like it (its kind); off: this particle alone"
                  onClick={() => handles.setAll(!all)}
                >
                  All
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  title="Hide the handle"
                  icon={<Icon name="x" />}
                  onClick={() => handles.hide()}
                />
              </div>
            </Line>
            {PoseAxes.map((axis, i) => {
              const value = mapState(offset, (o) => (o ? (i < 3 ? o.translation[i] : o.euler[i - 3]) : 0));
              const range = i < 3 ? 200 : 180;
              return (
                <SliderField
                  label={axis.label}
                  aria-label={`Local ${axis.label}`}
                  value={value}
                  min={-range}
                  max={range}
                  step={i < 3 ? 0.5 : 1}
                  clamp={false}
                  format={tenths}
                  unit={axis.unit}
                  onCommit={(v) => set(axis.key, v)}
                />
              );
            })}
          </div>
        );
      }}
    </For>
  );
}

/**
 * Every handle on the canvas drawn on top of the scene, or in it (the move's and the clips' alike, one setting:
 * `canvas.handles`, no history step); the same button in Position and in each clip's line
 */
function OnTop(props: { api: ViewerApi; area: ExplorerApi }) {
  const on = mapState(props.area.handleLookState(), (l) => l.onTop);
  return (
    <Button
      size="xs"
      variant="ghost"
      title="Handles on top: drawn over everything, seen and grabbed through what is in front of them"
      pressed={on}
      icon={<Icon name="layers" />}
      onClick={() => void props.api.run('canvas.handles', { onTop: !on.value })}
    >
      On top
    </Button>
  );
}

/** How every handle on the canvas is drawn (the move's and the clips' alike): its size */
function HandleLook(props: { area: ExplorerApi }) {
  const look = props.area.handleLookState();
  return (
    <SliderField
      label="Handle size"
      value={mapState(look, (l) => l.scale)}
      min={0.25}
      max={4}
      step={0.05}
      {...Percent}
      onCommit={(scale) => props.area.setHandleLook({ scale })}
    />
  );
}

// --- clips -----------------------------------------------------------------------------------------------------------

/**
 * A node's Clips (Ludo, 2026-10-28: the clips are in their own category, pointed at from here): the clips on it (each
 * picks its row; × takes it off them, one step), New clip (a shape: it cuts this), Use a clip (one of the scene's, one
 * step); a model's or list's Clip whole, the handle size
 */
function Clips(props: { subject: Subject }) {
  const { api, area, picked, parts } = props.subject;
  const node = picked.node!;
  const objects = area.objectsState();
  // read again when what a clip cuts of a list changes (its layers), which the cuts do not compare
  const layers = area.particleLayersState();
  const on = derive([api.clipping.cuts, layers], (all) => area.cutsOf(all, node));
  const others = derive([api.clipping.cuts, on], (all, o) =>
    all.filter((c) => !!c.object.tag && !o.includes(c)).map((c) => [c.object.tag!, clipName(c)] as const),
  );
  // its × off where it is all the clip cuts (a clip cuts something: remove it instead)
  const last = (tag: string) =>
    derive([api.clipping.cuts, objects, parts, layers], (all, os, ps) => {
      const c = all.find((x) => x.object.tag === tag);
      return !!c && allItCuts(whatItCuts(area, c, os, ps), node);
    });
  // a model's or list's objects: clipped whole (proteins) or by their elements (atoms), when it draws objects
  const whole =
    (picked.kind === 'mesoscale model' || picked.kind === 'particle list') && api.stage
      ? api.stage.clipWholeState(node.ref)
      : undefined;
  return (
    <div class={classes.stack}>
      {whole ? (
        <Show when={mapState(whole, (w) => w !== undefined)}>
          {() => (
            <Choices
              label="Clip whole"
              choices={[
                {
                  id: 'instance',
                  label: 'Proteins',
                  title: 'A cut takes whole objects (proteins): one whose center is cut goes, the others stay whole',
                },
                {
                  id: 'element',
                  label: 'Atoms',
                  title: 'A cut takes whole atoms: each whose center is cut goes, the objects are carved',
                },
              ]}
              active={whole}
              onPick={(w) => void api.run('stage.clipWhole', { particles: node.ref, whole: w })}
            />
          )}
        </Show>
      ) : null}
      <Show
        when={mapState(on, (l) => l.length > 0)}
        fallback={() => <Hint>No clip on it. Make one, or use one of the scene's.</Hint>}
      >
        {() => (
          <For each={on} by={(c) => `${c.object.tag}:${clipName(c)}`}>
            {(c) => (
              <UseLine
                name={clipName(c)}
                pick="Pick the clip"
                last={last(c.object.tag!)}
                onPick={() => area.revealRow(`k:${c.object.tag}`)}
                onDrop={() => void api.run('explorer.clipUse', { tag: c.object.tag!, nodes: [node], on: false })}
              />
            )}
          </For>
        )}
      </Show>
      <Line label="New clip">
        <AddSelect
          label="A new clip that cuts it"
          placeholder="Its shape…"
          options={NewClipOptions}
          onPick={(shape) => void addClip(api, area, node, shape)}
        />
      </Line>
      <Line label="Use a clip">
        <AddSelect
          label="A clip of the scene, used on it too"
          placeholder="A clip of the scene…"
          options={others}
          onPick={(tag) => void api.run('explorer.clipUse', { tag, nodes: [node], on: true })}
        />
      </Line>
      <HandleLook area={area} />
    </div>
  );
}

/**
 * A clip's properties (Ludo, 2026-10-28): its editor (handles, numbers, On top, remove, shape, invert: PR #14), then
 * What it cuts: every object or part it is given (each picks its row; × takes it off, one step; not the last one:
 * remove the clip instead), Cut also… (one step)
 */
function ClipProperties(props: { subject: Subject }) {
  const { api, area, picked, parts } = props.subject;
  const tag = picked.clip!;
  const objects = area.objectsState();
  const cut = mapState(api.clipping.cuts, (all) => all.find((c) => c.object.tag === tag));
  // read again when what it cuts of a list changes (its layers), which the cuts do not compare
  const layers = area.particleLayersState();
  const uses = derive([cut, objects, parts, layers], (c, os, ps) => (c ? whatItCuts(area, c, os, ps) : []));
  // what it can be given more of: every object and its parts it does not cut all of
  const more = derive([cut, objects, parts, layers], (c, os, ps) => {
    if (!c) return [];
    const of = new Map(os.map((o) => [o.ref, area.cutOf(c, o.ref)] as const));
    return clipTargetsOf(os, ps)
      .filter((t) => {
        const o = of.get(t.node.ref);
        if (!o) return true;
        const isObject = !('particles' in t.node) && !('entity' in t.node);
        return isObject ? !!(o.particles || o.atoms) : !area.covers(o, t.node);
      })
      .map((t) => [t.key, t.label] as const);
  });
  const byKey = (key: string) => clipTargetsOf(objects.value, parts.value).find((t) => t.key === key);
  return (
    <div class={classes.stack}>
      <ClipEditor api={api} area={area} tag={tag} />
      <div class={classes.title}>
        <strong>What it cuts</strong>
      </div>
      <For each={uses} by={(u) => u.key}>
        {(u: ClipUse) => (
          <UseLine
            name={u.label}
            pick="Pick it in the tree"
            last={derive(uses, (l) => l.length === 1)}
            onPick={() => area.revealRow(u.key)}
            onDrop={() => void api.run('explorer.clipUse', { tag, nodes: [u.node], on: false })}
          />
        )}
      </For>
      <Line label="Cut also">
        <AddSelect
          label="An object or part this clip also cuts"
          placeholder="An object or part…"
          options={more}
          onPick={(key) => {
            const t = byKey(key);
            if (t) void api.run('explorer.clipUse', { tag, nodes: [t.node], on: true });
          }}
        />
      </Line>
    </div>
  );
}

/** An object or part a clip cuts, or a clip on a node: its name (a click picks its row), then × (no longer cut) */
function UseLine(props: {
  name: string;
  pick: string;
  last: boolean | ReadonlyState<boolean>;
  onPick(): void;
  onDrop(): void;
}) {
  const last = typeof props.last === 'boolean' ? observableState(props.last).asReadonly : props.last;
  return (
    <div class={classes.use} data-clip-use={props.name}>
      <Button size="sm" variant="ghost" class={classes.fit} title={props.pick} onClick={props.onPick}>
        {props.name}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        title={mapState(last, (l) =>
          l
            ? `No longer cut by it: ${props.name} (all the clip cuts: remove the clip instead)`
            : `No longer cut by it: ${props.name}`,
        )}
        disabled={last}
        icon={<Icon name="x" />}
        onClick={props.onDrop}
      />
    </div>
  );
}

/** Prism's cut shapes, a new clip's */
const NewClipOptions = observableState<readonly (readonly [string, string])[]>(Object.entries(ClipShapes)).asReadonly;

/** A picker that runs its choice and goes back to its placeholder (New clip, Use a clip, Cut also) */
function AddSelect(props: {
  label: string;
  placeholder: string;
  options: ReadonlyState<readonly (readonly [string, string])[]>;
  onPick(id: string): void;
}) {
  // made again when its options change, or once picked: back at its placeholder
  const again = observableState(0);
  return (
    <For
      each={derive([props.options, again.asReadonly], (o, n) => [{ o, n }])}
      by={({ o, n }) => `${n}:${o.map(([id]) => id).join()}`}
    >
      {({ o }) => (
        <Select
          size="sm"
          aria-label={props.label}
          options={[['', props.placeholder], ...o] as [string, string][]}
          value=""
          onChange={(id) => {
            if (!id) return;
            again.set(again.value + 1);
            props.onPick(id);
          }}
        />
      )}
    </For>
  );
}

/** Prism's cut shapes, a clip's Shape */
const ShapeOptions = Object.entries(ClipShapes) as [string, string][];

/**
 * A clip (Prism's cut, by its tag): its line (its handles shown or hidden, its numbers' toggle, On top, remove), its
 * shape and invert (Prism's `clipping.update`, one step each; ui.md §4, Ludo 2026-10-25), and its place, turn and size
 * by numbers on demand: the head of a clip row's own section
 */
function ClipEditor(props: { api: ViewerApi; area: ExplorerApi; tag: string }) {
  const { api, area, tag } = props;
  const clipping = api.clipping;
  const cut = mapState(clipping.cuts, (all) => all.find((c) => c.object.tag === tag));
  const handled = derive([clipping.gizmos.shown, clipping.gizmos.handled], (shown, h) => (shown ? h : []));
  const handles = derive([cut, handled], (c, h) => !!c && h.includes(c.index));
  // its place, turn and size by numbers, shown on demand (view state, by the clip; the handles' twin)
  const exact = observableState(false);
  const fields = new ParamsFormModel(
    {
      shape: PD.Select<string>('plane', ShapeOptions, { label: 'Shape' }),
      invert: PD.Boolean(false, { label: 'Invert', description: 'Remove the other side, or the outside' }),
    },
    undefined,
    { onChange: (values, changed) => void api.run('clipping.update', { tag, [changed]: values[changed] }) },
  );
  bind(cut, (c) => c && fields.load({ shape: c.object.type, invert: !!c.object.invert }));
  return (
    <div class={classes.tight}>
      <div class={classes.tools}>
        <Button
          size="xs"
          variant="ghost"
          title="Show or hide its handles (move, turn and size it in 3D)"
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
          title="Its place, turn and size, by numbers"
          pressed={exact.asReadonly}
          icon={<Icon name="sliders-horizontal" />}
          onClick={() => exact.set(!exact.value)}
        />
        <OnTop api={api} area={area} />
        <Button
          size="xs"
          variant="ghost"
          title="Remove it"
          icon={<Icon name="x" />}
          onClick={() => void api.run('clipping.remove', { tag })}
        />
      </div>
      <ParamsForm form={fields} />
      <Show when={exact.asReadonly}>
        {() => (
          // made again for another shape: its sizes are another's
          <For each={mapState(cut, (c) => (c ? [c.object.type] : []))} by={(t) => t}>
            {() => <ClipSliders api={api} tag={tag} cut={cut} />}
          </For>
        )}
      </Show>
    </div>
  );
}

type ClipCut = ViewerApi['clipping']['cuts']['value'][number];
type ClipObject = ClipCut['object'];

// scratch for the turn's conversions (a slider's preview runs them every frame)
const TurnQuat = Quat();
const TurnMat = Mat4();
const TurnAxis = Vec3();
const TurnOrigin = Vec3();
const TurnIdentity = Mat4.identity();
const Deg = 180 / Math.PI;

/**
 * A clip's turn as Euler angles (degrees: X, then Y, then Z), into `out`, and back to its axis and angle: by the stage
 * tools' `poseOf` and `placementWith`, so it reads as Position's Turn does. Y reads in −90…90: a turn typed past it
 * reads back as its equal, X and Z flipped by 180°.
 */
function eulerOf(o: ClipObject, out: number[] = [0, 0, 0]): number[] {
  Vec3.normalize(TurnAxis, o.rotation.axis);
  Mat4.fromRotation(TurnMat, o.rotation.angle / Deg, TurnAxis);
  const e = poseOf({ matrix: TurnMat, center: TurnOrigin }).euler;
  out[0] = e[0];
  out[1] = e[1];
  out[2] = e[2];
  return out;
}
function rotationWith(euler: readonly number[]): ClipObject['rotation'] {
  const m = placementWith(
    { matrix: TurnIdentity, center: TurnOrigin },
    { position: [0, 0, 0], euler: [euler[0], euler[1], euler[2]] },
  );
  Quat.normalize(TurnQuat, Quat.fromMat4(TurnQuat, m));
  const rad = Quat.getAxisAngle(TurnAxis, TurnQuat);
  if (!Number.isFinite(rad) || Vec3.magnitude(TurnAxis) < 1e-9) return { axis: Vec3.create(1, 0, 0), angle: 0 };
  return { axis: Vec3.normalize(Vec3(), TurnAxis), angle: rad * Deg };
}
const TurnRead = [0, 0, 0];

interface ClipNumber {
  readonly label: string;
  readonly unit: string;
  /** What it changes (`clipping.update`'s field) */
  readonly field: 'position' | 'rotation' | 'scale';
  read(o: ClipObject): number;
  write(o: ClipObject, v: number): ClipObject;
  min(o: ClipObject): number;
  max(o: ClipObject): number;
  readonly log?: boolean;
}

/**
 * A clip's numbers: X, Y, Z (its center, Å, within reach of what it cuts), Turn X, Y, Z (°), and its shape's size
 * (a sphere's diameter, a box's edges, a cylinder's diameter and height, a cone's half-angle; a plane has none)
 */
function clipNumbers(shape: string, center: Vec3, reach: number, cone: ViewerApi['clipping']['cone']): ClipNumber[] {
  const out: ClipNumber[] = [];
  ['X', 'Y', 'Z'].forEach((label, i) =>
    out.push({
      label,
      unit: 'Å',
      field: 'position',
      read: (o) => o.position[i],
      write: (o, v) => {
        const position = Vec3.clone(o.position);
        position[i] = v;
        return { ...o, position };
      },
      min: () => center[i] - reach,
      max: () => center[i] + reach,
    }),
  );
  ['Turn X', 'Turn Y', 'Turn Z'].forEach((label, i) =>
    out.push({
      label,
      unit: '°',
      field: 'rotation',
      read: (o) => eulerOf(o, TurnRead)[i],
      write: (o, v) => {
        const euler = eulerOf(o, TurnRead);
        euler[i] = v;
        return { ...o, rotation: rotationWith(euler) };
      },
      min: () => -180,
      max: () => 180,
    }),
  );
  const size = (label: string, read: (s: Vec3) => number, write: (s: Vec3, v: number) => Vec3): ClipNumber => ({
    label,
    unit: 'Å',
    field: 'scale',
    read: (o) => read(o.scale),
    write: (o, v) => ({ ...o, scale: write(o.scale, v) }),
    min: () => 0.1,
    max: (o) => Math.max(reach * 2, read(o.scale) * 2),
    log: true,
  });
  switch (shape) {
    case 'sphere':
      out.push(
        size(
          'Diameter',
          (s) => s[0],
          (_, v) => Vec3.create(v, v, v),
        ),
      );
      break;
    case 'cube':
      ['Size X', 'Size Y', 'Size Z'].forEach((label, i) =>
        out.push(
          size(
            label,
            (s) => s[i],
            (s, v) => {
              const next = Vec3.clone(s);
              next[i] = v;
              return next;
            },
          ),
        ),
      );
      break;
    case 'cylinder':
      out.push(
        size(
          'Diameter',
          (s) => s[0],
          (s, v) => Vec3.create(v, s[1], v),
        ),
      );
      out.push(
        size(
          'Height',
          (s) => s[1],
          (s, v) => Vec3.create(s[0], v, s[2]),
        ),
      );
      break;
    case 'infiniteCone':
      out.push({
        label: 'Half-angle',
        unit: '°',
        field: 'scale',
        read: (o) => cone.angle(o.scale),
        write: (o, v) => ({ ...o, scale: cone.scale(v) }),
        min: () => 1,
        max: () => 89,
      });
      break;
  }
  return out;
}

/**
 * A clip's place, turn and size by numbers, the handles' twin: a slider shows the cut as it goes on what it cuts
 * (`clipping.previewCut`, outside the state), and its release is one step (`clipping.update`, by its tag)
 */
function ClipSliders(props: { api: ViewerApi; tag: string; cut: ReadonlyState<ClipCut | undefined> }) {
  const { api, tag, cut } = props;
  const clipping = api.clipping;
  const first = cut.value;
  if (!first) return null;
  // the reach of its X, Y, Z: around what it cuts, as it was when opened (a slider's range stays put while it goes)
  const bounds = clipping.boundsOf(first);
  const center = bounds ? Vec3.clone(bounds.center) : Vec3.clone(first.object.position);
  const reach = Math.max(bounds?.radius ?? 50, 10) * 1.5;
  const numbers = clipNumbers(first.object.type, center, reach, clipping.cone);
  // the last preview of these sliders: ended at its release, or when they go (the row removed, folded, the clip gone)
  let previewed: number | undefined;
  onCleanup(() => {
    if (previewed !== undefined) clipping.endPreview(previewed);
  });
  return (
    <div class={classes.inline}>
      {numbers.map((n) => {
        const value = mapState(cut, (c) => (c ? n.read(c.object) : 0));
        const commit = async (v: number) => {
          const token = previewed;
          previewed = undefined;
          try {
            const c = cut.value;
            if (!c) return;
            const next = n.write(c.object, v);
            const values =
              n.field === 'position'
                ? { position: [...next.position] }
                : n.field === 'rotation'
                  ? { rotation: { axis: [...next.rotation.axis], angle: next.rotation.angle } }
                  : { scale: [...next.scale] };
            await api.run('clipping.update', { tag, ...values });
          } finally {
            // the drawing back to the state's (now changed), unless another gesture began meanwhile
            if (token !== undefined) clipping.endPreview(token);
          }
        };
        return (
          <SliderField
            label={n.label}
            value={value}
            min={n.min(first.object)}
            max={n.max(first.object)}
            step={n.unit === '°' ? 1 : 'any'}
            scale={n.log ? 'log' : 'linear'}
            clamp={false}
            format={tenths}
            unit={n.unit}
            onPreview={(v) => {
              const c = cut.value;
              if (c) previewed = clipping.previewCut(c.object, n.write(c.object, v));
            }}
            onCommit={(v) => void commit(v)}
          />
        );
      })}
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
  if (!cryoet) return <Hint>The cryo-ET extension is not loaded.</Hint>;
  const list = cryoet.meshesState();
  const ref = props.node.ref;
  return (
    <For each={mapState(list, (l) => l.filter((m) => m.ref === ref).slice(0, 1))} by={(m) => m.ref}>
      {(m) => <MeshControls area={cryoet} mesh={m} list={list} />}
    </For>
  );
}
