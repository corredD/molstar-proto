/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from properties.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '@molstar/prism-ui/styles/registry';

export const classes = {
  'fit': 'msp-me-properties-fit',
  'hint': 'msp-me-properties-hint',
  'inline': 'msp-me-properties-inline',
  'itemName': 'msp-me-properties-itemName',
  'kind': 'msp-me-properties-kind',
  'line': 'msp-me-properties-line',
  'lineLabel': 'msp-me-properties-lineLabel',
  'name': 'msp-me-properties-name',
  'stack': 'msp-me-properties-stack',
  'tight': 'msp-me-properties-tight',
  'title': 'msp-me-properties-title',
  'tools': 'msp-me-properties-tools',
  'use': 'msp-me-properties-use',
} as const;

defineStyles('me/explorer/properties.module.css', `@layer msp.components {
.msp-me-properties-stack {
  gap: var(--msp-space-2);
  grid-template-columns: minmax(0, 1fr);
  display: grid;
}

.msp-me-properties-tight {
  gap: var(--msp-space-1);
  grid-template-columns: minmax(0, 1fr);
  display: grid;
}

.msp-me-properties-title {
  align-items: baseline;
  gap: var(--msp-space-2);
  min-width: 0;
  display: flex;
}

.msp-me-properties-name {
  white-space: nowrap;
  min-width: 3ch;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  flex: 0 auto;
  font-weight: 600;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-me-properties-hint {
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-xs);
}

.msp-me-properties-kind {
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-xs);
  white-space: nowrap;
  flex: none;
}

.msp-me-properties-line {
  align-items: center;
  gap: var(--msp-space-2);
  min-height: var(--msp-control-height);
  display: flex;

  & > :last-child {
    flex: 1;
    min-width: 0;
  }
}

.msp-me-properties-tools {
  align-items: center;
  gap: var(--msp-space-1);
  min-height: var(--msp-control-height);
  flex-wrap: wrap;
  display: flex;
}

.msp-me-properties-lineLabel {
  width: var(--msp-label-width);
  color: var(--msp-color-text-muted);
  flex: none;
}

.msp-me-properties-itemName {
  white-space: nowrap;
  min-width: 0;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  flex: 1;
  font-weight: 500;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-me-properties-inline {
  gap: var(--msp-space-1);
  padding: var(--msp-space-1) var(--msp-space-2);
  border-radius: var(--msp-radius-md);
  background: color-mix(in oklab, var(--msp-color-control), transparent 40%);
  box-shadow: inset 0 0 0 1px var(--msp-glass-edge);
  grid-template-columns: minmax(0, 1fr);
  display: grid;
}

.msp-me-properties-fit {
  min-width: 0;
  max-width: 100%;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  justify-content: flex-start;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-me-properties-use {
  align-items: center;
  gap: var(--msp-space-1);
  min-height: var(--msp-control-height);
  display: flex;

  & > :first-child {
    flex: 1;
  }
}
}
`);
