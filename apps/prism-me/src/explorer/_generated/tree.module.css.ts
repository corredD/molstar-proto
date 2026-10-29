/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from tree.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '@molstar/prism-ui/styles/registry';

export const classes = {
  'action': 'msp-me-tree-action',
  'actions': 'msp-me-tree-actions',
  'category': 'msp-me-tree-category',
  'count': 'msp-me-tree-count',
  'dot': 'msp-me-tree-dot',
  'empty': 'msp-me-tree-empty',
  'expander': 'msp-me-tree-expander',
  'fill': 'msp-me-tree-fill',
  'filter': 'msp-me-tree-filter',
  'header': 'msp-me-tree-header',
  'item': 'msp-me-tree-item',
  'kind': 'msp-me-tree-kind',
  'label': 'msp-me-tree-label',
  'leaf': 'msp-me-tree-leaf',
  'off': 'msp-me-tree-off',
  'open': 'msp-me-tree-open',
  'panel': 'msp-me-tree-panel',
  'picked': 'msp-me-tree-picked',
  'properties': 'msp-me-tree-properties',
  'propertiesContent': 'msp-me-tree-propertiesContent',
  'row': 'msp-me-tree-row',
  'slot': 'msp-me-tree-slot',
  'split': 'msp-me-tree-split',
  'swatch': 'msp-me-tree-swatch',
  'tree': 'msp-me-tree-tree',
} as const;

defineStyles('me/explorer/tree.module.css', `@layer msp.components {
.msp-me-tree-panel {
  height: 100%;
  min-height: 0;
  padding: 0 var(--msp-panel-inset) var(--msp-panel-inset);
  background: var(--msp-color-panel);
  color: var(--msp-color-text);
  font-size: var(--msp-font-size-sm);
  contain: layout paint;
  flex-direction: column;
  flex: 1 1 0;
  display: flex;
}

.msp-me-tree-header {
  align-items: center;
  gap: var(--msp-space-2);
  padding: var(--msp-space-2) 0;
  display: flex;
}

.msp-me-tree-filter {
  flex: 1;
  min-width: 0;
}

.msp-me-tree-tree {
  --msp-tree-indent: 14px;
  flex: 1 1 0;
  min-height: 0;
}

.msp-me-tree-empty {
  padding: var(--msp-space-4);
  color: var(--msp-color-text-muted);
  margin: 0;
}

.msp-me-tree-item {
  outline: none;
  min-width: 0;
}

.msp-me-tree-item:focus-visible > .msp-me-tree-row {
  box-shadow: inset 0 0 0 2px var(--msp-color-focus-ring);
}

.msp-me-tree-row {
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

.msp-me-tree-picked {
  background: var(--msp-color-control);

  & .msp-me-tree-label {
    color: var(--msp-color-accent);
  }
}

.msp-me-tree-category .msp-me-tree-label {
  font-weight: 600;
}

.msp-me-tree-off .msp-me-tree-label {
  color: var(--msp-color-text-subtle);
}

.msp-me-tree-expander {
  width: max(24px, var(--msp-touch-target, 0px));
  height: max(24px, var(--msp-touch-target, 0px));
  border-radius: var(--msp-radius-sm);
  color: var(--msp-color-text-subtle);
  transition: transform var(--msp-motion-fast) var(--msp-ease);
  flex: none;
  place-items: center;
  display: grid;

  [aria-expanded="true"] > .msp-me-tree-row > & {
    transform: rotate(90deg);
  }

  &:hover {
    color: var(--msp-color-text);
  }
}

.msp-me-tree-leaf {
  visibility: hidden;
}

.msp-me-tree-kind {
  color: var(--msp-color-text-muted);
  flex: none;
}

.msp-me-tree-swatch {
  border-radius: 50%;
  flex: none;
  width: 8px;
  height: 8px;
}

.msp-me-tree-label {
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

.msp-me-tree-count {
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

.msp-me-tree-actions {
  flex: none;
  gap: 1px;
  display: flex;
}

.msp-me-tree-action, .msp-me-tree-slot {
  width: max(24px, var(--msp-touch-target, 0px));
  height: max(24px, var(--msp-touch-target, 0px));
  flex: none;
}

.msp-me-tree-action {
  border-radius: var(--msp-radius-sm);
  color: var(--msp-color-text-muted);
  place-items: center;
  display: grid;

  &:hover, &.msp-me-tree-open {
    background: var(--msp-color-pressed);
    color: var(--msp-color-text);
  }

  &[data-tree-eye] {
    touch-action: none;
  }
}

.msp-me-tree-dot {
  width: 16px;
  height: 16px;
  margin: 0 calc(-1 * var(--msp-space-1));
  cursor: pointer;
  border-radius: 50%;
  flex: none;
  place-items: center;
  display: grid;

  &:hover, &.msp-me-tree-open {
    background: var(--msp-color-pressed);
  }
}

.msp-me-tree-split {
  height: 8px;
  margin: 0 var(--msp-space-2);
  cursor: row-resize;
  touch-action: none;
  background: linear-gradient(var(--msp-color-border), var(--msp-color-border)) center / 100% 1px no-repeat;
  flex: none;
}

.msp-me-tree-properties {
  flex-direction: column;
  flex: none;
  min-height: 0;
  display: flex;
}

.msp-me-tree-fill {
  flex: 1;
  min-height: 0;
}

.msp-me-tree-propertiesContent {
  padding: var(--msp-space-2) var(--msp-inset);
}
}
`);
