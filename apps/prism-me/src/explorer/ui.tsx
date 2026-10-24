/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import type { MesoGroupBy } from '@molstar/mesoscale-extension/model';
import type { MesoscaleInfo } from '@molstar/mesoscale-extension/operations';
import {
  Button,
  type ContextMenuItem,
  domView,
  For,
  Icon,
  onCleanup,
  openContextMenu,
  Show,
  TextInput,
} from '@molstar/prism-ui';
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
import { distancePicker } from './measure.js';
import { clipItems, clippable, colorable, colorItems, nodeMenuItems, removable, removeObject } from './menu.js';
import type { ExplorerApi, PickedNode } from './operations.js';
import { type Picked, Properties } from './properties.js';
import {
  ancestorKeys,
  Categories,
  type Parts,
  type Row,
  rowOf,
  rowsOf,
  stableRows,
  toggleVisible,
  treeKey,
} from './rows.js';

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
  // a distance by two Ctrl+clicks (_spec/ui.md, Measurements); Esc or a plain click lets its first point go
  const picker = distancePicker(ctx.api, area, {
    post: (text) => ctx.managers.notifications.post(text),
    reveal: model.reveal,
  });
  area.escaped.subscribe(() => picker.cancel());
  // the tree follows a pick in 3D (a left-click): its row picked and the way to it unfolded
  area.setOnClick((click) => {
    if (click.measure) {
      void picker.click(click);
      return;
    }
    picker.cancel();
    const p = labelPicked(click.x, click.y) ?? area.pickedOf(click.loci);
    if (p) model.reveal(p);
  });
  // a label under the pointer (a text is drawn, not picked by Mol*: the stage measures its box)
  const labelPicked = (x: number | undefined, y: number | undefined): PickedNode | undefined => {
    if (x === undefined || y === undefined) return undefined;
    const ref = ctx.api.stage?.labelAt(x, y);
    const label = ref ? ctx.api.stage?.labelsState().value.find((l) => l.ref === ref) : undefined;
    return label ? { key: `l:${label.ref}`, label: label.text, kind: 'label', node: { ref: label.ref } } : undefined;
  };
  // the canvas's right-click opens the explorer's menu, at the level of what it picked (the stage's own is not opened)
  const stage = ctx.api.stage;
  if (stage) {
    let close: (() => void) | undefined;
    stage.setMenu((request) => {
      close?.();
      const root = rootOf(request.anchor);
      const at = { x: request.x, y: request.y };
      const p = labelPicked(request.x, request.y) ?? area.pickedOf(request.loci);
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

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';

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
  const split = splitter(240);
  const stable = stableRows();
  // the stage's labels, each under the row it was made at
  const labels = api.stage?.labelsState() ?? observableState<readonly LabelInfo[]>([]).asReadonly;
  // and its distances, each under its first point's row
  const distances = api.stage?.distancesState() ?? observableState<readonly DistanceInfo[]>([]).asReadonly;
  const rows = derive(
    [objects, parts.asReadonly, open.asReadonly, filter.asReadonly, labels, distances],
    (o, p, op, f, l, d) => stable(rowsOf(o, p, op, f, l, d)),
  );
  // the row under the pointer: lit in the tree and in 3D (the picked row's highlight comes back when it leaves)
  const hovered = observableState<string | undefined>(undefined);
  const hover = (row: Row | undefined) => {
    hovered.set(row?.key);
    const p = picked.value;
    area.highlight(row ? row.node : p && lastingHighlight(p) ? p.node : undefined);
  };
  const toggleOpen = (key: string) => {
    const next = new Set(open.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    open.set(next);
  };
  const pick = (row: Row) => {
    picked.set({
      key: row.key,
      label: row.label,
      kind: row.kind,
      ...(row.node ? { node: row.node } : {}),
      ...(row.representation ? { representation: row.representation } : {}),
    });
    area.highlight(lastingHighlight(row) ? row.node : undefined);
  };
  onCleanup(() => area.highlight(undefined));
  // the tree's keys: a row picked (and into view), or opened or closed; not while typing in a field
  const keys = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    const what = treeKey(rows.value, open.value, picked.value?.key, e.key);
    if (!what) return;
    e.preventDefault();
    if ('toggle' in what) return toggleOpen(what.toggle);
    const row = rows.value.find((r) => r.key === what.pick);
    if (!row) return;
    pick(row);
    model.scrollTo.set(row.key);
  };
  // a row tool (the brush, the scissors): the row picked, its menu under the button
  const tool = (row: Row, e: MouseEvent, which: 'color' | 'clip') => {
    if (!row.node) return;
    e.stopPropagation();
    pick(row);
    const button = e.currentTarget as HTMLElement;
    const r = button.getBoundingClientRect();
    const picked = {
      key: row.key,
      label: row.label,
      kind: row.kind,
      node: row.node,
      ...(row.representation ? { representation: row.representation } : {}),
    };
    openContextMenu(
      rootOf(button),
      { x: r.left, y: r.bottom },
      which === 'color' ? colorItems(api, area, picked, model.groupByOf) : clipItems(api, area, picked),
    );
  };
  // a row's right-click: it is picked, and the menu of what it stands for opens at the pointer
  const menu = (row: Row, e: MouseEvent) => {
    if (!row.node) return;
    e.preventDefault();
    pick(row);
    const root = rootOf(e.currentTarget as Element);
    const at = { x: e.clientX, y: e.clientY };
    const picked = { key: row.key, label: row.label, kind: row.kind, node: row.node };
    openContextMenu(
      root,
      at,
      nodeMenuItems(api, area, picked, {
        open: (sub) => openContextMenu(root, at, sub),
        reveal: model.reveal,
        groupBy: model.groupByOf,
        editText: (text, keep) => editInline(root, at, text, keep),
      }),
    );
  };

  return (
    <div style="flex: 1 1 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden">
      <div style="display: flex; gap: var(--msp-space-2); align-items: center; padding: var(--msp-space-2) var(--msp-space-3)">
        <Button size="sm" icon={<Icon name="plus" />} onClick={(e) => openMenu(e, openItems(ctx))}>
          Open
        </Button>
        <div style="flex: 1">
          <TextInput
            search
            size="sm"
            placeholder="Filter"
            aria-label="Filter the scene"
            onInput={(v) => filter.set(v)}
          />
        </div>
      </div>
      {/* focused by a click on a row: Up and Down pick, Left and Right close and open (a tree view's keys) */}
      <div
        role="tree"
        aria-label="The scene"
        tabIndex={0}
        style="flex: 0 1 auto; min-height: 60px; overflow: auto; padding: 0 var(--msp-space-2); outline: none"
        onKeyDown={keys}
      >
        <Show
          when={mapState(objects, (o) => o.length > 0)}
          fallback={() => (
            <p style={`margin: var(--msp-space-3); ${Muted}`}>
              Drop files here, or + Open: structures (mmCIF, PDB), cellPACK and PetWorld models, particle lists (STAR,
              TBL, EM, NDJSON), maps and tomograms (MRC, REC, ST), meshes (OBJ, PLY, VTP).
            </p>
          )}
        >
          {() => (
            <For each={rows} by={(r) => r.key}>
              {(row) => (
                <TreeRow
                  api={api}
                  area={area}
                  row={row}
                  open={open.asReadonly}
                  picked={picked.asReadonly}
                  hovered={hovered.asReadonly}
                  scrollTo={model.scrollTo}
                  onMenu={menu}
                  onTool={tool}
                  onToggleOpen={toggleOpen}
                  onPick={pick}
                  onHover={hover}
                />
              )}
            </For>
          )}
        </Show>
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to size the properties"
        style="flex: none; height: 7px; cursor: row-resize; display: flex; align-items: center; touch-action: none"
        onPointerDown={split.down}
        onPointerMove={split.move}
        onPointerUp={split.up}
      >
        <div style="flex: 1; height: 1px; background: var(--msp-color-border)" />
      </div>
      {/* the tree as tall as it is, the properties under it in the rest, never less than their height (dragged) */}
      <div
        style={mapState(
          split.height,
          (h) => `flex: 1 0 ${h}px; min-height: ${h}px; overflow: auto; padding: var(--msp-space-2) var(--msp-space-3)`,
        )}
      >
        <Show
          when={mapState(picked.asReadonly, (p) => !!p)}
          fallback={() => <p style={`margin: 0; ${Muted}`}>Pick a row to see its properties.</p>}
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
      </div>
    </div>
  );
}

function TreeRow(props: {
  api: ViewerApi;
  area: ExplorerApi;
  row: Row;
  open: ReadonlyState<ReadonlySet<string>>;
  picked: ReadonlyState<Picked | undefined>;
  hovered: ReadonlyState<string | undefined>;
  scrollTo: ObservableState<string | undefined>;
  onMenu(row: Row, e: MouseEvent): void;
  onTool(row: Row, e: MouseEvent, which: 'color' | 'clip'): void;
  onToggleOpen(key: string): void;
  onPick(row: Row): void;
  onHover(row: Row | undefined): void;
}) {
  const { row } = props;
  const isOpen = mapState(props.open, (o) => o.has(row.key));
  const isPicked = mapState(props.picked, (p) => p?.key === row.key);
  const isHovered = mapState(props.hovered, (h) => h === row.key);
  const shown = observableState(row.visible ?? false);
  const category = row.kind === 'category';
  // brought into view when picked in 3D (once: the request is cleared)
  let el: HTMLElement | undefined;
  const sub = props.scrollTo.asReadonly.subscribe((key) => {
    if (key !== row.key || !el) return;
    el.scrollIntoView({ block: 'nearest' });
    props.scrollTo.set(undefined);
  });
  onCleanup(() => sub.unsubscribe());
  return (
    <div
      ref={(e: HTMLElement) => {
        el = e;
        // a row made by the reveal itself (its way unfolded): into view once laid out
        if (props.scrollTo.value === row.key) {
          requestAnimationFrame(() => {
            e.scrollIntoView({ block: 'nearest' });
            props.scrollTo.set(undefined);
          });
        }
      }}
      style={derive(
        [isPicked, isHovered],
        (p, h) =>
          `display: flex; align-items: center; gap: var(--msp-space-1); min-height: 26px; padding-left: calc(${row.depth} * var(--msp-space-3)); border-radius: var(--msp-radius-sm, 4px); cursor: default; ${p ? 'background: var(--msp-color-selected, rgba(120, 160, 255, 0.18));' : h ? 'background: var(--msp-color-hover, rgba(255, 255, 255, 0.06));' : ''}`,
      )}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={mapState(isPicked, String)}
      aria-expanded={row.hasChildren ? mapState(isOpen, String) : undefined}
      onClick={() => !category && props.onPick(row)}
      onDblClick={() => row.node && props.area.focus(row.node)}
      onMouseEnter={() => !category && props.onHover(row)}
      onMouseLeave={() => !category && props.onHover(undefined)}
      onContextMenu={(e) => !category && props.onMenu(row, e)}
    >
      {row.hasChildren ? (
        <Button
          size="xs"
          variant="ghost"
          title={mapState(isOpen, (o) => (o ? 'Fold' : 'Unfold'))}
          icon={
            <Show when={isOpen} fallback={() => <Icon name="chevron-right" />}>
              {() => <Icon name="chevron-down" />}
            </Show>
          }
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleOpen(row.key);
          }}
        />
      ) : (
        <span style="width: 20px" />
      )}
      {row.visible !== undefined ? (
        <Button
          size="xs"
          variant="ghost"
          title="Show or hide"
          icon={
            <Show when={shown} fallback={() => <Icon name="eye-off" />}>
              {() => <Icon name="eye" />}
            </Show>
          }
          onClick={(e) => {
            e.stopPropagation();
            // flipped at once, the operation after the next frame (on a large model it takes a moment): the row is made
            // again from the scene when it is done, and goes back if it failed
            const was = shown.value;
            shown.set(!was);
            // after the frame is painted (a frame callback runs before it)
            requestAnimationFrame(() =>
              setTimeout(() => {
                void toggleVisible(props.api, row)?.then((r) => {
                  if (r && !r.ok) shown.set(was);
                });
              }),
            );
          }}
        />
      ) : null}
      {row.color !== undefined ? (
        <span
          style={`width: 10px; height: 10px; border-radius: 50%; flex: none; background: ${Color.toHexStyle(Color(row.color))}`}
        />
      ) : null}
      <span
        style={`flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; ${category ? 'font-weight: 600; text-transform: none' : ''}`}
      >
        {/* a label: told apart from the objects (its kind, before its text) */}
        {row.kind === 'label' ? (
          <span
            style={`${Muted}; display: inline-flex; align-items: center; gap: 2px; vertical-align: middle; margin-right: var(--msp-space-1)`}
          >
            <Icon name="type" size={12} />
            Label
          </span>
        ) : row.kind === 'distance' ? (
          <span
            style={`${Muted}; display: inline-flex; align-items: center; gap: 2px; vertical-align: middle; margin-right: var(--msp-space-1)`}
          >
            <Icon name="ruler" size={12} />
            Distance
          </span>
        ) : null}
        {row.label}
      </span>
      {row.count ? <span style={`flex: none; ${Muted}`}>{row.count}</span> : null}
      {colorable(row.kind, row.node) ? (
        <Button
          size="xs"
          variant="ghost"
          title="Color all of it"
          icon={<Icon name="paintbrush" />}
          onClick={(e) => props.onTool(row, e, 'color')}
        />
      ) : null}
      {clippable(row.kind, row.node) ? (
        <Button
          size="xs"
          variant="ghost"
          title="Add a clip"
          icon={<Icon name="scissors" />}
          onClick={(e) => props.onTool(row, e, 'clip')}
        />
      ) : null}
      {removable(row.kind, row.node) ? (
        <Button
          size="xs"
          variant="ghost"
          title="Remove it from the scene"
          icon={<Icon name="trash-2" />}
          onClick={(e) => {
            e.stopPropagation();
            void removeObject(props.api, props.area, row.kind, row.node!.ref);
          }}
        />
      ) : null}
    </div>
  );
}

/** Whether a picked row stays lit in 3D: not a volume's (its light would cover the slice's image) */
function lastingHighlight(row: { readonly kind: string }) {
  return !['volume', 'slice', 'oblique slice', 'isosurface', 'volume representation'].includes(row.kind);
}

// --- the split between the tree and the properties ----------------------------------------------------------------

/** The properties' least height, dragged on the line above them (the pointer captured while dragging) */
function splitter(initial: number) {
  const height = observableState(initial);
  let start: { y: number; h: number } | undefined;
  return {
    height: height.asReadonly,
    down(e: PointerEvent) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      start = { y: e.clientY, h: height.value };
    },
    move(e: PointerEvent) {
      if (start) height.set(Math.max(60, Math.min(window.innerHeight - 160, start.h - (e.clientY - start.y))));
    },
    up() {
      start = undefined;
    },
  };
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
  return [
    { id: 'files', label: 'Files…', icon: 'folder-open', run: () => pickFiles(false) },
    {
      id: 'entry',
      label: 'PDB, PDB-IHM or EMDB entry…',
      icon: 'download',
      run: () => void ctx.managers.commands.open('load.entry'),
    },
    {
      id: 'examples',
      label: 'Mesoscale examples…',
      icon: 'book-open',
      run: () => void ctx.managers.commands.open('mesoscale.example'),
    },
    { id: 'session', label: 'Session…', icon: 'file', run: () => pickFiles(true) },
  ];
}
