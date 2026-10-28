/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  type Child,
  colorToHex,
  Icon,
  type IconName,
  type KeyedState,
  keyedSelector,
  observableState,
  type ReadonlyState,
  Show,
  VirtualList,
  type VirtualListHandle,
} from '@molstar/prism-ui';
import type { FrameState } from '@molstar/prism-ui/reactive/frame-state';
import { uniqueId } from '@molstar/prism-ui/dom/focus';
import { drag, on, timeout } from '@molstar/prism-ui/dom/scoped';
import { TreeNavigation } from '@molstar/prism-ui/dom/tree-keys';
import { derive } from '@molstar/prism-ui/reactive/state';
import { classes } from './_generated/tree.module.css.js';

// The explorer's tree as ui.md §3 draws it, shared by the app (ui.tsx) and its mock (_stories/explorer-panel.tsx): Prism
// UI only, no viewer, so the story stays pure. `VirtualList` over the rows as shown (a model's thousands of entities cost
// a screenful), `TreeNavigation` for the keys (↑/↓, Home, End, → opens or goes in, ← closes or goes to the parent; the
// pick follows the focus, a category's too), a row's tools at its end on hover (styling.md §4). The rows' look is Prism's
// scene tree's, which prism-ui does not export (tree.module.css).

export { classes as treeClasses };

/** What the tree says while the scene is empty (ui.md §2) */
export const EmptyTreeLine =
  'Drop files here, or + Open: structures (mmCIF, PDB), cellPACK and PetWorld models, particle lists (STAR, TBL, EM, ' +
  'NDJSON, Simularium), maps and tomograms (MRC, REC, ST), meshes (OBJ, PLY, VTP).';

/**
 * The color themes a category's brush offers, by its row's key: those its objects take (`mesoscale.theme`; ui.md §3,
 * Ludo 2026-10-27), the app's and the mock's
 */
export const CategoryThemes: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
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

/** A row as the tree draws it: flat, its depth says where it is */
export interface TreeRowView {
  readonly key: string;
  readonly depth: number;
  readonly label: string;
  /** Atoms, particles, entities: faint after the name */
  readonly count?: string;
  /** Its one color (a dot), where it has one */
  readonly color?: number;
  /** Its eye: whether shown; absent, no eye */
  readonly visible?: boolean;
  readonly hasChildren: boolean;
  /** Its children shown */
  readonly expanded: boolean;
  readonly category?: boolean;
  /** Top-level rows only (styling.md §4) */
  readonly icon?: IconName;
}

/** The tools a row has besides its eye: the brush, the scissors, the trash, the ⋯ (its right-click) */
export interface RowTools {
  readonly color?: boolean;
  readonly clip?: boolean;
  readonly remove?: boolean;
  readonly more?: boolean;
}

export interface At {
  readonly x: number;
  readonly y: number;
}

/** What the tree's owner does with it */
export interface TreeViewHandle {
  /** Brings a row into view, if shown */
  scrollTo(key: string): void;
}

export interface TreeViewProps<R extends TreeRowView> {
  readonly rows: ReadonlyState<readonly R[]>;
  /** The picked row's key */
  readonly picked: ReadonlyState<string | undefined>;
  /** Eyes flipped before the scene says so, by key (a row's `visible` otherwise) */
  readonly shown: KeyedState<string, boolean>;
  readonly tools: (row: R) => RowTools;
  onPick(row: R): void;
  onToggle(row: R): void;
  onEye(row: R): void;
  /** Its trash: what it is removed, one step (an object, a clip, a label, a distance) */
  onRemove?(row: R): void;
  /** The brush's or the scissors' menu, under the button; `onClose` when it closes */
  onTool(row: R, which: 'color' | 'clip', at: At, onClose: () => void): void;
  /** Its right-click, or its ⋯ (under the button) */
  onMenu(row: R, at: At, onClose?: () => void): void;
  /** A double click (the camera on it) */
  onDblClick?(row: R): void;
  /** The pointer over a row, or none */
  onHover?(row: R | undefined): void;
  ref?(handle: TreeViewHandle): void;
}

/** The keys that move the active row (TreeNavigation): the pick follows them, a category's too (ui.md §3) */
const MoveKeys: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function TreeView<R extends TreeRowView>(props: TreeViewProps<R>) {
  const { rows } = props;
  const isPicked = keyedSelector(props.picked);
  let list: VirtualListHandle | undefined;
  const indexOf = (key: string | undefined) => (key === undefined ? -1 : rows.value.findIndex((r) => r.key === key));
  const nav = new TreeNavigation<R>({
    rows: () => rows.value,
    key: (r) => r.key,
    level: (r) => r.depth + 1,
    scrollTo: (i) => list?.scrollToIndex(i),
    selected: () => props.picked.value,
  });
  props.ref?.({
    scrollTo(key) {
      const i = indexOf(key);
      if (i >= 0) list?.scrollToIndex(i);
    },
  });
  return (
    <VirtualList
      items={rows}
      itemKey={(r) => r.key}
      rowHeight={26}
      role="tree"
      aria-label="The scene"
      class={classes.tree}
      contentRef={(el) => {
        nav.tree(el);
        // a key's move picks the row it moved to (after TreeNavigation's own keydown, bound first); a focus alone does
        // not: TreeNavigation gives it back to a row made again (its eye or chevron clicked, a reveal)
        on(el, 'keydown', (e: KeyboardEvent) => {
          if (!e.defaultPrevented || !MoveKeys.has(e.key)) return;
          const i = indexOf(nav.active);
          if (i >= 0) props.onPick(rows.value[i]);
        });
      }}
      ref={(l) => {
        list = l;
        // the picked row brought into view, once the list has its height (ui.md §3: the tree shows where it is)
        timeout(() => {
          const i = indexOf(props.picked.value);
          if (i >= 0) l.scrollToIndex(i);
        }, 0);
      }}
      reveal
    >
      {(row) => <TreeRow row={row} nav={nav} picked={isPicked.key(row.key)} props={props} />}
    </VirtualList>
  );
}

function TreeRow<R extends TreeRowView>(p: {
  row: R;
  nav: TreeNavigation<R>;
  picked: ReadonlyState<boolean>;
  props: TreeViewProps<R>;
}) {
  const { row, props } = p;
  const at = (e: MouseEvent): At => ({ x: e.clientX, y: e.clientY });
  const off = derive(props.shown.key(row.key), (s) => !(s ?? row.visible ?? true));
  const pick = () => props.onPick(row);
  // named by its name alone, not its tools' labels (as Prism's tree)
  const nameId = uniqueId('me-tree-name');
  return (
    <div
      role="treeitem"
      aria-labelledby={nameId}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? String(row.expanded) : undefined}
      aria-selected={derive(p.picked, String)}
      tabIndex={-1}
      class={classes.item}
      ref={p.nav.row(row.key)}
    >
      <div
        data-tree-row=""
        class={classes.row}
        classList={{ [classes.picked]: p.picked, [classes.off]: off, [classes.category]: !!row.category }}
        style={`--msp-tree-depth: ${row.depth}`}
        onClick={pick}
        onDblClick={() => props.onDblClick?.(row)}
        onPointerEnter={() => props.onHover?.(row)}
        onPointerLeave={() => props.onHover?.(undefined)}
        onContextMenu={(e: MouseEvent) => {
          if (!props.tools(row).more) return;
          e.preventDefault();
          props.onMenu(row, at(e));
        }}
      >
        <button
          type="button"
          class={classes.expander}
          classList={{ [classes.leaf]: !row.hasChildren }}
          data-tree-toggle=""
          tabIndex={-1}
          aria-label={row.expanded ? 'Fold' : 'Unfold'}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            props.onToggle(row);
          }}
        >
          <Icon name="chevron-right" size={14} />
        </button>
        {row.icon ? <Icon name={row.icon} size={15} class={classes.kind} /> : null}
        {row.color !== undefined ? <span class={classes.swatch} style={{ background: colorToHex(row.color) }} /> : null}
        <span id={nameId} class={classes.label} data-tip-overflow="">
          {row.label}
        </span>
        <span class={classes.count}>{row.count ?? ''}</span>
        <RowActions row={row} tools={props.tools(row)} off={off} props={props} />
      </div>
    </div>
  );
}

/**
 * A row's tools at its end, shown on its hover or focus, always on touch (styling.md §4): the brush and the scissors
 * where it has them, its eye (kept in view while hidden), its trash (Ludo, 2026-10-27), its ⋯; each kept while its menu
 * is open
 */
function RowActions<R extends TreeRowView>(p: {
  row: R;
  tools: RowTools;
  off: ReadonlyState<boolean>;
  props: TreeViewProps<R>;
}): Child {
  const { row, tools, props } = p;
  const open = observableState<'color' | 'clip' | 'more' | undefined>(undefined);
  const isOpen = (which: 'color' | 'clip' | 'more') => derive(open.asReadonly, (o) => o === which);
  const under = (e: MouseEvent): At => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  };
  const tool = (which: 'color' | 'clip', icon: IconName, tip: string) => (
    <button
      type="button"
      class={classes.action}
      classList={{ [classes.keep]: isOpen(which) }}
      data-tip={tip}
      aria-label={tip}
      aria-haspopup="menu"
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        open.set(which);
        props.onTool(row, which, under(e), () => open.set(undefined));
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
  const eyeTip = derive(p.off, (h) => (h ? 'Show' : 'Hide'));
  return (
    <span class={classes.actions}>
      {tools.color ? tool('color', 'paintbrush', 'Color all of it') : null}
      {tools.clip ? tool('clip', 'scissors', 'Add a clip') : null}
      {row.visible !== undefined ? (
        <button
          type="button"
          class={classes.action}
          classList={{ [classes.keep]: p.off }}
          data-tip={eyeTip}
          aria-label={eyeTip}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            props.onEye(row);
          }}
        >
          <Show when={p.off} fallback={() => <Icon name="eye" size={14} />}>
            {() => <Icon name="eye-off" size={14} />}
          </Show>
        </button>
      ) : null}
      {tools.remove ? (
        <button
          type="button"
          class={classes.action}
          data-tip="Remove"
          aria-label="Remove"
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            props.onRemove?.(row);
          }}
        >
          <Icon name="trash-2" size={14} />
        </button>
      ) : null}
      {tools.more ? (
        <button
          type="button"
          class={classes.action}
          classList={{ [classes.keep]: isOpen('more') }}
          data-tip="More"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={derive(isOpen('more'), String)}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            open.set('more');
            props.onMenu(row, under(e), () => open.set(undefined));
          }}
        >
          <Icon name="ellipsis" size={14} />
        </button>
      ) : null}
    </span>
  );
}

/**
 * The rows a filter keeps (ui.md §1, as Prism's tree): each whose name holds the text, with the rows it is in; a row
 * with no hit under it goes (a category too). One pass over the rows, given all of them open.
 */
export function filterRows<R extends { readonly depth: number; readonly label: string }>(
  rows: readonly R[],
  text: string,
): R[] {
  const t = text.trim().toLowerCase();
  if (!t) return rows.slice();
  const kept = new Uint8Array(rows.length);
  const above: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    above.length = rows[i].depth;
    if (rows[i].label.toLowerCase().includes(t)) {
      kept[i] = 1;
      // its rows above, deepest first, up to one already kept (its own above are too)
      for (let j = above.length - 1; j >= 0 && !kept[above[j]]; j--) kept[above[j]] = 1;
    }
    above[rows[i].depth] = i;
  }
  return rows.filter((_, i) => kept[i]);
}

/**
 * The line between the tree and the properties: dragged (`drag`: once a frame, every end path) or moved by ↑/↓ (16 px,
 * Shift 64), the properties' height kept between 80 px and what leaves the tree 80 px (the panel read at the press)
 */
export function SplitLine(props: { height: FrameState<number>; panel: () => HTMLElement | undefined }) {
  const { height } = props;
  // the panel read at a press or a key, never per move; the range said once known (aria-valuemax)
  const top = observableState<number | undefined>(undefined);
  const max = () => {
    const m = (props.panel()?.clientHeight ?? 640) - 160;
    top.set(m);
    return m;
  };
  const clamp = (h: number, top = max()) => Math.max(80, Math.min(top, h));
  return (
    <div
      class={classes.split}
      role="separator"
      aria-orientation="horizontal"
      aria-label="The properties' height"
      aria-valuenow={derive(height, (h) => String(Math.round(h)))}
      aria-valuemin="80"
      aria-valuemax={derive(top.asReadonly, (t) => (t === undefined ? undefined : String(t)))}
      tabIndex={0}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        height.offer(clamp(height.value + (e.shiftKey ? 64 : 16) * (e.key === 'ArrowUp' ? 1 : -1)));
      }}
      ref={(el: HTMLElement) =>
        drag(el, {
          start: (e) => ({ y: e.clientY, h: height.value, max: max() }),
          move: (e, s) => height.offer(clamp(s.h - (e.clientY - s.y), s.max)),
        })
      }
    />
  );
}
