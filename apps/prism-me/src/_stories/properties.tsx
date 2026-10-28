/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import {
  ActionFooter,
  Button,
  type Child,
  Choices,
  ColorPicker,
  domView,
  For,
  Icon,
  observableState,
  ParamsForm,
  type ReadonlyState,
  Select,
  ShellModel,
  type ShellViewContext,
  Show,
  Slider,
  TextInput,
} from '@molstar/prism-ui';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { derive } from '@molstar/prism-ui/reactive/state';
import {
  Hint,
  Line,
  PropertiesFrame,
  PropertiesSlot as Slot,
  propertiesClasses as classes,
} from '../explorer/properties-view.js';
import type { GroupBy, MockKind, MockNode } from './fake-scene.js';
import { CategoryThemes } from '../explorer/tree-view.js';
import { ObjectKinds } from './fake-scene.js';

// The picked row's properties (ui.md §4), in sections that fold, only what applies to it: the app's frame
// (explorer/properties-view.tsx: the header, Prism's `SectionList`), each section `when` its kind; their controls
// Prism's shared ones (`ParamsForm` over the section's params, `Choices`, `Select`, `Slider`, `TextInput`, `Button`,
// `ColorPicker`), filled with the mock's values. Nothing applies (no viewer): a form keeps what is typed.

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

/** A list's or a model's representations: their type (the app: each its whole form) */
const ParticleTypes: [string, string][] = [
  ['spheres', 'Spheres'],
  ['objects', 'Decorating objects'],
];

function sections(shell: ShellModel) {
  shell.registerSections([
    {
      id: 'look',
      slot: Slot,
      title: 'Look',
      // as the app: what has a look of its own (a volume's is its slices' and isosurfaces', a list's its targets')
      when: has('category', 'structure', 'entity', 'chain', 'model', 'group', 'model entity', 'mesh'),
      render: view((n) =>
        // a category: its eye and a color theme, for every object under it; a mesh: its look's own controls
        n.kind === 'category' ? (
          <CategoryLook node={n} />
        ) : n.kind === 'mesh' ? (
          <MeshLook />
        ) : (
          <div class={classes.stack}>
            {form({
              color: PD.Color(Color(n.color ?? 0x8a8f98)),
              opacity: PD.Numeric(1, { min: 0, max: 1, step: 0.01 }),
              glow: PD.Numeric(0, { min: 0, max: 1, step: 0.01 }),
            })()}
            {n.kind === 'model' || n.kind === 'group' ? <Button size="sm">Generate colors</Button> : null}
          </div>
        ),
      ),
    },
    {
      id: 'representation',
      slot: Slot,
      title: 'Representation',
      // as the app: a structure's preset; a model's, a list's, a slice's representations
      when: has('structure', 'model', 'list', 'slice'),
      render: view((n) =>
        n.kind === 'structure' ? (
          <Line label="Preset">
            <Select size="sm" aria-label="Representation preset" options={[['', 'Apply a preset…']]} value="" />
          </Line>
        ) : (
          form({
            type: PD.Select(
              n.kind === 'slice' ? 'slice' : 'spheres',
              n.kind === 'slice' ? [['slice', 'Slice']] : ParticleTypes,
            ),
            size: PD.Numeric(1, { min: 0.1, max: 4, step: 0.1 }),
          })()
        ),
      ),
    },
    {
      // a volume's isosurfaces (its slices are Slice's); an isosurface's row: its own
      id: 'isosurface',
      slot: Slot,
      title: 'Isosurface',
      when: has('volume', 'isosurface'),
      render: view(() =>
        form({ level: PD.Numeric(1.5, { min: -3, max: 6, step: 0.1 }, { label: 'Iso level (σ)' }) })(),
      ),
    },
    {
      id: 'decoration',
      slot: Slot,
      title: 'Decoration',
      when: has('list', 'target', 'model', 'group', 'model entity'),
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
    {
      id: 'clips',
      slot: Slot,
      title: 'Clips',
      // as the app: not a volume's slice or isosurface (they are cut with their volume)
      when: (ctx) => node(ctx) && !['slice', 'isosurface'].includes((ctx.subject as MockNode).kind),
      render: view((n) => <Clips node={n} />),
    },
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
    { id: 'clip', slot: Slot, title: 'Clip', when: has('clip'), render: view(() => <Clip />) },
    {
      id: 'label',
      slot: Slot,
      title: 'Label',
      when: has('label'),
      render: view((n) => <LabelEdit text={n.label} full />),
    },
    { id: 'distance', slot: Slot, title: 'Distance', when: has('distance'), render: view(() => <Distance />) },
  ]);
}

/** A mesh's Look (the app's cryo-ET MeshControls): its color, surface, wireframe or both, opacity, scale */
function MeshLook() {
  return (
    <div class={classes.stack}>
      {form({ color: PD.Color(Color(0xb58bd6)) })()}
      <Choices
        choices={[
          { id: 'mesh', label: 'Surface' },
          { id: 'wireframe', label: 'Wireframe' },
          { id: 'both', label: 'Both' },
        ]}
        active={fixed('mesh')}
        onPick={() => {}}
      />
      {form({
        opacity: PD.Numeric(1, { min: 0.05, max: 1, step: 0.01 }),
        scale: PD.Numeric(1, { min: 0.01, max: 100, step: 0.01 }),
      })()}
    </div>
  );
}

/** A category's Look (ui.md §4): its eye and a color theme for every object under it; Uniform's color picked, applied */
function CategoryLook(props: { node: MockNode }) {
  const uniform = observableState(false);
  const color = observableState(0xffffff);
  return (
    <div class={classes.stack}>
      {form({ visible: PD.Boolean(props.node.visible !== false, { description: 'Every object under it' }) })()}
      <Choices
        label="Color theme"
        choices={(CategoryThemes[props.node.key] ?? []).map(([id, label]) => ({ id, label }))}
        onPick={(id) => id === 'uniform' && uniform.set(!uniform.value)}
      />
      <Show when={uniform.asReadonly}>
        {() => (
          <div class={classes.inline}>
            <ColorPicker value={color.asReadonly} onChange={(c) => color.set(c)} />
            <ActionFooter icon="palette" label="Apply" onApply={() => uniform.set(false)} />
          </div>
        )}
      </Show>
    </div>
  );
}

/**
 * A clip (ui.md §4, §5): its line (its handles, its numbers' toggle, On top, remove), its shape and invert, its place,
 * turn and size by numbers on demand; the same in a node's Clips and the clip row's own section
 */
function Clip(props: { name?: string }) {
  const handles = observableState(false);
  const numbers = observableState(false);
  return (
    <div class={classes.tight}>
      <div class={classes.tools}>
        {props.name ? <span class={classes.itemName}>{props.name}</span> : null}
        <Button
          size="xs"
          variant="ghost"
          title="Show or hide its handles (move, turn and size it in 3D)"
          pressed={handles.asReadonly}
          icon={<Icon name="move-3d" />}
          onClick={() => handles.set(!handles.value)}
        />
        <Button
          size="xs"
          variant="ghost"
          title="Its place, turn and size, by numbers"
          pressed={numbers.asReadonly}
          icon={<Icon name="sliders-horizontal" />}
          onClick={() => numbers.set(!numbers.value)}
        />
        <OnTop />
        <Button size="xs" variant="ghost" title="Remove it" icon={<Icon name="x" />} />
      </div>
      {form({
        shape: PD.Select('plane', [
          ['plane', 'Plane'],
          ['sphere', 'Sphere'],
          ['cube', 'Box'],
          ['cylinder', 'Cylinder'],
          ['infiniteCone', 'Cone'],
        ]),
        invert: PD.Boolean(false, { description: 'Remove the other side, or the outside' }),
      })()}
      <Show when={numbers.asReadonly}>
        {() => (
          <div class={classes.inline}>
            {form({
              x: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
              y: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
              z: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
              turnX: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
              turnY: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
              turnZ: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
            })()}
          </div>
        )}
      </Show>
    </div>
  );
}

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
        <Line label={t}>
          <Select size="sm" aria-label={`${t} decorated with`} options={With} value={i ? 'spheres' : 'pdb'} />
        </Line>
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
    <div class={classes.tight}>
      <Line label="Handles">
        <div class={classes.tools}>
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
        </div>
      </Line>
      <Show when={numbers.asReadonly}>
        {() => (
          <div class={classes.inline}>
            {form({
              x: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
              y: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
              z: PD.Numeric(0, { min: -500, max: 500, step: 0.1 }),
              turnX: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
              turnY: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
              turnZ: PD.Numeric(0, { min: -180, max: 180, step: 1 }),
            })()}
          </div>
        )}
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

/**
 * A node's clips (ui.md §4, §5): each as a clip row's (`Clip`); Add a clip, the handle size. A category's: the cuts its
 * scissors made, each of every object under it
 */
function Clips(props: { node: MockNode }) {
  if (props.node.kind === 'category') {
    return <Hint>No clips. Add one with the scissors: it cuts every object under it.</Hint>;
  }
  return (
    <div class={classes.stack}>
      {props.node.kind === 'model' ? <Clip name="Plane 1" /> : null}
      <Button size="sm" icon={<Icon name="scissors" />}>
        Add a clip
      </Button>
      {form({ handleSize: PD.Numeric(100, { min: 25, max: 400, step: 5 }, { label: 'Handle size (%)' }) })()}
    </div>
  );
}

/** A node's labels (ui.md §4, §5): each its text, size, Remove */
function Labels(props: { node: MockNode }) {
  return props.node.kind === 'model' ? (
    <LabelEdit text="HIV-1 capsid" />
  ) : (
    <Hint>No labels. Add one from the right-click.</Hint>
  );
}

/** A label's text, size, remove; `full` (its own row's section): its color, plate and tether too */
function LabelEdit(props: { text: string; full?: boolean }) {
  return (
    <div class={classes.tight}>
      <Line label="Text">
        <TextInput size="sm" aria-label="The label's text" value={props.text} />
      </Line>
      <Line label="Size">
        <Slider aria-label="Size" value={fixed(12)} min={0.5} max={500} scale="log" clamp={false} unit="Å" />
      </Line>
      {props.full ? form({ color: PD.Color(Color(0xffffff)) })() : null}
      {props.full ? (
        <Line label="Plate">
          <Button size="sm" variant="ghost">
            Hidden
          </Button>
        </Line>
      ) : null}
      {props.full ? (
        <Line label="Tether">
          <Button size="sm" variant="ghost">
            Off
          </Button>
        </Line>
      ) : null}
      <Line>
        <Button size="sm" variant="ghost" icon={<Icon name="x" />}>
          Remove the label
        </Button>
      </Line>
    </div>
  );
}

/** A distance (ui.md §7): its value, its two points (a click picks the point's row), text size, line width, opacity */
function Distance() {
  const times = { format: (v: number) => String(Math.round(v * 100) / 100), unit: '×' };
  return (
    <div class={classes.tight}>
      <Line label="Value">
        <span>10.67 Å</span>
      </Line>
      <Line label="From">
        <Button size="sm" variant="ghost">
          CYS 3 (A)
        </Button>
      </Line>
      <Line label="To">
        <Button size="sm" variant="ghost">
          THR 13 (A)
        </Button>
      </Line>
      <Line label="Text size">
        <Slider aria-label="Text size" value={fixed(1)} min={0.1} max={100} scale="log" {...times} />
      </Line>
      <Line label="Line width">
        <Slider aria-label="Line width" value={fixed(1)} min={0.1} max={100} scale="log" {...times} />
      </Line>
      <Line label="Opacity">
        <Slider aria-label="Opacity" value={fixed(1)} min={0} max={1} step={0.01} />
      </Line>
    </div>
  );
}

/**
 * The properties of the picked row, on the app's frame (properties-view.tsx): its name and kind, a model's Group by
 * above the sections (not folded, ui.md §4), then its sections. Made again for each pick (the section list's subject
 * is the node); the shell outlives the picks, so a section stays open (or folded) as it was left.
 */
export function Properties(props: {
  picked: ReadonlyState<MockNode | undefined>;
  groupBy: ReadonlyState<GroupBy | undefined>;
  onGroupBy(g: GroupBy): void;
  /** Sections folded at first (the app's default); else open, to see them */
  folded?: boolean;
}) {
  const shell = new ShellModel();
  sections(shell);
  return (
    <For each={derive(props.picked, (p) => (p ? [p] : []))} by={(p) => p.key}>
      {(n) => (
        <PropertiesFrame
          shell={shell}
          name={n.label}
          kind={n.kind}
          subject={n}
          collapsed={props.folded}
          above={
            n.kind === 'model' ? (
              <Choices
                label="Group by"
                choices={[
                  { id: 'compartment', label: 'Compartment' },
                  { id: 'function', label: 'Function' },
                ]}
                active={derive(props.groupBy, (g) => g ?? 'compartment')}
                onPick={(id) => props.onGroupBy(id as GroupBy)}
              />
            ) : undefined
          }
        />
      )}
    </For>
  );
}
