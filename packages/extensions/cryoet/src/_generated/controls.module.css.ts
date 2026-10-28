/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from controls.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '@molstar/prism-ui/styles/registry';

export const classes = {
  'hint': 'msp-cryoet-controls-hint',
  'inline': 'msp-cryoet-controls-inline',
  'label': 'msp-cryoet-controls-label',
  'line': 'msp-cryoet-controls-line',
  'name': 'msp-cryoet-controls-name',
  'stack': 'msp-cryoet-controls-stack',
  'tight': 'msp-cryoet-controls-tight',
  'tools': 'msp-cryoet-controls-tools',
} as const;

defineStyles('cryoet/controls.module.css', `@layer msp.components {
.msp-cryoet-controls-stack {
  gap: var(--msp-space-2);
  display: grid;
}

.msp-cryoet-controls-tight {
  gap: var(--msp-space-1);
  display: grid;
}

.msp-cryoet-controls-line {
  align-items: center;
  gap: var(--msp-space-2);
  min-height: var(--msp-control-height);
  display: flex;

  & > :last-child {
    flex: 1;
    min-width: 0;
  }
}

.msp-cryoet-controls-tools {
  align-items: center;
  gap: var(--msp-space-1);
  min-height: var(--msp-control-height);
  display: flex;
}

.msp-cryoet-controls-label {
  width: var(--msp-label-width);
  color: var(--msp-color-text-muted);
  flex: none;
}

.msp-cryoet-controls-name {
  white-space: nowrap;
  min-width: 0;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  flex: 1;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-cryoet-controls-hint {
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-xs);
  margin: 0;
}

.msp-cryoet-controls-inline {
  gap: var(--msp-space-1);
  padding: var(--msp-space-1) var(--msp-space-2);
  border-radius: var(--msp-radius-md);
  background: color-mix(in oklab, var(--msp-color-control), transparent 40%);
  box-shadow: inset 0 0 0 1px var(--msp-glass-edge);
  display: grid;
}
}
`);
