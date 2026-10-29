/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import {
  Button,
  type Child,
  Choices,
  domView,
  For,
  Icon,
  observableState,
  ParamsForm,
  type ReadonlyState,
  SectionList,
  Select,
  ShellModel,
  type ShellViewContext,
  Show,
  Slider,
  TextInput,
} from '@molstar/prism-ui';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { derive } from '@molstar/prism-ui/reactive/state';
import { classes } from './_generated/explorer.module.css.js';
import { treeClasses } from '../explorer/tree-view.js';
import type { GroupBy, MockKind, MockNode } from './fake-scene.js';
import { CategoryThemes } from '../explorer/tree-view.js';
import { ObjectKinds } from './fake-scene.js';
import { ApertureClip, GradedClip, ShownShare } from './proposed.js';

// The picked row's properties (ui.md §4), in sections that fold, only what applies to it: Prism's `SectionList` over a
// `ShellModel` slot, each section `when` its kind; their controls Prism's shared ones (`ParamsForm` over the section's
// params, `Choices`, `Select`, `Slider`, `TextInput`, `Button`), filled with the mock's values. Nothing applies (no
// viewer): a form keeps what is typed.

const Slot = 'explorer:properties';

/** What each kind is called in the header */
const KindNames: Record<MockKind, string> = {
  category: 'Category',
  structure: 'Structure',
  entity: 'Entity',
  chain: 'Chain',
  model: 'Mesoscale model',
  group: 'Group',
  'model entity': 'Entity',
  list: 'Particle list',
  target: 'Target',
  volume: 'Volume',
  slice: 'Slice',
  isosurface: 'Isosurface',
  mesh: 'Mesh',
  clip: 'Clip',
  label: 'Label',
  distance: 'Distance',
};

const has = (...kinds: MockKind[]) => {
  const set = new Set(kinds);
  return (ctx: ShellViewContext) => set.has((ctx.subject as MockNode).kind);
};
/** Every node but what was made at one (a clip, a label, a distance: their own section) */
const node = (ctx: ShellViewContext) => !['clip', 'label', 'distance'].includes((ctx.subject as MockNode).kind);
/** What a label can be made at: a node, not a category (a category's clip cuts every object under it) */
const part = (ctx: ShellViewContext) => node(ctx) && (ctx.subject as MockNode).kind !== 'category';
const object = (ctx: ShellViewContext) => ObjectKinds.has((ctx.subject as MockNode).kind);

/** A value that does not change (the mock's) */
const fixed = <T,>(v: T): ReadonlyState<T> => observableState(v).asReadonly;

/** A form over `params`, made when its section first opens */
const form = (params: PD.Params) => () => <ParamsForm form={new ParamsFormModel(params)} />;
const view = (render: (n: MockNode) => Child) =>
  domView<ShellViewContext>(({ ctx }) => render(ctx.subject as MockNode));

const RepresentationTypes: Partial<Record<MockKind, [string, string][]>> = {
  structure: [
    ['cartoon', 'Cartoon'],
    ['spacefill', 'Spacefill'],
    ['ball-and-stick', 'Ball and stick'],
    ['surface', 'Molecular surface'],
  ],
  list: [
    ['spheres', 'Spheres'],
    ['objects', 'Decorating objects'],
  ],
  volume: [
    ['slice', 'Slice'],
    ['isosurface', 'Isosurface'],
  ],
  mesh: [
    ['surface', 'Surface'],
    ['wireframe', 'Wireframe'],
    ['both', 'Both'],
  ],
};
RepresentationTypes.entity = RepresentationTypes.structure;
RepresentationTypes.model = RepresentationTypes.list;
RepresentationTypes.isosurface = [['isosurface', 'Isosurface']];

/** `proposed`: with the cellVIEW evaluation's controls (Explorer/Proposed) */
function sections(shell: ShellModel, proposed = false) {
  shell.registerSections([
    {
      id: 'look',
      slot: Slot,
      title: 'Look',
      when: node,
      render: view((n) =>
        // a category: only its eye, for every object under it
        n.kind === 'category' ? (
          form({
            visible: PD.Boolean(n.visible !== false, { description: 'Every object under it' }),
            theme: PD.Select('object', CategoryThemes[n.key] ?? [], {
              label: 'Color theme',
              description: 'Every object under it',
            }),
          })()
        ) : (
          <div class={classes.stack}>
            {form({
              visible: PD.Boolean(n.visible !== false),
              color: PD.Color(Color(n.color ?? 0x8a8f98)),
              opacity: PD.Numeric(1, { min: 0, max: 1, step: 0.01 }),
              glow: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }),
            })()}
            {n.kind === 'model' || n.kind === 'group' ? <Button size="sm">Generate colors</Button> : null}
            {proposed && (n.kind === 'model entity' || n.kind === 'group' || n.kind === 'target') ? (
              <ShownShare node={n} />
            ) : null}
          </div>
        ),
      ),
    },
    {
      id: 'representation',
      slot: Slot,
      title: 'Representation',
      when: has('structure', 'entity', 'model', 'list', 'volume', 'isosurface', 'mesh'),
      render: view((n) => {
        const types = RepresentationTypes[n.kind]!;
        return form({
          type: PD.Select(types[0][0], types),
          size: PD.Numeric(1, { min: 0.1, max: 4, step: 0.1 }),
        })();
      }),
    },
    {
      id: 'decoration',
      slot: Slot,
      title: 'Decoration',
      when: has('list', 'target', 'model'),
      render: view(() => <Decoration />),
    },
    {
      id: 'slice',
      slot: Slot,
      title: 'Slice',
      when: has('volume', 'slice'),
      render: view(() =>
        form({
          axis: PD.Select('z', [
            ['x', 'X'],
            ['y', 'Y'],
            ['z', 'Z'],
          ]),
          position: PD.Numeric(232, { min: 0, max: 463, step: 1 }),
          contrast: PD.Interval([-3, 3], { min: -6, max: 6, step: 0.1 }),
        })(),
      ),
    },
    {
      id: 'position',
      slot: Slot,
      title: 'Position',
      when: object,
      render: view((n) => <Position node={n} />),
    },
    { id: 'clips', slot: Slot, title: 'Clips', when: node, render: view((n) => <Clips node={n} />) },
    { id: 'labels', slot: Slot, title: 'Labels', when: part, render: view((n) => <Labels node={n} />) },
    {
      id: 'graphics',
      slot: Slot,
      title: 'Graphics & Motion',
      // a structure, a model, a particle list, a volume (ui.md §4); not a mesh, not a part
      when: has('structure', 'model', 'list', 'volume'),
      render: view((n) => (
        <div class={classes.stack}>
          <Choices
            label="Quality"
            choices={['Ultra', 'Quality', 'Balanced', 'Fast'].map((q) => ({ id: q, label: q }))}
            onPick={() => {}}
          />
          {n.kind === 'volume'
            ? null
            : form({
                wiggle: PD.Boolean(false),
                tumble: PD.Boolean(false),
                amplitude: PD.Numeric(1, { min: 0, max: 10, step: 0.1 }),
              })()}
        </div>
      )),
    },
    // what was made at a node: its own section (ui.md §5: a clip's shape, invert, place, size; a label's text, size)
    {
      id: 'clip',
      slot: Slot,
      title: 'Clip',
      when: has('clip'),
      render: view((n) =>
        !proposed ? clipForm() : n.shape === 'aperture' ? <ApertureClip /> : <GradedClip shape={clipForm()} />,
      ),
    },
    { id: 'label', slot: Slot, title: 'Label', when: has('label'), render: view((n) => <LabelEdit text={n.label} />) },
    { id: 'distance', slot: Slot, title: 'Distance', when: has('distance'), render: view(() => <Distance />) },
  ]);
}

const clipForm = () =>
  form({
    shape: PD.Select('plane', [
      ['plane', 'Plane'],
      ['sphere', 'Sphere'],
      ['box', 'Box'],
    ]),
    invert: PD.Boolean(false),
    position: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
    rotation: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
    size: PD.Numeric(100, { min: 1, max: 1000, step: 1 }),
  })();

/** A list's or target's decoration (ui.md §4): what decorates each target, targets by class */
function Decoration() {
  const by = [
    { id: 'file', label: 'File', title: 'One target per file' },
    { id: 'class', label: 'Class', title: 'A target per class (rlnClassNumber)' },
    { id: 'score', label: 'Score', title: 'A target per score bin' },
  ];
  const With: [string, string][] = [
    ['spheres', 'Spheres'],
    ['o:1crn', '1CRN (in the scene)'],
    ['pdb', 'A PDB id or URL…'],
  ];
  return (
    <div class={classes.stack}>
      <Choices label="Targets" choices={by} active={fixed('class')} onPick={() => {}} />
      {['Class 1', 'Class 2'].map((t, i) => (
        <div class={classes.line}>
          <span class={classes.lineLabel}>{t}</span>
          <Select size="sm" aria-label={`${t} decorated with`} options={With} value={i ? 'spheres' : 'pdb'} />
        </div>
      ))}
    </div>
  );
}

/**
 * An object's position (ui.md Status 2026-10-21 to 10-23): its handles shown or hidden (move and turn it in 3D, one step
 * a release; one object's at a time), its place and turn by numbers on demand (the handles' twin), the handle size (every
 * handle on the canvas), a list's or model's scale
 */
function Position(props: { node: MockNode }) {
  const handles = observableState(false);
  const numbers = observableState(false);
  const scaled = props.node.kind === 'list' || props.node.kind === 'model';
  return (
    <div class={classes.stack}>
      <div class={classes.line}>
        <span class={classes.lineLabel}>Handles</span>
        <span class={treeClasses.actions}>
          <Button
            size="sm"
            icon={<Icon name="move-3d" />}
            pressed={handles.asReadonly}
            onClick={() => handles.set(!handles.value)}
          >
            {derive(handles.asReadonly, (on) => (on ? 'Hide' : 'Move and turn'))}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            title="Its place and turn, by numbers"
            pressed={numbers.asReadonly}
            icon={<Icon name="sliders-horizontal" />}
            onClick={() => numbers.set(!numbers.value)}
          />
          <OnTop />
        </span>
      </div>
      <Show when={numbers.asReadonly}>
        {() =>
          form({
            x: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
            y: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
            z: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
            turnX: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
            turnY: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
            turnZ: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
          })()
        }
      </Show>
      {form({
        handleSize: PD.Numeric(100, { min: 25, max: 400, step: 5 }, { label: 'Handle size (%)' }),
        ...(scaled ? { scale: PD.Numeric(1, { min: 0.01, max: 100, step: 0.01 }, { label: 'Scale (Å/unit)' }) } : {}),
      })()}
      <Button size="sm">Reset</Button>
    </div>
  );
}

/** Every handle on the canvas on top of the scene or in it (ui.md §4): one setting, the same in Position and Clips */
const onTop = observableState(false);
function OnTop() {
  return (
    <Button
      size="xs"
      variant="ghost"
      title="Handles on top: drawn over everything, seen and grabbed through what is in front of them"
      pressed={onTop.asReadonly}
      icon={<Icon name="layers" />}
      onClick={() => onTop.set(!onTop.value)}
    >
      On top
    </Button>
  );
}

/** A node's clips (ui.md §4, §5): each its handles (move, turn, size it in 3D), its form, Remove; Add clip (right-click) */
function Clips(props: { node: MockNode }) {
  const one = props.node.kind === 'model';
  const handles = observableState(false);
  return (
    <div class={classes.stack}>
      {one ? (
        <div class={classes.line}>
          <span class={classes.lineLabel}>Plane clip</span>
          <span class={treeClasses.actions}>
            <Button
              size="sm"
              icon={<Icon name="move-3d" />}
              pressed={handles.asReadonly}
              onClick={() => handles.set(!handles.value)}
            >
              {derive(handles.asReadonly, (on) => (on ? 'Hide handles' : 'Handles'))}
            </Button>
            <OnTop />
          </span>
        </div>
      ) : null}
      {one ? (
        clipForm()
      ) : (
        <span class={classes.hint}>
          {props.node.kind === 'category'
            ? 'No clips. Add one with the scissors: it cuts every object under it.'
            : 'No clips. Add one from the right-click.'}
        </span>
      )}
      {one ? (
        <Button size="sm" variant="ghost">
          Remove the clip
        </Button>
      ) : null}
    </div>
  );
}

/** A node's labels (ui.md §4, §5): each its text, size, Remove */
function Labels(props: { node: MockNode }) {
  return props.node.kind === 'model' ? (
    <LabelEdit text="HIV-1 capsid" remove />
  ) : (
    <span class={classes.hint}>No labels. Add one from the right-click.</span>
  );
}

function LabelEdit(props: { text: string; remove?: boolean }) {
  return (
    <div class={classes.stack}>
      <TextInput size="sm" aria-label="The label's text" value={props.text} />
      <div class={classes.line}>
        <span class={classes.lineLabel}>Size</span>
        <Slider aria-label="Size" value={fixed(12)} min={0.5} max={500} scale="log" clamp={false} />
      </div>
      {props.remove ? (
        <Button size="sm" variant="ghost">
          Remove the label
        </Button>
      ) : null}
    </div>
  );
}

/** A distance (ui.md §7): its value, its two points (a click picks the point's row), text size, line width, opacity */
function Distance() {
  const times = { format: (v: number) => String(Math.round(v * 100) / 100), unit: '×' };
  const row = (label: string, child: Child) => (
    <div class={classes.line}>
      <span class={classes.lineLabel}>{label}</span>
      {child}
    </div>
  );
  return (
    <div class={classes.stack}>
      {row('Value', <span>10.67 Å</span>)}
      {row(
        'From',
        <Button size="sm" variant="ghost">
          CYS 3 (A)
        </Button>,
      )}
      {row(
        'To',
        <Button size="sm" variant="ghost">
          THR 13 (A)
        </Button>,
      )}
      {row('Text size', <Slider aria-label="Text size" value={fixed(1)} min={0.1} max={100} scale="log" {...times} />)}
      {row(
        'Line width',
        <Slider aria-label="Line width" value={fixed(1)} min={0.1} max={100} scale="log" {...times} />,
      )}
      {row('Opacity', <Slider aria-label="Opacity" value={fixed(1)} min={0} max={1} step={0.01} />)}
    </div>
  );
}

/**
 * The properties of the picked row: its name and kind, a model's Group by above the sections (not folded, ui.md §4),
 * then its sections. Made again for each pick (the section list's subject is the node).
 */
export function Properties(props: {
  picked: ReadonlyState<MockNode | undefined>;
  groupBy: ReadonlyState<GroupBy | undefined>;
  onGroupBy(g: GroupBy): void;
  /** Sections folded at first (the app's default); else open, to see them */
  folded?: boolean;
  /** With the cellVIEW evaluation's controls (Explorer/Proposed) */
  proposed?: boolean;
}) {
  const shell = new ShellModel();
  sections(shell, props.proposed);
  return (
    <For each={derive(props.picked, (p) => (p ? [p] : []))} by={(p) => p.key}>
      {(n) => (
        <div class={classes.stack}>
          <div class={classes.title}>
            <strong class={treeClasses.label}>{n.label}</strong>
            <span class={classes.hint}>{KindNames[n.kind]}</span>
          </div>
          {n.kind === 'model' ? (
            <Choices
              label="Group by"
              choices={[
                { id: 'compartment', label: 'Compartment' },
                { id: 'function', label: 'Function' },
              ]}
              active={derive(props.groupBy, (g) => g ?? 'compartment')}
              onPick={(id) => props.onGroupBy(id as GroupBy)}
            />
          ) : null}
          <SectionList shell={shell} slot={Slot} subject={n} flat collapsed={props.folded} />
        </div>
      )}
    </For>
  );
}
