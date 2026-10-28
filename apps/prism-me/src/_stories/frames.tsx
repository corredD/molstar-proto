/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, CanvasPlaceholder, type Child, Icon, StatusPill } from '@molstar/prism-ui';
import { installTooltips } from '@molstar/prism-ui/components/tooltip/tooltip';
import { classes } from './_generated/explorer.module.css.js';
import { treeClasses } from '../explorer/tree-view.js';
import { ExplorerPanel, type ExplorerPanelProps } from './explorer-panel.js';

// The mocks' frames: each story in light and dark, wide and narrow, side by side (a subtree's `data-msp-theme`
// re-derives every token under it, as Overview › Foundations › Themes shows), so one look checks all four; and the
// layout of ui.md §1 around the panel.

/** A panel's widths: wide (the dock's default) and narrow (its least) */
export const Widths = { wide: 360, narrow: 260 } as const;

/**
 * The content in light and dark, wide and narrow; `touch`: the row actions shown as `@media (hover: none)` shows them
 * (styling.md §4); `only`: one width (a layout, wider than a panel).
 */
export function Frames(props: {
  render: (width: number) => Child;
  height?: number;
  touch?: boolean;
  widths?: readonly number[];
}) {
  const widths = props.widths ?? [Widths.wide, Widths.narrow];
  return (
    <div class={classes.frames} ref={(el: HTMLElement) => installTooltips(el)}>
      {widths.flatMap((w) =>
        ['light', 'dark'].map((theme) => (
          <div data-msp-theme={theme} class={classes.frame} classList={{ [treeClasses.touch]: !!props.touch }}>
            <span class={classes.caption}>{`${theme} · ${w}px${props.touch ? ' · touch' : ''}`}</span>
            <div style={{ width: `${w}px`, height: `${props.height ?? 640}px` }}>{props.render(w)}</div>
          </div>
        )),
      )}
    </div>
  );
}

/** The explorer's panel in the frames */
export function PanelFrames(props: ExplorerPanelProps & { height?: number; touch?: boolean }) {
  const { height, touch, ...panel } = props;
  return <Frames height={height} touch={touch} render={() => <ExplorerPanel {...panel} />} />;
}

/**
 * ui.md §1: the canvas with its view buttons, the rail's two buttons (the panel, Settings), the panel pinned on the
 * right; `status`: the canvas's status line (a distance's first point, §7).
 */
export function Layout(props: { width: number; panel: ExplorerPanelProps; status?: string }) {
  return (
    <div class={classes.layout} style={{ height: '100%', '--explorer-panel': `${Math.min(360, props.width * 0.4)}px` }}>
      <div class={classes.canvas}>
        <CanvasPlaceholder background="var(--msp-canvas-bg)" />
        <div class={classes.viewButtons}>
          <Button size="sm" variant="ghost" title="Reset the view" icon={<Icon name="scan" />} />
          <Button size="sm" variant="ghost" title="Selection mode" icon={<Icon name="mouse-pointer-click" />} />
          <Button size="sm" variant="ghost" title="Screenshot" icon={<Icon name="camera" />} />
        </div>
        {props.status ? (
          <div class={classes.status}>
            <StatusPill icon={<Icon name="ruler" size={14} />} text={props.status} />
          </div>
        ) : null}
      </div>
      <div class={classes.rail}>
        <Button size="sm" variant="ghost" pressed title="The scene" icon={<Icon name="list-tree" />} />
        <Button size="sm" variant="ghost" title="Settings" icon={<Icon name="settings" />} />
      </div>
      <ExplorerPanel {...props.panel} />
    </div>
  );
}
