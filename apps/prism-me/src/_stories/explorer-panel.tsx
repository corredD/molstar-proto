/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  Button,
  type ContextMenuItem,
  flattenTree,
  Icon,
  keepRows,
  keyedState,
  observableState,
  openContextMenu,
  ScrollArea,
  Show,
  TextInput,
} from '@molstar/prism-ui';
import { frameState } from '@molstar/prism-ui/dom/scope';
import { timeout } from '@molstar/prism-ui/dom/scoped';
import { derive } from '@molstar/prism-ui/reactive/state';
import {
  type At,
  EmptyTreeLine,
  filterRows,
  SplitLine,
  TreeView,
  type TreeRowView,
  treeClasses,
  UniformPopover,
} from '../explorer/tree-view.js';
import { ClipShapes, clippable, colorItemsOf, colorable, menuOf, OpenItems } from './fake-menus.js';
import { type GroupBy, type MockNode, ObjectKinds, pathTo } from './fake-scene.js';
import { Properties } from './properties.js';

// The explorer's panel as ui.md §1–4 draw it, over the mock scene: + Open and the filter, the tree (four categories,
// virtualized: a model's thousands of entities cost what a screenful does), a split, the picked row's properties. The
// tree is the app's own view (explorer/tree-view.tsx: Prism UI only, no viewer), over the mock's rows.

/** A row of the tree: a node, flattened, with its depth */
interface Row extends TreeRowView {
  readonly node: MockNode;
}

const classes = treeClasses;

/** The rows a trash removes (Ludo, 2026-10-27): objects, and what was made at a node; not parts */
const Removable: ReadonlySet<string> = new Set([...ObjectKinds, 'clip', 'label', 'distance']);

/** What a story asks of the panel: the scene, what is open and picked, a menu shown at once */
export interface ExplorerPanelProps {
  readonly roots: readonly MockNode[];
  /** Rows opened at first (by key); the way to the picked row opens too. Default: the categories */
  readonly open?: readonly string[];
  readonly picked?: string;
  /** The picked model's grouping (ui.md §4 Group by) */
  readonly groupBy?: GroupBy;
  /** A menu opened as the story shows: the right-click of the picked row, or + Open */
  readonly menu?: 'row' | 'open' | 'clip';
  /** Properties' sections folded at first (the app's way); else open, to be seen */
  readonly folded?: boolean;
  /** The properties' height at first (px; the split is dragged) */
  readonly split?: number;
}

export function ExplorerPanel(props: ExplorerPanelProps) {
  const { roots } = props;
  const opened = new Set(props.open ?? roots.map((r) => r.key));
  if (props.picked) for (const k of pathTo(roots, props.picked, props.groupBy)) opened.add(k);
  const open = observableState<ReadonlySet<string>>(opened);
  const filter = observableState('');
  // the models' groupings (view state, no operation, ui.md §4), by model key: a row follows its own model's
  const groupings = keyedState<string, GroupBy>();
  if (props.groupBy) groupings.set('o:hiv', props.groupBy);
  // the eyes, by key: a row follows its own (the mock's visibility, no operation)
  const shown = keyedState<string, boolean>();
  const picked = observableState<MockNode | undefined>(undefined);
  const pickedKey = derive(picked.asReadonly, (p) => p?.key);

  const keep = keepRows<Row>(
    (r) => r.key,
    (a, b) => a.node === b.node && a.depth === b.depth && a.expanded === b.expanded,
  );
  const rows = derive([open.asReadonly, filter.asReadonly, groupings.key('o:hiv')], (o, f, g) => {
    const text = f.trim();
    const kids = (n: MockNode) =>
      n.children?.(n.key === 'o:hiv' || n.key.startsWith('g:hiv') ? (g ?? 'compartment') : 'compartment');
    // a search looks into every row (opened or not) and keeps the hits with the rows they are in, as Prism's tree does
    const flat = flattenTree(roots, kids, (n) => !!text || o.has(n.key)).map(
      ({ node, depth }): Row => ({
        key: node.key,
        node,
        depth,
        label: node.label,
        ...(node.count !== undefined ? { count: node.count } : {}),
        ...(node.color !== undefined ? { color: node.color } : {}),
        ...(node.visible !== undefined ? { visible: node.visible } : {}),
        ...(node.icon ? { icon: node.icon } : {}),
        category: node.kind === 'category',
        hasChildren: !!node.children,
        expanded: !!text || o.has(node.key),
      }),
    );
    return keep(text ? filterRows(flat, text) : flat);
  });
  const toggle = (key: string) => {
    const next = new Set(open.value);
    if (!next.delete(key)) next.add(key);
    open.set(next);
  };
  const pick = (node: MockNode) => picked.set(node);

  // menus open in the frame around the panel (its theme's tokens), not inside it (its containment would clip them)
  let panelEl: HTMLElement | undefined;
  const menuRoot = () => panelEl?.closest<HTMLElement>('[data-msp-theme]') ?? document.body;
  const menuAt = (at: At, node: MockNode, onClose?: () => void) => {
    pick(node);
    const items = (): ContextMenuItem[] => menuOf(node, () => openContextMenu(menuRoot(), at, ClipShapes));
    openContextMenu(menuRoot(), at, items(), onClose);
  };
  if (props.picked) {
    const key = props.picked;
    const row = rows.value.find((r) => r.key === key);
    if (row) picked.set(row.node);
  }

  // a category's Uniform: its picker (the app's), at its brush
  const uniform = observableState<{ label: string; anchor: HTMLElement } | undefined>(undefined);
  const uniformAt = (row: Row) => {
    const anchor = panelEl?.querySelector<HTMLElement>(
      `[data-tree-key="${CSS.escape(row.key)}"] button[aria-label="Color all of it"]`,
    );
    if (anchor) uniform.set({ label: row.label, anchor });
  };

  // the split: the properties' height, dragged on the line above them or moved by the arrows (tree-view.tsx)
  const height = frameState(props.split ?? 280);

  const panel = (
    <div class={classes.panel} ref={(el: HTMLElement) => (panelEl = el)}>
      <div class={classes.header}>
        <Button
          size="sm"
          icon={<Icon name="plus" />}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openContextMenu(menuRoot(), { x: r.left, y: r.bottom }, OpenItems);
          }}
        >
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
      <Show when={derive(rows, (r) => r.length > 0)} fallback={() => <p class={classes.empty}>{EmptyTreeLine}</p>}>
        {() => (
          <TreeView
            rows={rows}
            picked={pickedKey}
            shown={shown}
            tools={(row) => ({
              color: colorable(row.node),
              clip: clippable(row.node),
              remove: Removable.has(row.node.kind),
              more: !row.category,
            })}
            onPick={(row) => pick(row.node)}
            onToggle={(row) => toggle(row.key)}
            onDblClick={(row) => console.info(`[explorer mock] focus ${row.label}`)}
            onRemove={(row) => console.info(`[explorer mock] remove ${row.label}`)}
            onEye={(row) => {
              const on = !(shown.get(row.key) ?? row.visible !== false);
              shown.set(row.key, on);
              // a category's eye: every object under it
              if (row.category) for (const o of row.node.children?.('compartment') ?? []) shown.set(o.key, on);
            }}
            onTool={(row, which, at, onClose) => {
              pick(row.node);
              // a category's Uniform…: the app's picker at its brush, applied once
              const colors = colorItemsOf(row.node).map((i) =>
                i.id === 'theme-uniform' ? { ...i, run: () => uniformAt(row) } : i,
              );
              openContextMenu(menuRoot(), at, which === 'color' ? colors : ClipShapes, onClose);
            }}
            onMenu={(row, at, onClose) => menuAt(at, row.node, onClose)}
          />
        )}
      </Show>
      <Show when={uniform.asReadonly}>
        {(u) => (
          <UniformPopover
            anchor={u.anchor}
            title={`${u.label}: one color`}
            onClose={(refocus) => {
              uniform.set(undefined);
              // Escape and Apply: the focus back on the brush (Popover's contract), if still there
              if (refocus && u.anchor.isConnected) u.anchor.focus();
            }}
            onApply={(c) => console.info(`[explorer mock] ${u.label}: uniform ${c.toString(16)}`)}
          />
        )}
      </Show>
      <SplitLine height={height} panel={() => panelEl} />
      <div class={classes.properties} style={{ height: derive(height, (h) => `${h}px`) }}>
        <ScrollArea class={classes.fill} contentClass={classes.propertiesContent} edge>
          <Show
            when={derive(picked.asReadonly, (p) => !!p)}
            fallback={() => <p class={classes.empty}>Pick a row to see its properties.</p>}
          >
            {() => (
              <Properties
                picked={picked.asReadonly}
                groupBy={groupings.key('o:hiv')}
                onGroupBy={(g) => groupings.set('o:hiv', g)}
                folded={props.folded}
              />
            )}
          </Show>
        </ScrollArea>
      </div>
    </div>
  ) as HTMLElement;

  // a menu shown with the story (no click needed): at the picked row's place, or under + Open
  if (props.menu) {
    timeout(() => {
      const at = (sel: string) => {
        const r = panel.querySelector(sel)?.getBoundingClientRect();
        return r ? { x: r.left + 48, y: r.bottom } : { x: 48, y: 48 };
      };
      if (props.menu === 'open') openContextMenu(menuRoot(), at('button'), OpenItems);
      else if (picked.value) {
        const p = at('[aria-selected="true"]');
        if (props.menu === 'clip') openContextMenu(menuRoot(), p, ClipShapes);
        else menuAt(p, picked.value);
      }
    }, 50);
  }
  return panel;
}
