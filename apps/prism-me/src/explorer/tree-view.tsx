/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import {
  ActionFooter,
  type Child,
  ColorPicker,
  colorToHex,
  Icon,
  type IconName,
  type KeyedState,
  keyedSelector,
  observableState,
  Popover,
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
 * The color themes a category's Color… offers, by its row's key: those its objects take (`mesoscale.theme`; ui.md §3,
 * Ludo 2026-10-27), the app's and the mock's
 */
export const CategoryThemes: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  'c:structures': [
    ['object', 'By object'],
    ['entity', 'By entity'],
    ['chain', 'By chain'],
    ['uniform', 'Uniform…'],
  ],
  'c:particles': [
    ['object', 'By object'],
    ['entity', 'By entity'],
    ['generate', 'Generate colors'],
    ['zoom', 'By zoom'],
    ['uniform', 'Uniform…'],
  ],
  'c:volumes': [
    ['object', 'By object'],
    ['uniform', 'Uniform…'],
  ],
  'c:meshes': [
    ['object', 'By object'],
    ['uniform', 'Uniform…'],
  ],
};

/**
 * A category's Uniform: Prism's color picker over every object under it (Ludo, 2026-10-27), the color kept here while
 * picked and applied once (one step), not at every move of the picker
 */
export function UniformPopover(props: {
  anchor: HTMLElement;
  title: string;
  onApply(color: number): void;
  onClose(refocus?: boolean): void;
}) {
  const color = observableState(0xffffff);
  // its ⋯ gone from the page (its row scrolled out of a virtual list): closed, not left hanging at no place
  on(document, 'scroll', () => props.anchor.isConnected || props.onClose(), { capture: true, passive: true });
  return (
    <Popover anchor={props.anchor} onClose={props.onClose} title={props.title} aria-label="Uniform color" align="start">
      <ColorPicker value={color.asReadonly} onChange={(c) => color.set(c)} />
      <ActionFooter
        icon="palette"
        label="Apply"
        onApply={() => {
          props.onApply(color.value);
          props.onClose(true);
        }}
      />
    </Popover>
  );
}

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
  /** Its eye is its own: a parent's eye leaves it (a label, a distance, a clip under a row) */
  readonly own?: boolean;
  readonly hasChildren: boolean;
  /** Its children shown */
  readonly expanded: boolean;
  readonly category?: boolean;
  /** Top-level rows only (styling.md §4) */
  readonly icon?: IconName;
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
  /** Eyes set before the scene says so, by key (a row's `visible` otherwise): a drag's preview, a click's flip */
  readonly shown: KeyedState<string, boolean>;
  /** Whether a row has its ⋯ (its right-click) */
  readonly more: (row: R) => boolean;
  onPick(row: R): void;
  onToggle(row: R): void;
  /**
   * Eyes set: a click's (one row) or a drag's along the column (each row passed, in order), on release, all to the first
   * one's new state; their rows and the shown rows under them already previewed in `shown`
   */
  onEyes(rows: readonly R[], visible: boolean): void;
  /** Its right-click, or its ⋯ (under the button) */
  onMenu(row: R, at: At, onClose?: () => void): void;
  /** Its color dot: its colors, as Color… (under the dot) */
  onColor?(row: R, at: At, onClose: () => void): void;
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
        eyeDrag(el, rows, props);
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
          if (!props.more(row)) return;
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
        {row.color !== undefined ? <Dot row={row} props={props} /> : null}
        <span id={nameId} class={classes.label} data-tip-overflow="">
          {row.label}
        </span>
        <span class={classes.count}>{row.count ?? ''}</span>
        <RowActions row={row} off={off} props={props} />
      </div>
    </div>
  );
}

const under = (e: MouseEvent): At => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left, y: r.bottom };
};

/** A row's color dot: a click opens its colors, as Color… (Ludo, 2026-10-28), its hit area larger than the dot */
function Dot<R extends TreeRowView>(p: { row: R; props: TreeViewProps<R> }): Child {
  const { row, props } = p;
  const dot = <span class={classes.swatch} style={{ background: colorToHex(row.color!) }} />;
  const onColor = props.onColor;
  if (!onColor) return dot;
  const open = observableState(false);
  return (
    <button
      type="button"
      class={classes.dot}
      classList={{ [classes.open]: open.asReadonly }}
      data-tip="Colors"
      aria-label="Colors"
      aria-haspopup="menu"
      aria-expanded={derive(open.asReadonly, String)}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        open.set(true);
        onColor(row, under(e), () => open.set(false));
      }}
    >
      {dot}
    </button>
  );
}

/**
 * A row's eye and its ⋯, always in view, each in a column of its own (Ludo, 2026-10-28): a row without one keeps its
 * room, so the columns line up down the tree. The eye's press is the drag's (`eyeDrag`); its click is the keys' (Enter,
 * Space). The ⋯ holds what the row's other tools did (Color…, Add clip…, Remove) with its right-click's items.
 */
function RowActions<R extends TreeRowView>(p: { row: R; off: ReadonlyState<boolean>; props: TreeViewProps<R> }): Child {
  const { row, props } = p;
  const open = observableState(false);
  const eyeTip = derive(p.off, (h) => (h ? 'Show' : 'Hide'));
  return (
    <span class={classes.actions}>
      {row.visible !== undefined ? (
        <button
          type="button"
          class={classes.action}
          data-tree-eye=""
          data-tip={eyeTip}
          aria-label={eyeTip}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            // a pointer's click: its press and release were the drag's, which set it
            if (e.detail === 0) props.onEyes([row], p.off.value);
          }}
        >
          <Show when={p.off} fallback={() => <Icon name="eye" size={14} />}>
            {() => <Icon name="eye-off" size={14} />}
          </Show>
        </button>
      ) : (
        <span class={classes.slot} />
      )}
      {props.more(row) ? (
        <button
          type="button"
          class={classes.action}
          classList={{ [classes.open]: open.asReadonly }}
          data-tip="More"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={derive(open.asReadonly, String)}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            open.set(true);
            props.onMenu(row, under(e), () => open.set(false));
          }}
        >
          <Icon name="ellipsis" size={14} />
        </button>
      ) : (
        <span class={classes.slot} />
      )}
    </span>
  );
}

/**
 * The keys a row's eye sets as shown: its own and those of the rows with an eye shown under it, but those whose eye is
 * their own (a label, a distance, a clip: a parent's eye leaves them)
 */
export function keysUnder(rows: readonly TreeRowView[], i: number): string[] {
  const out = [rows[i].key];
  const depth = rows[i].depth;
  for (let j = i + 1; j < rows.length && rows[j].depth > depth; j++) {
    if (rows[j].visible !== undefined && !rows[j].own) out.push(rows[j].key);
  }
  return out;
}

/**
 * The keys some rows' eyes set as shown (a click's row, a drag's rows): each row's and those shown under it, each once;
 * the rows indexed once, a row under one already set not walked again
 */
export function eyeKeys(rows: readonly TreeRowView[], set: readonly { readonly key: string }[]): string[] {
  const index = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) index.set(rows[i].key, i);
  const keys = new Set<string>();
  for (const row of set) {
    if (keys.has(row.key)) continue;
    const i = index.get(row.key);
    if (i === undefined) keys.add(row.key);
    else for (const key of keysUnder(rows, i)) keys.add(key);
  }
  return [...keys];
}

/** macOS: its Ctrl+click is a right-click */
const Mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

interface EyeDrag<R> {
  /** The eyes' column (its middle), where each move is read, in the tree's root (read at the press: in the page by then) */
  readonly x: number;
  readonly root: Document | ShadowRoot;
  readonly visible: boolean;
  /** The rows at the press, and each one's index (read once a press) */
  readonly rows: readonly R[];
  readonly index: ReadonlyMap<string, number>;
  /** The latest row passed */
  last: number;
  readonly passed: R[];
  /** What `shown` said before the preview, by key: put back on a cancel */
  readonly before: Map<string, boolean | undefined>;
}

/**
 * C4D's eyes (Ludo, 2026-10-28): press an eye and drag along the column, every row passed takes the first one's new
 * state, previewed in `shown` and set once on release (`onEyes`: one step); a cancel (Esc too) puts the eyes back. A
 * fast move's rows between are passed too. Prism's `drag()`, so every way a drag ends ends it (rendering.md §2.4).
 */
function eyeDrag<R extends TreeRowView>(el: HTMLElement, rows: ReadonlyState<readonly R[]>, props: TreeViewProps<R>) {
  const pass = (s: EyeDrag<R>, i: number) => {
    const row = s.rows[i];
    // a row already set (passed, or under one passed) is not set again
    if (row.visible === undefined || s.before.has(row.key)) return;
    s.passed.push(row);
    for (const key of keysUnder(s.rows, i)) {
      if (!s.before.has(key)) s.before.set(key, props.shown.get(key));
      props.shown.set(key, s.visible);
    }
  };
  const indexAt = (s: EyeDrag<R>, target: EventTarget | null, y: number) => {
    // the tree's root (a document, or the shadow root the app is in) says what is under the pointer
    const at = (s.root.elementFromPoint?.(s.x, y) as Element | null | undefined) ?? (target as Element | null);
    const key = at?.closest?.('[data-tree-key]')?.getAttribute('data-tree-key');
    return key === null || key === undefined ? undefined : s.index.get(key);
  };
  const gesture = drag<EyeDrag<R>>(el, {
    start: (e) => {
      // the main button alone (on macOS a Ctrl+click is the context menu's)
      const eye = e.button === 0 && !(e.ctrlKey && Mac) ? (e.target as Element).closest?.('[data-tree-eye]') : null;
      const key = eye?.closest('[data-tree-key]')?.getAttribute('data-tree-key');
      if (!eye || !key) return undefined;
      const all = rows.value;
      const index = new Map<string, number>();
      for (let i = 0; i < all.length; i++) index.set(all[i].key, i);
      const i = index.get(key);
      if (i === undefined) return undefined;
      const r = eye.getBoundingClientRect();
      const visible = !(props.shown.get(key) ?? all[i].visible ?? true);
      const s: EyeDrag<R> = {
        x: r.left + r.width / 2,
        root: el.getRootNode() as Document | ShadowRoot,
        visible,
        rows: all,
        index,
        last: i,
        passed: [],
        before: new Map(),
      };
      pass(s, i);
      return s;
    },
    move: (e, s) => {
      const i = indexAt(s, e.target, e.clientY);
      if (i === undefined || i === s.last) return;
      const step = i > s.last ? 1 : -1;
      for (let j = s.last + step; j !== i + step; j += step) pass(s, j);
      s.last = i;
    },
    end: (s, how) => {
      if (how === 'up') return props.onEyes(s.passed, s.visible);
      for (const [key, v] of s.before) {
        if (v === undefined) props.shown.delete(key);
        else props.shown.set(key, v);
      }
    },
  });
  // Esc cancels it (ui.md §3), its eyes put back
  on(el.ownerDocument, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && gesture.active) gesture.cancel();
  });
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
