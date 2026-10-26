/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from explorer.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '@molstar/prism-ui/styles/registry';

export const classes = {
  'action': 'msp-me-explorer-action',
  'actions': 'msp-me-explorer-actions',
  'canvas': 'msp-me-explorer-canvas',
  'caption': 'msp-me-explorer-caption',
  'category': 'msp-me-explorer-category',
  'count': 'msp-me-explorer-count',
  'empty': 'msp-me-explorer-empty',
  'expander': 'msp-me-explorer-expander',
  'fill': 'msp-me-explorer-fill',
  'filter': 'msp-me-explorer-filter',
  'frame': 'msp-me-explorer-frame',
  'frames': 'msp-me-explorer-frames',
  'header': 'msp-me-explorer-header',
  'hint': 'msp-me-explorer-hint',
  'item': 'msp-me-explorer-item',
  'keep': 'msp-me-explorer-keep',
  'kind': 'msp-me-explorer-kind',
  'label': 'msp-me-explorer-label',
  'layout': 'msp-me-explorer-layout',
  'leaf': 'msp-me-explorer-leaf',
  'line': 'msp-me-explorer-line',
  'lineLabel': 'msp-me-explorer-lineLabel',
  'off': 'msp-me-explorer-off',
  'panel': 'msp-me-explorer-panel',
  'picked': 'msp-me-explorer-picked',
  'properties': 'msp-me-explorer-properties',
  'propertiesContent': 'msp-me-explorer-propertiesContent',
  'rail': 'msp-me-explorer-rail',
  'row': 'msp-me-explorer-row',
  'split': 'msp-me-explorer-split',
  'stack': 'msp-me-explorer-stack',
  'status': 'msp-me-explorer-status',
  'swatch': 'msp-me-explorer-swatch',
  'title': 'msp-me-explorer-title',
  'touch': 'msp-me-explorer-touch',
  'tree': 'msp-me-explorer-tree',
  'viewButtons': 'msp-me-explorer-viewButtons',
} as const;

defineStyles('me/_stories/explorer.module.css', `@layer msp.components {
.msp-me-explorer-panel {
  height: 100%;
  min-height: 0;
  padding: 0 var(--msp-panel-inset) var(--msp-panel-inset);
  background: var(--msp-color-panel);
  color: var(--msp-color-text);
  font-size: var(--msp-font-size-sm);
  contain: layout paint;
  flex-direction: column;
  display: flex;
}

.msp-me-explorer-header {
  align-items: center;
  gap: var(--msp-space-2);
  padding: var(--msp-space-2) 0;
  display: flex;
}

.msp-me-explorer-filter {
  flex: 1;
  min-width: 0;
}

.msp-me-explorer-tree {
  --msp-tree-indent: 14px;
  flex: 1 1 0;
  min-height: 0;
}

.msp-me-explorer-empty {
  padding: var(--msp-space-4);
  color: var(--msp-color-text-muted);
  margin: 0;
}

.msp-me-explorer-item {
  outline: none;
  min-width: 0;
}

.msp-me-explorer-item:focus-visible > .msp-me-explorer-row {
  box-shadow: inset 0 0 0 2px var(--msp-color-focus-ring);
}

.msp-me-explorer-row {
  align-items: center;
  gap: var(--msp-space-2);
  min-width: 0;
  height: max(26px, var(--msp-touch-target, 0px));
  padding: 0 var(--msp-space-1) 0
    calc(var(--msp-space-1) + var(--msp-tree-depth, 0) * var(--msp-tree-indent, var(--msp-icon-sm)));
  border-radius: var(--msp-radius-md);
  cursor: default;
  user-select: none;
  display: flex;

  &:hover {
    background: var(--msp-color-hover);
  }
}

.msp-me-explorer-picked {
  background: var(--msp-color-control);

  & .msp-me-explorer-label {
    color: var(--msp-color-accent);
  }
}

.msp-me-explorer-category .msp-me-explorer-label {
  font-weight: 600;
}

.msp-me-explorer-off .msp-me-explorer-label {
  color: var(--msp-color-text-subtle);
}

.msp-me-explorer-expander {
  width: max(24px, var(--msp-touch-target, 0px));
  height: max(24px, var(--msp-touch-target, 0px));
  border-radius: var(--msp-radius-sm);
  color: var(--msp-color-text-subtle);
  transition: transform var(--msp-motion-fast) var(--msp-ease);
  flex: none;
  place-items: center;
  display: grid;

  [aria-expanded="true"] > .msp-me-explorer-row > & {
    transform: rotate(90deg);
  }

  &:hover {
    color: var(--msp-color-text);
  }
}

.msp-me-explorer-leaf {
  visibility: hidden;
}

.msp-me-explorer-kind {
  color: var(--msp-color-text-muted);
  flex: none;
}

.msp-me-explorer-swatch {
  border-radius: 50%;
  flex: none;
  width: 8px;
  height: 8px;
}

.msp-me-explorer-label {
  white-space: nowrap;
  min-width: 3ch;
  max-width: 60%;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  flex: 0 auto;
  font-weight: 500;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-me-explorer-count {
  min-width: 0;
  color: var(--msp-color-text-subtle);
  font-size: var(--msp-font-size-xs);
  white-space: nowrap;
  text-align: end;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  flex: 1;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-me-explorer-actions {
  flex: none;
  gap: 1px;
  display: flex;
}

.msp-me-explorer-action {
  width: max(24px, var(--msp-touch-target, 0px));
  height: max(24px, var(--msp-touch-target, 0px));
  border-radius: var(--msp-radius-sm);
  color: var(--msp-color-text-muted);
  opacity: 0;
  place-items: center;
  display: grid;

  @media (hover: none) {
    opacity: 1;
  }

  .msp-me-explorer-row:hover &, &:focus-visible, .msp-me-explorer-touch & {
    opacity: 1;
  }

  &:hover {
    background: var(--msp-color-pressed);
    color: var(--msp-color-text);
  }
}

.msp-me-explorer-keep {
  opacity: 1;
}

.msp-me-explorer-split {
  height: 8px;
  margin: 0 var(--msp-space-2);
  cursor: row-resize;
  touch-action: none;
  background: linear-gradient(var(--msp-color-border), var(--msp-color-border)) center / 100% 1px no-repeat;
  flex: none;
}

.msp-me-explorer-properties {
  flex-direction: column;
  flex: none;
  min-height: 0;
  display: flex;
}

.msp-me-explorer-fill {
  flex: 1;
  min-height: 0;
}

.msp-me-explorer-propertiesContent {
  padding: var(--msp-space-2) var(--msp-inset);
}

.msp-me-explorer-stack {
  gap: var(--msp-space-2);
  display: grid;
}

.msp-me-explorer-title {
  align-items: baseline;
  gap: var(--msp-space-2);
  min-width: 0;
  display: flex;
}

.msp-me-explorer-hint {
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-xs);
}

.msp-me-explorer-line {
  align-items: center;
  gap: var(--msp-space-2);
  min-height: var(--msp-control-height);
  display: flex;

  & > :last-child {
    flex: 1;
    min-width: 0;
  }
}

.msp-me-explorer-lineLabel {
  width: var(--msp-label-width);
  color: var(--msp-color-text-muted);
  flex: none;
}

.msp-me-explorer-frames {
  gap: var(--msp-space-5);
  padding: var(--msp-space-5);
  flex-wrap: wrap;
  align-items: flex-start;
  display: flex;
}

.msp-me-explorer-frame {
  gap: var(--msp-space-2);
  padding: var(--msp-space-3);
  border-radius: var(--msp-radius-lg);
  background: var(--msp-color-bg);
  color: var(--msp-color-text);
  display: grid;
}

.msp-me-explorer-caption {
  color: var(--msp-color-text-subtle);
  font-size: var(--msp-font-size-xs);
}

.msp-me-explorer-layout {
  grid-template-columns: 1fr auto var(--explorer-panel);
  border-radius: var(--msp-radius-md);
  display: grid;
  position: relative;
  overflow: hidden;
}

.msp-me-explorer-canvas {
  min-width: 0;
  position: relative;
}

.msp-me-explorer-viewButtons {
  left: var(--msp-canvas-edge);
  bottom: var(--msp-canvas-edge);
  gap: var(--msp-space-1);
  padding: var(--msp-space-1);
  border-radius: var(--msp-radius-md);
  background: var(--msp-glass-bg);
  box-shadow: 0 0 0 1px var(--msp-glass-edge);
  display: flex;
  position: absolute;
}

.msp-me-explorer-status {
  left: 50%;
  bottom: var(--msp-canvas-edge);
  position: absolute;
  transform: translateX(-50%);
}

.msp-me-explorer-rail {
  align-content: start;
  gap: var(--msp-space-1);
  padding: var(--msp-space-2) var(--msp-space-1);
  background: var(--msp-color-panel);
  display: grid;
}
}
`);
