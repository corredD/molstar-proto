/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  Button,
  type Child,
  colorToHex,
  type ContextMenuItem,
  flattenTree,
  Icon,
  keepRows,
  keyedSelector,
  keyedState,
  observableState,
  openContextMenu,
  type ReadonlyState,
  Show,
  TextInput,
  VirtualList,
  type VirtualListHandle,
} from '@molstar/prism-ui';
import { frameState } from '@molstar/prism-ui/dom/scope';
import { drag, timeout } from '@molstar/prism-ui/dom/scoped';
import { TreeNavigation } from '@molstar/prism-ui/dom/tree-keys';
import { derive } from '@molstar/prism-ui/reactive/state';
import { classes } from './_generated/explorer.module.css.js';
import { ClipShapes, menuOf, OpenItems } from './fake-menus.js';
import { type GroupBy, type MockNode, pathTo } from './fake-scene.js';
import { Properties } from './properties.js';

// The explorer's panel as ui.md §1–4 draw it, over the mock scene: + Open and the filter, the tree (four categories,
// virtualized: a model's thousands of entities cost what a screenful does), a split, the picked row's properties.
// Prism UI only: `VirtualList` over `flattenTree`, `TreeNavigation` for the keys, `Button`, `TextInput`, `Icon`,
// `openContextMenu`, `drag` for the split; the rows' look is Prism's scene tree's (styling.md §4, explorer.module.css).

/** A row of the tree: a node, flattened, with its depth */
interface Row {
  readonly key: string;
  readonly node: MockNode;
  readonly depth: number;
}

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
  const hidden = keyedState<string, boolean>();
  const picked = observableState<MockNode | undefined>(undefined);
  const pickedKey = derive(picked.asReadonly, (p) => p?.key);
  const isPicked = keyedSelector(pickedKey);

  const keep = keepRows<Row>(
    (r) => r.key,
    (a, b) => a.node === b.node && a.depth === b.depth,
  );
  const rows = derive([open.asReadonly, filter.asReadonly, groupings.key('o:hiv')], (o, f, g) => {
    const text = f.trim().toLowerCase();
    const flat = flattenTree(
      roots,
      (n) => n.children?.(n.key === 'o:hiv' || n.key.startsWith('g:hiv') ? (g ?? 'compartment') : 'compartment'),
      (n) => o.has(n.key) || (!!text && n.kind === 'category'),
    ).map(({ node, depth }) => ({ key: node.key, node, depth }));
    return keep(
      text ? flat.filter((r) => r.node.kind === 'category' || r.node.label.toLowerCase().includes(text)) : flat,
    );
  });
  let list: VirtualListHandle | undefined;
  const nav = new TreeNavigation<Row>({
    rows: () => rows.value,
    key: (r) => r.key,
    level: (r) => r.depth + 1,
    scrollTo: (i) => list?.scrollToIndex(i),
    selected: () => picked.value?.key,
  });
  const toggle = (key: string) => {
    const next = new Set(open.value);
    if (!next.delete(key)) next.add(key);
    open.set(next);
  };
  const pick = (node: MockNode) => node.kind !== 'category' && picked.set(node);

  // menus open in the frame around the panel (its theme's tokens), not inside it (its containment would clip them)
  let panelEl: HTMLElement | undefined;
  const menuRoot = () => panelEl?.closest<HTMLElement>('[data-msp-theme]') ?? document.body;
  const menuAt = (at: { x: number; y: number }, node: MockNode) => {
    pick(node);
    const items = (): ContextMenuItem[] => menuOf(node, () => openContextMenu(menuRoot(), at, ClipShapes));
    openContextMenu(menuRoot(), at, items());
  };
  if (props.picked) {
    const key = props.picked;
    const row = rows.value.find((r) => r.key === key);
    if (row) picked.set(row.node);
  }

  // the split: the properties' height, dragged on the line above them (once a frame, `drag`'s every end path)
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
      <Show
        when={derive(rows, (r) => r.length > 0)}
        fallback={() => (
          <p class={classes.empty}>
            Drop files here, or + Open: structures (mmCIF, PDB), cellPACK and PetWorld models, particle lists (STAR,
            TBL, EM, NDJSON, Simularium), maps and tomograms (MRC), meshes (OBJ, PLY, VTP).
          </p>
        )}
      >
        {() => (
          <VirtualList
            items={rows}
            itemKey={(r) => r.key}
            rowHeight={26}
            role="tree"
            aria-label="The scene"
            class={classes.tree}
            contentRef={nav.tree}
            ref={(l) => (list = l)}
            reveal
          >
            {(row) => (
              <TreeRow
                row={row}
                nav={nav}
                open={derive(open.asReadonly, (o) => o.has(row.key))}
                picked={isPicked.key(row.key)}
                hidden={hidden.key(row.key)}
                onToggle={() => toggle(row.key)}
                onPick={() => pick(row.node)}
                onEye={() => hidden.set(row.key, !(hidden.get(row.key) ?? row.node.visible === false))}
                onMenu={(at) => menuAt(at, row.node)}
              />
            )}
          </VirtualList>
        )}
      </Show>
      <div
        class={classes.split}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to size the properties"
        ref={(el: HTMLElement) =>
          drag(el, {
            start: (e) => ({ y: e.clientY, h: height.value }),
            move: (e, s) => height.offer(Math.max(80, s.h - (e.clientY - s.y))),
          })
        }
      />
      <div class={classes.properties} style={{ height: derive(height, (h) => `${h}px`) }}>
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

function TreeRow(props: {
  row: Row;
  nav: TreeNavigation<Row>;
  open: ReadonlyState<boolean>;
  picked: ReadonlyState<boolean>;
  hidden: ReadonlyState<boolean | undefined>;
  onToggle(): void;
  onPick(): void;
  onEye(): void;
  onMenu(at: { x: number; y: number }): void;
}) {
  const { node, depth } = props.row;
  const category = node.kind === 'category';
  const parent = !!node.children;
  const off = derive(props.hidden, (h) => h ?? node.visible === false);
  const at = (e: MouseEvent) => ({ x: e.clientX, y: e.clientY });
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={parent ? props.open : undefined}
      aria-selected={props.picked}
      tabIndex={-1}
      class={classes.item}
      ref={props.nav.row(node.key)}
    >
      <div
        data-tree-row=""
        class={classes.row}
        classList={{ [classes.picked]: props.picked, [classes.off]: off, [classes.category]: category }}
        style={`--msp-tree-depth: ${depth}`}
        onClick={props.onPick}
        onDblClick={() => console.info(`[explorer mock] focus ${node.label}`)}
        onContextMenu={(e: MouseEvent) => {
          if (category) return;
          e.preventDefault();
          props.onMenu(at(e));
        }}
      >
        <button
          type="button"
          class={classes.expander}
          classList={{ [classes.leaf]: !parent }}
          data-tree-toggle=""
          tabIndex={-1}
          aria-label="Expand"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle();
          }}
        >
          <Icon name="chevron-right" size={14} />
        </button>
        {node.icon ? <Icon name={node.icon} size={15} class={classes.kind} /> : null}
        {node.color !== undefined ? (
          <span class={classes.swatch} style={{ background: colorToHex(node.color) }} />
        ) : null}
        <span class={classes.label} data-tip-overflow="">
          {node.label}
        </span>
        <span class={classes.count}>{node.count ?? ''}</span>
        {category ? null : <RowActions node={node} off={off} onEye={props.onEye} onMenu={props.onMenu} />}
      </div>
    </div>
  );
}

/** A row's actions, shown on its hover (always on touch, styling.md §4): its eye (kept while hidden), its ⋯ */
function RowActions(props: {
  node: MockNode;
  off: ReadonlyState<boolean>;
  onEye(): void;
  onMenu(at: { x: number; y: number }): void;
}): Child {
  return (
    <span class={classes.actions}>
      {props.node.visible !== undefined ? (
        <button
          type="button"
          class={classes.action}
          classList={{ [classes.keep]: props.off }}
          data-tip={derive(props.off, (h) => (h ? 'Show' : 'Hide'))}
          aria-label={derive(props.off, (h) => (h ? 'Show' : 'Hide'))}
          onClick={(e) => {
            e.stopPropagation();
            props.onEye();
          }}
        >
          <Show when={props.off} fallback={() => <Icon name="eye" size={14} />}>
            {() => <Icon name="eye-off" size={14} />}
          </Show>
        </button>
      ) : null}
      <button
        type="button"
        class={classes.action}
        data-tip="More"
        aria-label="More"
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          props.onMenu({ x: r.left, y: r.bottom });
        }}
      >
        <Icon name="ellipsis" size={14} />
      </button>
    </span>
  );
}
