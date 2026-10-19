/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import type { DecorationsInfo } from '@molstar/cryoet-extension/operations';
import { groupEntities, type MesoGroup } from '@molstar/mesoscale-extension/model';
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
import type { Category, ExplorerApi, NodeRef, SceneObject } from './operations.js';

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

const Categories: readonly { id: Category; label: string }[] = [
  { id: 'structures', label: 'Structures' },
  { id: 'particles', label: 'Particles' },
  { id: 'volumes', label: 'Volumes' },
  { id: 'meshes', label: 'Meshes' },
];

/** A row of the tree, flat (its depth says where it is) */
interface Row {
  readonly key: string;
  readonly depth: number;
  readonly label: string;
  readonly kind: string;
  readonly count?: string;
  readonly color?: number;
  /** Its eye: whether shown; absent, no eye */
  readonly visible?: boolean;
  readonly hasChildren: boolean;
  /** What it stands for in 3D (none for a category) */
  readonly node?: NodeRef;
}

/** The person's picked row */
interface Picked {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly node?: NodeRef;
}

function ScenePanel(props: { ctx: ViewerUIContext; area: ExplorerApi }) {
  const { ctx, area } = props;
  const api = ctx.api;
  const objects = area.objectsState();
  // the parts of particle models and lists, from the mesoscale and cryo-ET areas (one read per object, kept while shown)
  const parts = observableState<ReadonlyMap<string, MesoscaleInfo | DecorationsInfo | undefined>>(new Map());
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
  const rows = derive([objects, parts.asReadonly, open.asReadonly, filter.asReadonly], (o, p, op, f) =>
    rowsOf(o, p, op, f),
  );
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
    <div style="display: flex; flex-direction: column; height: 100%; min-height: 0">
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
      <div style="flex: 1 1 60%; min-height: 120px; overflow: auto; padding: 0 var(--msp-space-2)">
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
                  onToggleOpen={toggleOpen}
                  onPick={pick}
                />
              )}
            </For>
          )}
        </Show>
      </div>
      <div style="flex: 1 1 40%; min-height: 80px; overflow: auto; border-top: 1px solid var(--msp-color-border); padding: var(--msp-space-3)">
        <Show
          when={mapState(picked.asReadonly, (p) => !!p)}
          fallback={() => <p style={`margin: 0; ${Muted}`}>Pick a row to see its properties.</p>}
        >
          {() => (
            <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
              <strong>{mapState(picked.asReadonly, (p) => p?.label ?? '')}</strong>
              <span style={Muted}>{mapState(picked.asReadonly, (p) => p?.kind ?? '')}</span>
            </div>
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
  onToggleOpen(key: string): void;
  onPick(row: Row): void;
}) {
  const { row } = props;
  const isOpen = mapState(props.open, (o) => o.has(row.key));
  const isPicked = mapState(props.picked, (p) => p?.key === row.key);
  const category = row.kind === 'category';
  return (
    <div
      style={mapState(
        isPicked,
        (p) =>
          `display: flex; align-items: center; gap: var(--msp-space-1); min-height: 26px; padding-left: calc(${row.depth} * var(--msp-space-3)); border-radius: var(--msp-radius-sm, 4px); cursor: default; ${p ? 'background: var(--msp-color-selected, rgba(120, 160, 255, 0.18));' : ''}`,
      )}
      onClick={() => !category && props.onPick(row)}
      onDblClick={() => row.node && props.area.focus(row.node)}
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
          icon={<Icon name={row.visible ? 'eye' : 'eye-off'} />}
          onClick={(e) => {
            e.stopPropagation();
            void toggleVisible(props.api, row);
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

// --- the rows ---------------------------------------------------------------------------------------------------------

function rowsOf(
  objects: readonly SceneObject[],
  parts: ReadonlyMap<string, MesoscaleInfo | DecorationsInfo | undefined>,
  open: ReadonlySet<string>,
  filter: string,
): Row[] {
  const f = filter.trim().toLowerCase();
  const rows: Row[] = [];
  const push = (r: Row, children: () => void) => {
    rows.push(r);
    if (r.hasChildren && (open.has(r.key) || f)) children();
  };
  for (const c of Categories) {
    const items = objects.filter((o) => o.category === c.id);
    if (!items.length) continue;
    push(
      { key: `c:${c.id}`, depth: 0, label: c.label, kind: 'category', count: String(items.length), hasChildren: true },
      () => {
        for (const o of items) objectRows(o, parts.get(o.ref), push, f);
      },
    );
  }
  return f ? rows.filter((r) => r.kind === 'category' || r.label.toLowerCase().includes(f)) : rows;
}

type Push = (r: Row, children: () => void) => void;

function objectRows(o: SceneObject, part: MesoscaleInfo | DecorationsInfo | undefined, push: Push, f: string) {
  const base = { depth: 1, label: o.label, count: o.count, visible: o.visible, node: { ref: o.ref } };
  if (o.kind === 'structure') {
    push({ ...base, key: `o:${o.ref}`, kind: 'structure', hasChildren: !!o.entities?.length }, () => {
      for (const e of o.entities ?? []) {
        push(
          {
            key: `e:${o.ref}:${e.id}`,
            depth: 2,
            label: e.label,
            kind: 'entity',
            count: e.chains.length > 1 ? `${e.chains.length} chains` : undefined,
            hasChildren: e.chains.length > 1,
            node: { ref: o.ref, entity: e.id },
          },
          () => {
            for (const ch of e.chains) {
              push(
                {
                  key: `ch:${o.ref}:${e.id}:${ch}`,
                  depth: 3,
                  label: `Chain ${ch}`,
                  kind: 'chain',
                  hasChildren: false,
                  node: { ref: o.ref, entity: e.id, chain: ch },
                },
                () => {},
              );
            }
          },
        );
      }
    });
    return;
  }
  if (o.kind === 'model') {
    const info = part as MesoscaleInfo | undefined;
    push({ ...base, key: `o:${o.ref}`, kind: 'mesoscale model', hasChildren: !!info?.entities.length }, () => {
      if (!info) return;
      const byId = new Map(info.entities.map((e) => [e.id, e]));
      const walk = (g: MesoGroup, depth: number) => {
        for (const child of g.groups) {
          const members = groupEntities(child);
          const shown = members.some((id) => byId.get(id)?.visible);
          push(
            {
              key: `g:${o.ref}:${child.path}`,
              depth,
              label: child.label,
              kind: 'group',
              count: String(members.length),
              visible: shown,
              hasChildren: true,
              node: { ref: o.ref, particles: { entities: members } },
            },
            () => walk(child, depth + 1),
          );
        }
        for (const id of g.entities) {
          const e = byId.get(id);
          if (!e) continue;
          push(
            {
              key: `me:${o.ref}:${id}`,
              depth,
              label: e.name,
              kind: 'entity',
              count: e.count.toLocaleString('en'),
              visible: e.visible,
              ...(e.color !== undefined ? { color: e.color } : {}),
              hasChildren: false,
              node: { ref: o.ref, particles: { entities: [id] } },
            },
            () => {},
          );
        }
      };
      walk(info.groups, 2);
    });
    return;
  }
  if (o.kind === 'list') {
    const info = part as DecorationsInfo | undefined;
    push({ ...base, key: `o:${o.ref}`, kind: 'particle list', hasChildren: !!info?.targets.length }, () => {
      for (const t of info?.targets ?? []) {
        push(
          {
            key: `t:${o.ref}:${t.id}`,
            depth: 2,
            label: t.with ? `${t.name} · ${t.with}` : t.name,
            kind: 'target',
            count: t.count.toLocaleString('en'),
            hasChildren: false,
            node: { ref: o.ref, particles: { targets: [t.id] } },
          },
          () => {},
        );
      }
    });
    return;
  }
  if (o.kind === 'volume') {
    push({ ...base, key: `o:${o.ref}`, kind: 'volume', hasChildren: !!o.representations?.length }, () => {
      for (const r of o.representations ?? []) {
        push(
          {
            key: `r:${r.ref}`,
            depth: 2,
            label: r.label,
            kind: 'volume representation',
            visible: r.visible,
            hasChildren: false,
            node: { ref: o.ref },
          },
          () => {},
        );
      }
    });
    return;
  }
  push({ ...base, key: `o:${o.ref}`, kind: 'mesh', hasChildren: false }, () => {});
  void f;
}

/** A row's eye: the visibility operation of what it stands for */
function toggleVisible(api: ViewerApi, row: Row) {
  const visible = !row.visible;
  const node = row.node;
  if (!node) return;
  switch (row.kind) {
    case 'structure':
      return api.run('structure.visibility', { structure: node.ref, visible });
    case 'mesoscale model':
    case 'particle list':
      return api.run('particles.visibility', { particles: node.ref, visible });
    case 'group':
    case 'entity':
      if ('particles' in node) {
        return api.run('mesoscale.style', {
          particles: node.ref,
          entities: (node.particles.entities ?? []).join(','),
          visible,
        });
      }
      return;
    case 'volume':
      return api.run('volume.visibility', { volume: node.ref, visible });
    case 'volume representation':
      return api.run('volume.visibility', { node: row.key.slice(2), visible });
    case 'mesh':
      return api.run('cryoet.mesh', { mesh: node.ref, visible });
  }
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
