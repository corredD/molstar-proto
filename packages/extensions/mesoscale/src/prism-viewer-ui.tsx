/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { Button, Choices, ColorPicker, domView, For, Icon, Select, Show, TextInput } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { Motion } from './controls.js';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';
import { type MesoGroup, groupEntities } from './model.js';
import {
  type EntityInfo,
  type GraphicsMode,
  type MesoscaleApi,
  type MesoscaleExample,
  type MesoscaleExampleId,
  type MesoscaleInfo,
  mesoscaleExamples,
} from './operations.js';

// The Entities tab (apps/prism-me/_spec/features.md, "Mesoscale"; v5's `apps/mesoscale-explorer/src/ui/entities.tsx`):
// the graphics mode, the colors, a filter, and the entities of the particle list in their groups (compartments or
// functions), each with its eye, its color and its count. It reads the `mesoscale` area's state and acts through its
// operations, so the history, the record and the agent see every change.

export const EntitiesTab = 'mesoscale.tab.entities';
export const ExamplesSection = 'mesoscale.section.examples';

/** The Mesoscale Explorer's examples, each a button that opens it (`mesoscale.example`) */
function Examples(props: { area: MesoscaleApi }) {
  const list = observableState<readonly MesoscaleExample[] | undefined>(undefined);
  void mesoscaleExamples().then((l) => list.set(l));
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      <Show when={list} fallback={() => <span style={Muted}>Fetching the examples…</span>}>
        {(l) => (
          <For each={l} by={(e) => e.id}>
            {(e) => (
              <Button
                size="sm"
                variant="ghost"
                title={e.description}
                onClick={() => void props.area.example({ id: e.id as MesoscaleExampleId })}
              >
                {e.label}
              </Button>
            )}
          </For>
        )}
      </Show>
    </div>
  );
}

export function mesoscaleUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.mesoscale;
  if (!area) return {};
  return {
    sections: [
      {
        id: ExamplesSection,
        slot: 'home.import',
        title: 'Mesoscale examples',
        icon: 'book-open',
        order: 1,
        keywords: ['example', 'cellpack', 'petworld', 'mesoscale', 'hiv', 'sars-cov-2'],
        render: domView(() => <Examples area={area} />),
      },
    ],
    tabs: [
      {
        id: EntitiesTab,
        title: 'Entities',
        icon: 'shapes',
        order: 15,
        render: domView(() => <EntitiesView area={area} />),
      },
    ],
  };
}

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';

function EntitiesView(props: { area: MesoscaleApi }) {
  const { area } = props;
  const lists = area.listsState();
  // the list shown: picked among several, else the only one
  const picked = observableState('');
  const current = derive([lists, picked.asReadonly], (l, p) => (l.some((x) => x.ref === p) ? p : (l[0]?.ref ?? '')));
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-3); padding: var(--msp-space-3)">
      <Show when={mapState(lists, (l) => l.length > 1)}>
        {() => (
          <For each={mapState(lists, (l) => [JSON.stringify(l)])} by={(k) => k}>
            {() => (
              <Select
                size="sm"
                aria-label="Particle list"
                options={lists.value.map((l) => [l.ref, l.label] as [string, string])}
                value={current}
                onChange={(ref) => picked.set(ref)}
              />
            )}
          </For>
        )}
      </Show>
      <For each={mapState(current, (c) => [c])} by={(c) => c}>
        {(ref) => {
          const info = area.infoState(ref);
          return (
            <Show
              when={mapState(info, (i) => !!i)}
              fallback={() => (
                <p style={`margin: 0; ${Muted}`}>
                  Open a cellPACK or PetWorld model (mmCIF, BinaryCIF) or a particle list to see its entities.
                </p>
              )}
            >
              {() => <Entities area={area} info={info as ReadonlyState<MesoscaleInfo>} />}
            </Show>
          );
        }}
      </For>
    </div>
  );
}

function Entities(props: { area: MesoscaleApi; info: ReadonlyState<MesoscaleInfo> }) {
  const { area, info } = props;
  const filter = observableState('');
  const mode = observableState<GraphicsMode>('quality');
  const open = observableState<ReadonlySet<string>>(new Set(['']));
  const rowCache = new Map<string, Row>();
  const particles = () => info.value.particles;
  const toggleOpen = (path: string) => {
    const next = new Set(open.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    open.set(next);
  };
  return (
    <>
      <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
        <strong>{mapState(info, (i) => i.label)}</strong>
        <span style={Muted}>
          {mapState(
            info,
            (i) => `${i.count.toLocaleString('en')} particles · ${i.entities.length} entities · by ${i.groupBy}`,
          )}
        </span>
      </div>
      <Choices
        label="Graphics"
        choices={[
          { id: 'ultra', label: 'Ultra' },
          { id: 'quality', label: 'Quality' },
          { id: 'balanced', label: 'Balanced' },
          { id: 'performance', label: 'Fast' },
        ]}
        active={mode.asReadonly}
        onPick={(id) => {
          mode.set(id as GraphicsMode);
          void area.graphics({ mode: id as GraphicsMode });
        }}
      />
      <div style="display: flex; gap: var(--msp-space-2); flex-wrap: wrap">
        <Button
          size="sm"
          icon={<Icon name="palette" />}
          onClick={() => void area.colors({ scheme: 'generate', particles: particles() })}
        >
          Generate colors
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void area.colors({ scheme: 'theme', particles: particles() })}>
          Theme colors
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void area.style({ reset: true, particles: particles() } as never)}
        >
          Reset
        </Button>
      </div>
      <Motion area={area} />
      <TextInput
        search
        size="sm"
        placeholder="Filter entities"
        aria-label="Filter entities"
        onInput={(v) => filter.set(v)}
      />
      <For each={derive([info, filter.asReadonly], (i, f) => rowsOf(i, f, rowCache))} by={(r) => r.key}>
        {(row) =>
          row.kind === 'group' ? (
            <GroupRow area={area} info={info} row={row} open={open.asReadonly} onToggleOpen={toggleOpen} />
          ) : (
            <EntityRow area={area} info={info} row={row} open={open.asReadonly} />
          )
        }
      </For>
    </>
  );
}

type Row =
  | { kind: 'group'; key: string; group: MesoGroup; depth: number }
  | { kind: 'entity'; key: string; id: number; depth: number };

/**
 * The rows of the tree: the groups, then their entities, those the filter keeps (a filter opens every group). A row is
 * the same object as long as it stands for the same thing (`cache`): `For` makes a row anew when its item changes, which
 * would drop its open controls (a cut's, a color picker) at every change of the model.
 */
function rowsOf(info: MesoscaleInfo, filter: string, cache: Map<string, Row>): Row[] {
  const f = filter.trim().toLowerCase();
  const byId = new Map(info.entities.map((e) => [e.id, e]));
  const keep = (id: number) => !f || (byId.get(id)?.name.toLowerCase().includes(f) ?? false);
  const rows: Row[] = [];
  const walk = (g: MesoGroup, depth: number) => {
    for (const child of g.groups) {
      if (!groupEntities(child).some(keep)) continue;
      rows.push(same(cache, { kind: 'group', key: `g:${child.path}`, group: child, depth }));
      walk(child, depth + 1);
    }
    for (const id of g.entities) if (keep(id)) rows.push(same(cache, { kind: 'entity', key: `e:${id}`, id, depth }));
  };
  walk(info.groups, 0);
  return rows;
}

/** The cached row of the same key, depth and members, else this one (cached) */
function same(cache: Map<string, Row>, row: Row): Row {
  const old = cache.get(row.key);
  const members = (r: Row) => (r.kind === 'group' ? groupEntities(r.group).join(',') : String(r.id));
  if (old && old.depth === row.depth && members(old) === members(row)) return old;
  cache.set(row.key, row);
  return row;
}

/** Hidden when one of its ancestors is folded */
function folded(row: Row, open: ReadonlySet<string>, info: MesoscaleInfo): boolean {
  const path = row.kind === 'group' ? row.group.path : pathOf(info.groups, row.id);
  if (path === undefined) return false;
  const parts = path.split('.');
  const upTo = row.kind === 'group' ? parts.length - 1 : parts.length;
  for (let i = 1; i <= upTo; ++i) {
    if (!open.has(parts.slice(0, i).join('.'))) return true;
  }
  return false;
}

function pathOf(g: MesoGroup, id: number): string | undefined {
  if (g.entities.includes(id)) return g.path;
  for (const c of g.groups) {
    const p = pathOf(c, id);
    if (p !== undefined) return p;
  }
}

const rowStyle = (depth: number) =>
  `display: flex; align-items: center; gap: var(--msp-space-2); min-height: 28px; padding-left: calc(${depth} * var(--msp-space-3))`;

function Eye(props: { shown: ReadonlyState<boolean>; onToggle(): void; title: string }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      title={props.title}
      pressed={props.shown}
      icon={
        <Show when={props.shown} fallback={() => <Icon name="eye-off" />}>
          {() => <Icon name="eye" />}
        </Show>
      }
      onClick={props.onToggle}
    />
  );
}

function GroupRow(props: {
  area: MesoscaleApi;
  info: ReadonlyState<MesoscaleInfo>;
  row: Extract<Row, { kind: 'group' }>;
  open: ReadonlyState<ReadonlySet<string>>;
  onToggleOpen(path: string): void;
}) {
  const { area, info, row } = props;
  const members = groupEntities(row.group);
  const shown = mapState(info, (i) => i.entities.some((e) => members.includes(e.id) && e.visible));
  const hidden = derive([props.open, info], (o, i) => folded(row, o, i));
  const isOpen = mapState(props.open, (o) => o.has(row.group.path));
  return (
    <Show when={mapState(hidden, (h) => !h)}>
      {() => (
        <>
          <div style={rowStyle(row.depth)}>
            <Button
              size="xs"
              variant="ghost"
              title={mapState(isOpen, (o) => (o ? 'Fold' : 'Unfold'))}
              icon={
                <Show when={isOpen} fallback={() => <Icon name="chevron-right" />}>
                  {() => <Icon name="chevron-down" />}
                </Show>
              }
              onClick={() => props.onToggleOpen(row.group.path)}
            />
            <Eye
              title={`Show or hide ${row.group.label}`}
              shown={shown}
              onToggle={() =>
                void area.style({
                  group: row.group.path,
                  visible: !shown.value,
                  particles: info.value.particles,
                } as never)
              }
            />
            <span style="flex: 1; overflow: hidden; white-space: nowrap">{row.group.label}</span>
            <span style={Muted}>{members.length}</span>
          </div>
        </>
      )}
    </Show>
  );
}

function EntityRow(props: {
  area: MesoscaleApi;
  info: ReadonlyState<MesoscaleInfo>;
  row: Extract<Row, { kind: 'entity' }>;
  open: ReadonlyState<ReadonlySet<string>>;
}) {
  const { area, info, row } = props;
  const entity = mapState(info, (i) => i.entities.find((e) => e.id === row.id));
  const hidden = derive([props.open, info], (o, i) => folded(row, o, i));
  const picking = observableState(false);
  const style = (patch: Record<string, unknown>) =>
    void area.style({ entities: String(row.id), particles: info.value.particles, ...patch } as never);
  return (
    <Show when={mapState(hidden, (h) => !h)}>
      {() => (
        <>
          <div style={rowStyle(row.depth + 1)}>
            <Eye
              title="Show or hide"
              shown={mapState(entity, (e) => e?.visible ?? true)}
              onToggle={() => style({ visible: !(entity.value?.visible ?? true) })}
            />
            <button
              type="button"
              aria-label="Color"
              data-tip="Color"
              style={mapState(
                entity,
                (e) =>
                  `width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--msp-color-border); padding: 0; cursor: pointer; background: ${swatch(e)}`,
              )}
              onClick={() => picking.set(!picking.value)}
            />
            <span
              style="flex: 1; overflow: hidden; white-space: nowrap"
              data-tip={mapState(entity, (e) => e?.name ?? '')}
            >
              {mapState(entity, (e) => e?.name ?? '')}
            </span>
            <span style={Muted}>{mapState(entity, (e) => (e?.count ?? 0).toLocaleString('en'))}</span>
          </div>
          <Show when={picking}>
            {() => (
              <div style={`padding-left: calc(${row.depth + 2} * var(--msp-space-3))`}>
                <ColorPicker
                  value={mapState(entity, (e) => e?.color ?? 0xffffff)}
                  onChange={(c) => style({ color: Color.toHexStyle(Color(c)) })}
                />
              </div>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}

function swatch(e: EntityInfo | undefined) {
  if (!e || e.color === undefined) return 'transparent';
  return Color.toHexStyle(e.color);
}
