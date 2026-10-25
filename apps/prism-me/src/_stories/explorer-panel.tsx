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
  ScrollArea,
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
import { ClipShapes, clippable, colorItemsOf, colorable, menuOf, OpenItems } from './fake-menus.js';
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
    const kids = (n: MockNode) =>
      n.children?.(n.key === 'o:hiv' || n.key.startsWith('g:hiv') ? (g ?? 'compartment') : 'compartment');
    // a search looks into every row (opened or not) and keeps the hits with the rows they are in, as Prism's tree does
    const flat = flattenTree(roots, kids, (n) => !!text || o.has(n.key)).map(({ node, depth }) => ({
      key: node.key,
      node,
      depth,
    }));
    if (!text) return keep(flat);
    const kept = new Uint8Array(flat.length);
    const above: number[] = [];
    for (let i = 0; i < flat.length; i++) {
      above.length = flat[i].depth;
      if (flat[i].node.label.toLowerCase().includes(text)) {
        kept[i] = 1;
        // its rows above, deepest first, up to one already kept (its own above are too)
        for (let j = above.length - 1; j >= 0 && !kept[above[j]]; j--) kept[above[j]] = 1;
      }
      above.push(i);
    }
    return keep(flat.filter((_, i) => kept[i]));
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
  const pick = (node: MockNode) => picked.set(node);

  // menus open in the frame around the panel (its theme's tokens), not inside it (its containment would clip them)
  let panelEl: HTMLElement | undefined;
  const menuRoot = () => panelEl?.closest<HTMLElement>('[data-msp-theme]') ?? document.body;
  const menuAt = (at: { x: number; y: number }, node: MockNode, onClose?: () => void) => {
    pick(node);
    const items = (): ContextMenuItem[] => menuOf(node, () => openContextMenu(menuRoot(), at, ClipShapes));
    openContextMenu(menuRoot(), at, items(), onClose);
  };
  if (props.picked) {
    const key = props.picked;
    const row = rows.value.find((r) => r.key === key);
    if (row) picked.set(row.node);
  }

  // the split: the properties' height, dragged on the line above them (once a frame, `drag`'s every end path) or moved
  // by the arrows (as the dock's splitter); kept between 80 px and what leaves the tree 80 px (the panel's height read
  // once, at the press or the key)
  const height = frameState(props.split ?? 280);
  const clamp = (h: number) => Math.max(80, Math.min((panelEl?.clientHeight ?? 640) - 160, h));

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
            ref={(l) => {
              list = l;
              // the picked row brought into view, once the list has its height (ui.md §3: the tree shows where it is)
              timeout(() => {
                const key = picked.value?.key;
                const i = key === undefined ? -1 : rows.value.findIndex((r) => r.key === key);
                if (i >= 0) l.scrollToIndex(i);
              }, 0);
            }}
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
                onEye={() => {
                  const off = !(hidden.get(row.key) ?? row.node.visible === false);
                  hidden.set(row.key, off);
                  // a category's eye: every object under it
                  if (row.node.kind === 'category') for (const o of row.node.children?.('compartment') ?? []) hidden.set(o.key, off);
                }}
                onTool={(at, which, onClose) => {
                  pick(row.node);
                  openContextMenu(menuRoot(), at, which === 'color' ? colorItemsOf(row.node) : ClipShapes, onClose);
                }}
                onMenu={(at, onClose) => menuAt(at, row.node, onClose)}
              />
            )}
          </VirtualList>
        )}
      </Show>
      <div
        class={classes.split}
        role="separator"
        aria-orientation="horizontal"
        aria-label="The properties' height"
        aria-valuenow={derive(height, (h) => String(Math.round(h)))}
        tabIndex={0}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          height.offer(clamp(height.value + (e.shiftKey ? 64 : 16) * (e.key === 'ArrowUp' ? 1 : -1)));
        }}
        ref={(el: HTMLElement) =>
          drag(el, {
            start: (e) => ({ y: e.clientY, h: height.value, max: clamp(Number.POSITIVE_INFINITY) }),
            move: (e, s) => height.offer(Math.max(80, Math.min(s.max, s.h - (e.clientY - s.y)))),
          })
        }
      />
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

function TreeRow(props: {
  row: Row;
  nav: TreeNavigation<Row>;
  open: ReadonlyState<boolean>;
  picked: ReadonlyState<boolean>;
  hidden: ReadonlyState<boolean | undefined>;
  onToggle(): void;
  onPick(): void;
  onEye(): void;
  onMenu(at: { x: number; y: number }, onClose?: () => void): void;
  onTool(at: { x: number; y: number }, which: 'color' | 'clip', onClose: () => void): void;
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
      // the pick follows the focus (↑/↓, Home, End: Prism's tree keys move it), as a click, a category too
      onFocus={props.onPick}
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
        <RowActions node={node} off={off} onEye={props.onEye} onMenu={props.onMenu} onTool={props.onTool} />
      </div>
    </div>
  );
}

/**
 * A row's actions, shown on its hover (always on touch, styling.md §4): the brush and the scissors where it has them
 * (ui.md §3 step 3b), its eye (kept while hidden), its ⋯; a category has only its eye
 */
function RowActions(props: {
  node: MockNode;
  off: ReadonlyState<boolean>;
  onEye(): void;
  onMenu(at: { x: number; y: number }, onClose?: () => void): void;
  onTool(at: { x: number; y: number }, which: 'color' | 'clip', onClose: () => void): void;
}): Child {
  // its ⋯ and tools stay shown while their menu is open (styling.md §4)
  const menuOpen = observableState(false);
  const toolOpen = observableState<'color' | 'clip' | undefined>(undefined);
  const category = props.node.kind === 'category';
  const tool = (which: 'color' | 'clip', icon: 'paintbrush' | 'scissors', tip: string) => (
    <button
      type="button"
      class={classes.action}
      classList={{ [classes.keep]: derive(toolOpen.asReadonly, (t) => t === which) }}
      data-tip={tip}
      aria-label={tip}
      aria-haspopup="menu"
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        toolOpen.set(which);
        props.onTool({ x: r.left, y: r.bottom }, which, () => toolOpen.set(undefined));
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
  return (
    <span class={classes.actions}>
      {colorable(props.node) ? tool('color', 'paintbrush', 'Color all of it') : null}
      {clippable(props.node) ? tool('clip', 'scissors', 'Add a clip') : null}
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
      {category ? null : (
      <button
        type="button"
        class={classes.action}
        classList={{ [classes.keep]: menuOpen.asReadonly }}
        data-tip="More"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={derive(menuOpen.asReadonly, String)}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          menuOpen.set(true);
          props.onMenu({ x: r.left, y: r.bottom }, () => menuOpen.set(false));
        }}
      >
        <Icon name="ellipsis" size={14} />
      </button>
      )}
    </span>
  );
}
