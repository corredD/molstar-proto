/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { EmptyLoci } from '@molstar/model/model/loci';
import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import type { MesoGroupBy } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import {
  Button,
  type ContextMenuItem,
  domView,
  Icon,
  keepRows,
  onCleanup,
  openContextMenu,
  ScrollArea,
  Show,
  TextInput,
} from '@molstar/prism-ui';
import { effect, frameState } from '@molstar/prism-ui/dom/scope';
import { frames, restartable } from '@molstar/prism-ui/dom/scoped';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { type KeyedState, keyedState } from '@molstar/prism-ui/reactive/keyed-state';
import { type ObservableState, observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';
import type { Subscription } from 'rxjs';
import type { DistanceInfo, LabelInfo } from '@molstar/stage-tools-extension/operations';
import { editInline } from './inline-edit.js';
import { distancePicker, selectionModeHint } from './measure.js';
import {
  clipItems,
  clippable,
  colorable,
  colorItems,
  nodeMenuItems,
  removable,
  removeObject,
  showClipHandles,
} from './menu.js';
import type { CanvasClick, ExplorerApi, PickedNode } from './operations.js';
import { type Picked, Properties } from './properties.js';
import {
  ancestorKeys,
  Categories,
  ClipShapes,
  clipsAt,
  type Parts,
  type Row,
  rowOf,
  rowsOf,
  sameRow,
  toggleVisible,
} from './rows.js';
import {
  type At,
  EmptyTreeLine,
  SplitLine,
  TreeView,
  type TreeViewHandle,
  treeClasses as classes,
} from './tree-view.js';

// The explorer's panel (apps/prism-me/_spec/ui.md §1–4): + Open, a filter, the tree of the scene in four categories,
// and under it the properties of the row picked. Rows act through the API as the person (one step each): their eyes run
// the areas' visibility operations; a click picks a row (highlighted in 3D), a double click puts the camera on it.

/** The explorer's tab */
export const SceneTab = 'explorer.tab.scene';

export function explorerUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.explorer;
  if (!area) return {};
  const model = sceneModel(area, ctx.api.stage);
  scenes.set(area, model);
  area.setOnReveal((key) => {
    const stage = ctx.api.stage;
    const row = rowOf(
      area.objectsState().value,
      model.parts.value,
      key,
      stage?.labelsState().value,
      stage?.distancesState().value,
    );
    if (row?.node) {
      model.reveal({
        key,
        label: row.label,
        kind: row.kind,
        node: row.node,
        ...(row.representation ? { representation: row.representation } : {}),
      });
    }
  });
  // a distance by two ⌘/Ctrl+clicks in selection mode (_spec/ui.md §7); Esc, a plain click or leaving the mode lets
  // its first point go
  // a person's run is posted by the viewer already (its failures, its "already"): not twice
  const post = (text: string) => {
    const notifications = ctx.managers.notifications;
    if (notifications.current.value?.text !== text) notifications.post(text);
  };
  const picker = distancePicker(ctx.api, area, { post, reveal: model.reveal });
  area.escaped.subscribe(() => picker.cancel());
  // the tree follows a pick in 3D (a left-click): its row picked and the way to it unfolded
  // what a click is on, as the stage says (a label under the pointer first: drawn, not picked by Mol*), as a row
  // (without the stage area, what Mol* picked: no label under the pointer)
  const pickedAt = (click: CanvasClick): PickedNode | undefined =>
    ctx.api.stage ? area.pickedRow(ctx.api.stage.pickedAt(click)) : area.pickedOf(click.loci);
  area.setOnClick((click) => {
    // a distance's point: Ctrl or ⌘ + click in selection mode; else the click picks a row as any other
    if (click.measure && area.selectionMode) {
      // a label: no point of a distance, as nothing is (ui.md §7)
      void picker.click(pickedAt(click)?.kind === 'label' ? { ...click, loci: EmptyLoci } : click);
      return;
    }
    // outside it nothing measures: said, and the click picks its row as any other
    if (click.measure) post(selectionModeHint(area.mac));
    picker.cancel();
    const p = pickedAt(click);
    if (p) model.reveal(p);
  });
  // the canvas's right-click opens the explorer's menu, at the level of what it picked (the stage's own is not opened)
  const stage = ctx.api.stage;
  if (stage) {
    let close: (() => void) | undefined;
    stage.setMenu((request) => {
      close?.();
      const root = rootOf(request.anchor);
      const at = { x: request.x, y: request.y };
      const p = pickedAt(request);
      if (p) model.reveal(p);
      const items: ContextMenuItem[] = nodeMenuItems(ctx.api, area, p, {
        open: (sub) => {
          close = openContextMenu(root, at, sub);
        },
        reveal: model.reveal,
        groupBy: model.groupByOf,
        editText: (text, keep) => editInline(root, at, text, keep),
        ...(request.position ? { at: [request.position[0], request.position[1], request.position[2]] as const } : {}),
      });
      // a particle picked: its local handle, on it alone (All off) or on its kind's offset (All on)
      const particle = area.particleOf(request.loci);
      const handles = stage.useParticleHandles(ctx.api);
      if (particle) {
        const kind = area.particleKind(particle.list, particle.index);
        const local: ContextMenuItem[] = [
          {
            id: 'move-instance',
            label: 'Move this instance (handle)',
            icon: 'move-3d',
            run: () => void handles.show({ ...particle, edit: { kind: 'instance' } }),
          },
          {
            id: 'offset-kind',
            label: 'Offset all like it (handle)',
            icon: 'move-3d',
            run: () => void handles.show({ ...particle, edit: { kind: 'offset', targets: kind } }),
          },
        ];
        // the part's own move is not there: these are
        items.splice(0, items.length, ...local, ...items.filter((i) => i.id !== 'move'));
      }
      close = openContextMenu(root, { x: request.x, y: request.y }, items);
    }, true);
  }
  return {
    tabs: [
      {
        id: SceneTab,
        title: 'Scene',
        icon: 'list-tree',
        order: 0,
        render: domView(() => <ScenePanel ctx={ctx} area={area} model={model} />),
      },
    ],
  };
}

/** The tree's state of each explorer area (its viewer's): for tests */
const scenes = new WeakMap<ExplorerApi, SceneModel>();
export const sceneModelOf = (area: ExplorerApi): SceneModel | undefined => scenes.get(area);

/** The tree's state, kept for the viewer's life (the menu and the 3D picks act on it while the panel is closed) */
export interface SceneModel {
  readonly open: ObservableState<ReadonlySet<string>>;
  readonly filter: ObservableState<string>;
  readonly picked: ObservableState<Picked | undefined>;
  readonly parts: ObservableState<Parts>;
  /**
   * Each model's grouping by its ref, picked in its properties (none: the default one): view state, no operation, no
   * history step (_spec/ui.md §4). Its read follows its own key only, so a switch remakes that model's rows alone.
   */
  readonly groupings: KeyedState<string, MesoGroupBy>;
  /** The row to bring into view (a pick in 3D) */
  readonly scrollTo: ObservableState<string | undefined>;
  /** Picks a node's row, unfolding the way to it */
  reveal(p: PickedNode): void;
  /** A model's grouping as its rows show it (its info's), for what acts on its groups */
  groupByOf(model: string): MesoGroupBy | undefined;
}

function sceneModel(area: ExplorerApi, stage: ViewerApi['stage']): SceneModel {
  const open = observableState<ReadonlySet<string>>(new Set(Categories.map((c) => `c:${c.id}`)));
  const picked = observableState<Picked | undefined>(undefined);
  const parts = observableState<Parts>(new Map());
  const groupings = keyedState<string, MesoGroupBy>();
  const scrollTo = observableState<string | undefined>(undefined);
  return {
    open,
    filter: observableState(''),
    picked,
    parts,
    groupings,
    scrollTo,
    groupByOf: (ref) => (parts.value.get(ref) as MesoscaleInfo | undefined)?.groupBy,
    reveal(p) {
      const labels = stage?.labelsState().value ?? [];
      const distances = stage?.distancesState().value ?? [];
      const above = ancestorKeys(area.objectsState().value, parts.value, p.key, labels, distances) ?? [];
      if (above.some((k) => !open.value.has(k))) open.set(new Set([...open.value, ...above]));
      picked.set(p);
      scrollTo.set(p.key);
    },
  };
}

/** The person's picked row */
function ScenePanel(props: { ctx: ViewerUIContext; area: ExplorerApi; model: SceneModel }) {
  const { ctx, area, model } = props;
  const api = ctx.api;
  const objects = area.objectsState();
  // the parts of particle models and lists, from the mesoscale and cryo-ET areas (one read per object, kept while shown)
  const parts = model.parts;
  const partStates = new Map<string, { state: ReadonlyState<unknown>; sub: Subscription }>();
  const objectsSub = objects.subscribe((list) => {
    const wanted = new Set(list.filter((o) => o.category === 'particles').map((o) => o.ref));
    for (const [ref, { sub }] of partStates) {
      if (wanted.has(ref)) continue;
      sub.unsubscribe();
      partStates.delete(ref);
    }
    // what the model keeps of an object gone (its parts, its grouping), also of one gone while the panel was not
    // shown: a ref used again starts afresh
    const gone = [...parts.value.keys()].filter((ref) => !wanted.has(ref));
    if (gone.length) {
      const next = new Map(parts.value);
      for (const ref of gone) next.delete(ref);
      parts.set(next);
    }
    for (const ref of [...model.groupings.values.keys()]) if (!wanted.has(ref)) model.groupings.delete(ref);
    for (const o of list) {
      if (o.category !== 'particles' || partStates.has(o.ref)) continue;
      const state: ReadonlyState<unknown> | undefined =
        o.kind === 'model'
          ? api.mesoscale?.infoState(o.ref, model.groupings.key(o.ref))
          : api.cryoet?.decorationsState(o.ref);
      if (!state) continue;
      const sub = state.subscribe((value) => {
        const next = new Map(parts.value);
        next.set(o.ref, value as MesoscaleInfo | DecorationsInfo | undefined);
        parts.set(next);
      });
      partStates.set(o.ref, { state, sub });
    }
  });
  onCleanup(() => {
    objectsSub.unsubscribe();
    for (const { sub } of partStates.values()) sub.unsubscribe();
  });

  const { open, filter, picked } = model;
  // the rows as shown, keyed: a row the same as before keeps its DOM (the window of a virtual list: a screenful)
  const keep = keepRows<Row>((r) => r.key, sameRow);
  // the stage's labels, each under the row it was made at
  const labels = api.stage?.labelsState() ?? observableState<readonly LabelInfo[]>([]).asReadonly;
  // and its distances, each under its first point's row
  const distances = api.stage?.distancesState() ?? observableState<readonly DistanceInfo[]>([]).asReadonly;
  // and Prism's cuts, each under the row it was made at
  const cuts = api.clipping?.cuts ?? observableState<ExplorerCuts>([]).asReadonly;
  const clips = derive([cuts, objects], (c, o) => clipsAt(area, c, o));
  // the rows folded while filtering (the filter opens all the others), forgotten when the filter changes
  const folded = observableState<ReadonlySet<string>>(new Set());
  effect(filter.asReadonly, () => {
    if (folded.value.size) folded.set(new Set());
  });
  const rows = derive(
    [objects, parts.asReadonly, open.asReadonly, filter.asReadonly, labels, distances, clips, folded.asReadonly],
    (o, p, op, f, l, d, k, fo) => keep(rowsOf(o, p, op, f, l, d, k, fo)),
  );
  const pickedKey = derive(picked.asReadonly, (p) => p?.key);
  // the row under the pointer: lit in 3D (the picked row's highlight comes back when it leaves)
  const hover = (row: Row | undefined) => {
    const p = picked.value;
    area.highlight(row?.node ? row.node : p && lastingHighlight(p) ? p.node : undefined);
  };
  const toggleOpen = (key: string) => {
    const set = filter.value.trim() ? folded : open;
    const next = new Set(set.value);
    if (!next.delete(key)) next.add(key);
    set.set(next);
  };
  const pickedOf = (row: Row): Picked => ({
    key: row.key,
    label: row.label,
    kind: row.kind,
    ...(row.node ? { node: row.node } : {}),
    ...(row.representation ? { representation: row.representation } : {}),
  });
  const pick = (row: Row) => {
    if (picked.value?.key !== row.key) picked.set(pickedOf(row));
    area.highlight(lastingHighlight(row) ? row.node : undefined);
  };
  onCleanup(() => area.highlight(undefined));

  // an eye flips at once; its operation runs after the frame is painted (on a large model it takes a moment), and
  // the scene says the rest: the flip is dropped a frame after (back at once if it failed)
  const shown = keyedState<string, boolean>();
  // each flip with the state it asked for, at the click (a second click before the scene says so flips it back)
  const eyes: { row: Row; visible: boolean }[] = [];
  const settled: { key: string; visible: boolean }[] = [];
  const settle = frames(() => {
    // a flip asked for since is kept
    for (const { key, visible } of settled.splice(0)) if (shown.get(key) === visible) shown.delete(key);
  });
  const runEyes = restartable(() => {
    for (const { row, visible } of eyes.splice(0)) {
      void Promise.resolve(toggleVisible(api, { ...row, visible: !visible })).then(() => {
        settled.push({ key: row.key, visible });
        settle.request();
      });
    }
  });
  const afterPaint = frames(() => runEyes.start(0));
  const eye = (row: Row) => {
    const visible = !(shown.get(row.key) ?? row.visible);
    shown.set(row.key, visible);
    eyes.push({ row, visible });
    afterPaint.request();
  };

  // menus open at the app's root (its tokens), not inside the panel (its containment would clip them)
  let panelEl: HTMLElement | undefined;
  const root = () => rootOf(panelEl);
  // a row tool (the brush, the scissors): the row picked, its menu under the button
  const tool = (row: Row, which: 'color' | 'clip', at: At, onClose: () => void) => {
    if (row.objects) {
      pick(row);
      const items =
        which === 'clip' ? categoryClipItems(api, row.objects) : categoryThemeItems(api, row.key, row.objects);
      openContextMenu(root(), at, items, onClose);
      return;
    }
    if (!row.node) return;
    pick(row);
    const p = { ...pickedOf(row), node: row.node };
    const items = which === 'color' ? colorItems(api, area, p, model.groupByOf) : clipItems(api, area, p);
    openContextMenu(root(), at, items, onClose);
  };
  // a row's right-click or ⋯: it is picked, and the menu of what it stands for opens there
  const menu = (row: Row, at: At, onClose?: () => void) => {
    if (!row.node) return;
    pick(row);
    const r = root();
    const items = nodeMenuItems(
      api,
      area,
      { ...pickedOf(row), node: row.node },
      {
        open: (sub) => openContextMenu(r, at, sub),
        reveal: model.reveal,
        groupBy: model.groupByOf,
        editText: (text, keep) => editInline(r, at, text, keep),
      },
    );
    openContextMenu(r, at, items, onClose);
  };

  // a row picked in 3D brought into view (once: the request is cleared), in the frame after its way is unfolded
  let tree: TreeViewHandle | undefined;
  const scroll = frames(() => {
    const key = model.scrollTo.value;
    if (key === undefined || !tree) return;
    tree.scrollTo(key);
    model.scrollTo.set(undefined);
  });
  effect(model.scrollTo.asReadonly, (key) => {
    if (key !== undefined) scroll.request();
  });

  // the properties' height, dragged on the line above them or moved by its arrows (tree-view.tsx)
  const height = frameState(240);

  return (
    <div class={classes.panel} ref={(el: HTMLElement) => (panelEl = el)}>
      <div class={classes.header}>
        <Button size="sm" icon={<Icon name="plus" />} onClick={(e) => openMenu(e, openItems(ctx))}>
          Open
        </Button>
        <TextInput
          search
          size="sm"
          placeholder="Filter"
          aria-label="Filter the scene"
          class={classes.filter}
          onInput={(v) => filter.set(v)}
        />
      </div>
      <Show when={mapState(objects, (o) => o.length > 0)} fallback={() => <p class={classes.empty}>{EmptyTreeLine}</p>}>
        {() => (
          <TreeView
            rows={rows}
            picked={pickedKey}
            shown={shown}
            tools={(row) => ({
              color: !!row.objects?.length || colorable(row.kind, row.node),
              clip: !!row.objects?.length || clippable(row.kind, row.node),
              remove: removable(row.kind, row.node) || Made.has(row.kind),
              more: !!row.node,
            })}
            onPick={pick}
            onToggle={(row) => toggleOpen(row.key)}
            onEye={eye}
            onRemove={(row) => void removeRow(api, area, row)}
            onTool={tool}
            onMenu={menu}
            onDblClick={(row) => row.node && area.focus(row.node)}
            onHover={hover}
            ref={(t) => (tree = t)}
          />
        )}
      </Show>
      <SplitLine height={height} panel={() => panelEl} />
      <div class={classes.properties} style={{ height: derive(height, (h) => `${h}px`) }}>
        <ScrollArea class={classes.fill} contentClass={classes.propertiesContent} edge>
          <Show
            when={mapState(picked.asReadonly, (p) => !!p)}
            fallback={() => <p class={classes.empty}>Pick a row to see its properties.</p>}
          >
            {() => (
              <Properties
                api={api}
                area={area}
                picked={picked.asReadonly}
                parts={parts.asReadonly}
                groupings={model.groupings}
              />
            )}
          </Show>
        </ScrollArea>
      </div>
    </div>
  );
}

/** A category's scissors: one cut of every object under it (Prism's, through all their representations), by shape */
function categoryClipItems(api: ViewerApi, objects: readonly string[]): ContextMenuItem[] {
  const node = objects.map((r) => `#${r}`).join(', ');
  return Object.entries(ClipShapes).map(([shape, label]) => ({
    id: `clip-${shape}`,
    label,
    run: async () => {
      const r = await api.run('clipping.add', { shape, node });
      const cut = (r as { value?: { index: number } }).value;
      if (r.ok && cut) showClipHandles(api, cut.index);
    },
  }));
}

/**
 * A category's brush: a color theme for every object under it, one step (`mesoscale.theme`, each kind by the theme it
 * takes; Ludo, 2026-10-27), the themes its kind takes (ui.md §3); no icons on menu items (styling.md §4)
 */
function categoryThemeItems(api: ViewerApi, key: string, objects: readonly string[]): ContextMenuItem[] {
  const themes = CategoryThemes[key] ?? [];
  return themes.map(([theme, label]) => ({
    id: `theme-${theme}`,
    label,
    run: () => void api.run('mesoscale.theme', { objects: [...objects], theme }),
  }));
}

/** The themes each category's objects take (`mesoscale.theme`) */
const CategoryThemes: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  'c:structures': [
    ['object', 'By object'],
    ['entity', 'By entity'],
    ['chain', 'By chain'],
    ['uniform', 'Uniform'],
  ],
  'c:particles': [
    ['object', 'By object'],
    ['entity', 'By entity'],
    ['generate', 'Generate colors'],
    ['uniform', 'Uniform'],
  ],
  'c:volumes': [
    ['object', 'By object'],
    ['uniform', 'Uniform'],
  ],
  'c:meshes': [
    ['object', 'By object'],
    ['uniform', 'Uniform'],
  ],
};

/** What was made at a node, removed by its row's trash */
const Made: ReadonlySet<string> = new Set(['clip', 'label', 'distance']);

/** A row's trash: one step, as the menu's Remove (an object with its file and labels, a clip, a label, a distance) */
function removeRow(api: ViewerApi, area: ExplorerApi, row: Row) {
  if (row.kind === 'clip' && row.clip) return api.run('clipping.remove', { tag: row.clip });
  if (!row.node) return;
  if (row.kind === 'label') return api.run('stage.editLabel', { label: row.node.ref, remove: true });
  if (row.kind === 'distance') return api.run('stage.editDistance', { distance: row.node.ref, remove: true });
  return removeObject(api, area, row.kind, row.node.ref);
}

type ExplorerCuts = ViewerApi['clipping']['cuts']['value'];

/** Whether a picked row stays lit in 3D: not a volume's (its light would cover the slice's image) */
function lastingHighlight(row: { readonly kind: string }) {
  return !['volume', 'slice', 'oblique slice', 'isosurface', 'volume representation'].includes(row.kind);
}

// --- + Open ----------------------------------------------------------------------------------------------------------

/** The app's root around an element (its tokens and styles apply in it) */
function rootOf(el: Element | undefined | null): HTMLElement {
  return el?.closest<HTMLElement>('.msp-root') ?? document.body;
}

function openMenu(e: MouseEvent, items: ContextMenuItem[]) {
  const button = e.currentTarget as HTMLElement;
  const root = rootOf(button);
  const r = button.getBoundingClientRect();
  openContextMenu(root, { x: r.left, y: r.bottom }, items);
}

function openItems(ctx: ViewerUIContext): ContextMenuItem[] {
  const pickFiles = (session: boolean) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !session;
    if (session) input.accept = '.molx,.molj';
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return;
      void (session ? ctx.api.run('session.open', { file: files[0] }) : ctx.api.run('load.files', { files }));
    };
    input.click();
  };
  // ui.md §2's words; no icons on menu items (styling.md §4)
  return [
    { id: 'files', label: 'Files…', run: () => pickFiles(false) },
    { id: 'entry', label: 'PDB / PDB-IHM / EMDB id…', run: () => void ctx.managers.commands.open('load.entry') },
    { id: 'examples', label: 'Examples…', run: () => void ctx.managers.commands.open('mesoscale.example') },
    { id: 'session', label: 'Session…', run: () => pickFiles(true) },
  ];
}
