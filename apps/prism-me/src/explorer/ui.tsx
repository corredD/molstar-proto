/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
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
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';
import type { Subscription } from 'rxjs';
import type { ExplorerApi } from './operations.js';
import { type Picked, Properties } from './properties.js';
import { Categories, type Parts, type Row, rowsOf, stableRows, toggleVisible } from './rows.js';

// The explorer's panel (apps/prism-me/_spec/ui.md §1–4): + Open, a filter, the tree of the scene in four categories,
// and under it the properties of the row picked. Rows act through the API as the person (one step each): their eyes run
// the areas' visibility operations; a click picks a row (highlighted in 3D), a double click puts the camera on it.

/** The explorer's tab */
export const SceneTab = 'explorer.tab.scene';

export function explorerUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.explorer;
  if (!area) return {};
  return {
    tabs: [
      {
        id: SceneTab,
        title: 'Scene',
        icon: 'list-tree',
        order: 0,
        render: domView(() => <ScenePanel ctx={ctx} area={area} />),
      },
    ],
  };
}

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';

/** The person's picked row */
function ScenePanel(props: { ctx: ViewerUIContext; area: ExplorerApi }) {
  const { ctx, area } = props;
  const api = ctx.api;
  const objects = area.objectsState();
  // the parts of particle models and lists, from the mesoscale and cryo-ET areas (one read per object, kept while shown)
  const parts = observableState<Parts>(new Map());
  const partStates = new Map<string, { state: ReadonlyState<unknown>; sub: Subscription }>();
  const objectsSub = objects.subscribe((list) => {
    const wanted = new Set(list.filter((o) => o.category === 'particles').map((o) => o.ref));
    for (const [ref, { sub }] of partStates) {
      if (wanted.has(ref)) continue;
      sub.unsubscribe();
      partStates.delete(ref);
    }
    for (const o of list) {
      if (o.category !== 'particles' || partStates.has(o.ref)) continue;
      const state: ReadonlyState<unknown> | undefined =
        o.kind === 'model' ? api.mesoscale?.infoState(o.ref) : api.cryoet?.decorationsState(o.ref);
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

  const open = observableState<ReadonlySet<string>>(new Set(Categories.map((c) => `c:${c.id}`)));
  const filter = observableState('');
  const picked = observableState<Picked | undefined>(undefined);
  const split = splitter(240);
  const stable = stableRows();
  const rows = derive([objects, parts.asReadonly, open.asReadonly, filter.asReadonly], (o, p, op, f) =>
    stable(rowsOf(o, p, op, f)),
  );
  // the row under the pointer: lit in the tree and in 3D (the picked row's highlight comes back when it leaves)
  const hovered = observableState<string | undefined>(undefined);
  const hover = (row: Row | undefined) => {
    hovered.set(row?.key);
    area.highlight(row ? row.node : picked.value?.node);
  };
  const toggleOpen = (key: string) => {
    const next = new Set(open.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    open.set(next);
  };
  const pick = (row: Row) => {
    picked.set({ key: row.key, label: row.label, kind: row.kind, ...(row.node ? { node: row.node } : {}) });
    area.highlight(row.node);
  };
  onCleanup(() => area.highlight(undefined));

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
      <div style="flex: 0 1 auto; min-height: 60px; overflow: auto; padding: 0 var(--msp-space-2)">
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
          {() => <Properties api={api} area={area} picked={picked.asReadonly} parts={parts.asReadonly} />}
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
  return (
    <div
      style={derive(
        [isPicked, isHovered],
        (p, h) =>
          `display: flex; align-items: center; gap: var(--msp-space-1); min-height: 26px; padding-left: calc(${row.depth} * var(--msp-space-3)); border-radius: var(--msp-radius-sm, 4px); cursor: default; ${p ? 'background: var(--msp-color-selected, rgba(120, 160, 255, 0.18));' : h ? 'background: var(--msp-color-hover, rgba(255, 255, 255, 0.06));' : ''}`,
      )}
      onClick={() => !category && props.onPick(row)}
      onDblClick={() => row.node && props.area.focus(row.node)}
      onMouseEnter={() => !category && props.onHover(row)}
      onMouseLeave={() => !category && props.onHover(undefined)}
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
        {row.label}
      </span>
      {row.count ? <span style={`flex: none; ${Muted}`}>{row.count}</span> : null}
    </div>
  );
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

function openMenu(e: MouseEvent, items: ContextMenuItem[]) {
  const button = e.currentTarget as HTMLElement;
  const root = button.closest<HTMLElement>('.msp-root') ?? document.body;
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
