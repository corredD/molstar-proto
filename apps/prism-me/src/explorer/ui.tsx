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
  ShellModel,
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
import { colorItems, nodeMenuItems, showClipHandles, useItems } from './menu.js';
import type { CanvasClick, ExplorerApi, PickedNode } from './operations.js';
import type { Picked } from './properties.js';
import {
  ancestorKeys,
  Categories,
  categoryTheme,
  ClipsKey,
  ClipShapes,
  clipName,
  clipRowsOf,
  type Parts,
  type Row,
  rowOf,
  rowsOf,
  sameRow,
  setEyes,
} from './rows.js';
import {
  type At,
  CategoryThemes,
  EmptyTreeLine,
  eyeKeys,
  SplitLine,
  TreeView,
  type TreeViewHandle,
  treeClasses as classes,
  UniformPopover,
} from './tree-view.js';

// The explorer's panel (apps/prism-me/_spec/ui.md §1–4): + Open, a filter, the tree of the scene in four categories,
// and under it the properties of the row picked. Rows act through the API as the person (one step each): their eyes run
// the areas' visibility operations; a click picks a row (highlighted in 3D), a double click puts the camera on it.

/** The explorer's tab */
export const SceneTab = 'explorer.tab.scene';

type PropertiesModule = typeof import('./properties.js');

let propertiesModule: Promise<PropertiesModule> | undefined;
/**
 * The properties of the row picked (properties.tsx, with the cryo-ET and mesoscale controls): a chunk of their own,
 * which the first frame does not need (no row is picked at start; Prism's lazy views, app.md §1); imported once
 */
export function loadProperties(): Promise<PropertiesModule> {
  propertiesModule ??= import('./properties.js').catch((e: unknown) => {
    propertiesModule = undefined;
    throw e;
  });
  return propertiesModule;
}

/** `load`: the properties' chunk (tests give their own, to see it pending and failing) */
export function explorerUI(ctx: ViewerUIContext, load = loadProperties): ViewerExtensionUI {
  const area = ctx.api.explorer;
  if (!area) return {};
  const model = sceneModel(area, ctx.api.stage);
  scenes.set(area, model);
  area.setOnReveal((key) => {
    // a clip's row: in the Clips category, by its tag
    const clip = key.startsWith('k:')
      ? ctx.api.clipping?.cuts.value.find((c) => `k:${c.object.tag}` === key)
      : undefined;
    if (clip) {
      model.reveal({ key, label: clipName(clip), kind: 'clip', clip: clip.object.tag! });
      return;
    }
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
        ...(row.clip ? { clip: row.clip } : {}),
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
      // an angle or a dihedral from the latest measuring clicks, first: what the clicks were for
      items.unshift(...picker.menuItems());
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
        render: domView(() => <ScenePanel ctx={ctx} area={area} model={model} load={load} />),
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
  reveal(p: Picked): void;
  /** A model's grouping as its rows show it (its info's), for what acts on its groups */
  groupByOf(model: string): MesoGroupBy | undefined;
  /** The properties' sections, their open state kept from pick to pick for the session (ui.md §4) */
  readonly sections: ShellModel;
}

function sceneModel(area: ExplorerApi, stage: ViewerApi['stage']): SceneModel {
  const open = observableState<ReadonlySet<string>>(new Set([...Categories.map((c) => `c:${c.id}`), ClipsKey]));
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
    sections: new ShellModel(),
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
function ScenePanel(props: {
  ctx: ViewerUIContext;
  area: ExplorerApi;
  model: SceneModel;
  load: () => Promise<PropertiesModule>;
}) {
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
  // read again when what a clip cuts of a list changes (its layers), which the cuts do not compare
  const clips = derive([cuts, objects, parts.asReadonly, area.particleLayersState()], (c, o, p) =>
    clipRowsOf(area, c, o, p),
  );
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
    ...(row.clip ? { clip: row.clip } : {}),
  });
  const pick = (row: Row) => {
    if (picked.value?.key !== row.key) picked.set(pickedOf(row));
    area.highlight(lastingHighlight(row) ? row.node : undefined);
  };
  onCleanup(() => area.highlight(undefined));

  // eyes set at once (a click's row, a drag's rows, and the rows shown under each); their one step runs after the frame
  // is painted (on a large model it takes a moment), and the scene says the rest: the flips are dropped a frame after
  // (back at once if it failed)
  const shown = keyedState<string, boolean>();
  // each set with the state it asked for, at the release (a second click before the scene says so sets it back)
  const eyes: { rows: readonly Row[]; keys: readonly string[]; visible: boolean }[] = [];
  const settled: { key: string; visible: boolean }[] = [];
  const settle = frames(() => {
    // a flip asked for since is kept
    for (const { key, visible } of settled.splice(0)) if (shown.get(key) === visible) shown.delete(key);
  });
  const runEyes = restartable(() => {
    for (const { rows, keys, visible } of eyes.splice(0)) {
      // settled however it ends (a thrown write too: the eyes follow the scene again)
      void Promise.resolve(setEyes(api, area, rows, visible))
        .catch(() => undefined)
        .finally(() => {
          for (const key of keys) settled.push({ key, visible });
          settle.request();
        });
    }
  });
  const afterPaint = frames(() => runEyes.start(0));
  const setShown = (set: readonly Row[], visible: boolean) => {
    const keys = eyeKeys(rows.value, set);
    for (const key of keys) shown.set(key, visible);
    eyes.push({ rows: set, keys, visible });
    afterPaint.request();
  };

  // menus open at the app's root (its tokens), not inside the panel (its containment would clip them)
  let panelEl: HTMLElement | undefined;
  const root = () => rootOf(panelEl);
  // a row's right-click or ⋯: it is picked, and the menu of what it stands for opens there (Color…, Add clip…, Remove
  // with its right-click's items; Ludo, 2026-10-28)
  const menu = (row: Row, at: At, onClose?: () => void) => {
    const r = root();
    if (row.objects) {
      pick(row);
      const items = categoryItems(
        api,
        area,
        row,
        model.groupByOf,
        () => uniformOf(row),
        (sub) => openContextMenu(r, at, sub),
      );
      openContextMenu(r, at, items, onClose);
      return;
    }
    // the Clips category's ⋯: a new clip of every object of the scene (the mock's New clip…)
    if (row.key === ClipsKey) {
      pick(row);
      const all = area.objectsState().value.map((o) => o.ref);
      const shapes = categoryClipItems(api, area, all).filter((i) => i.id.startsWith('clip-'));
      openContextMenu(
        r,
        at,
        [
          {
            id: 'clip',
            label: 'New clip… (every object)',
            icon: 'scissors',
            run: () => openContextMenu(r, at, shapes),
          },
        ],
        onClose,
      );
      return;
    }
    if (row.kind === 'clip' && row.clip) {
      const tag = row.clip;
      pick(row);
      openContextMenu(
        r,
        at,
        [{ id: 'remove', label: 'Remove', icon: 'trash-2', run: () => void api.run('clipping.remove', { tag }) }],
        onClose,
      );
      return;
    }
    if (!row.node) return;
    pick(row);
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
  // a row's color dot: its colors, as Color…
  const colors = (row: Row, at: At, onClose: () => void) => {
    if (!row.node) return;
    pick(row);
    openContextMenu(root(), at, colorItems(api, area, { ...pickedOf(row), node: row.node }, model.groupByOf), onClose);
  };

  // a category's Uniform: its picker at its ⋯, its color applied to every object under it, once
  const uniform = observableState<{ row: Row; anchor: HTMLElement } | undefined>(undefined);
  const uniformOf = (row: Row) => {
    const anchor = panelEl?.querySelector<HTMLElement>(
      `[data-tree-key="${CSS.escape(row.key)}"] button[aria-label="More"]`,
    );
    if (anchor) uniform.set({ row, anchor });
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

  // the properties' module, imported once a row can be picked (the scene has an object) or one is: none at start. As
  // Prism's lazy parts (extensions.tsx): said while it loads, and when it fails, with Retry; one import at a time
  const properties = observableState<PropertiesModule | 'loading' | 'failed' | undefined>(undefined);
  const loadNow = () => {
    properties.set('loading');
    props.load().then(
      (m) => properties.set(m),
      (e: unknown) => {
        console.error('The properties did not load', e);
        properties.set('failed');
      },
    );
  };
  const want = (needed: boolean) => {
    if (needed && properties.value === undefined) loadNow();
  };
  effect(objects, (o) => want(o.length > 0));
  effect(picked.asReadonly, (p) => want(!!p));

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
            more={(row) => !!row.node || !!row.objects?.length || !!row.clip || row.key === ClipsKey}
            onPick={pick}
            onToggle={(row) => toggleOpen(row.key)}
            onEyes={setShown}
            onMenu={menu}
            onColor={colors}
            onDblClick={(row) => row.node && area.focus(row.node)}
            onHover={hover}
            ref={(t) => (tree = t)}
          />
        )}
      </Show>
      <Show when={uniform.asReadonly}>
        {(u) => (
          <UniformPopover
            anchor={u.anchor}
            title={`${u.row.label}: one color`}
            onClose={(refocus) => {
              uniform.set(undefined);
              // Escape and Apply: the focus back on the ⋯ (Popover's contract), if still there
              if (refocus && u.anchor.isConnected) u.anchor.focus();
            }}
            onApply={(c) => void categoryTheme(api, u.row.objects ?? [], 'uniform', model.groupByOf, c)}
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
              <Show when={properties.asReadonly}>
                {(m) =>
                  m === 'loading' ? (
                    <p class={classes.empty}>Loading…</p>
                  ) : m === 'failed' ? (
                    <div class={classes.empty}>
                      <p>The properties could not be loaded.</p>
                      <Button size="sm" onClick={loadNow}>
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <m.Properties
                      api={api}
                      area={area}
                      picked={picked.asReadonly}
                      parts={parts.asReadonly}
                      groupings={model.groupings}
                      groupByOf={model.groupByOf}
                      shell={model.sections}
                    />
                  )
                }
              </Show>
            )}
          </Show>
        </ScrollArea>
      </div>
    </div>
  );
}

/**
 * A category's Add clip…: a new clip of every object under it (Prism's, through all their representations), by shape;
 * then every clip of the scene, used on all of them too (one step), greyed when it cuts each already
 */
function categoryClipItems(api: ViewerApi, area: ExplorerApi, objects: readonly string[]): ContextMenuItem[] {
  const node = objects.map((r) => `#${r}`).join(', ');
  const cuts = api.clipping?.cuts.value ?? [];
  const nodes = objects.map((ref) => ({ ref }));
  const onAll = (tag: string) => {
    const cut = cuts.find((c) => c.object.tag === tag);
    return !!cut && objects.every((ref) => !!area.cutOf(cut, ref));
  };
  return [
    ...Object.entries(ClipShapes).map(([shape, label]) => ({
      id: `clip-${shape}`,
      label: `New ${label.toLowerCase()}`,
      run: async () => {
        const r = await api.run('clipping.add', { shape, node });
        const cut = (r as { value?: { index: number } }).value;
        if (r.ok && cut) showClipHandles(api, cut.index);
      },
    })),
    ...useItems(api, cuts, nodes, onAll),
  ];
}

/**
 * A category's ⋯ (Ludo, 2026-10-28): Color… (a color theme for every object under it, one step: `mesoscale.theme`, the
 * themes its kind takes, ui.md §3; Uniform… its color picked first) and Add clip… (a new clip of every object under it, or
 * one of the scene's used on all of them); no icons on the themes and shapes (styling.md §4)
 */
function categoryItems(
  api: ViewerApi,
  area: ExplorerApi,
  row: Row,
  groupBy: (model: string) => MesoGroupBy | undefined,
  uniform: () => void,
  open: (items: ContextMenuItem[]) => void,
): ContextMenuItem[] {
  const objects = row.objects ?? [];
  const themes: ContextMenuItem[] = (CategoryThemes[row.key] ?? []).map(([theme, label]) => ({
    id: `theme-${theme}`,
    label,
    run: () => (theme === 'uniform' ? uniform() : void categoryTheme(api, objects, theme, groupBy)),
  }));
  return [
    { id: 'color', label: 'Color…', icon: 'palette', run: () => open(themes) },
    {
      id: 'clip',
      label: 'Add clip… (every object in it)',
      icon: 'scissors',
      run: () => open(categoryClipItems(api, area, objects)),
    },
  ];
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
