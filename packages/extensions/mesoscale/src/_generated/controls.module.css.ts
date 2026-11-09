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
  'copy': 'msp-mesoscale-controls-copy',
  'label': 'msp-mesoscale-controls-label',
  'line': 'msp-mesoscale-controls-line',
  'stack': 'msp-mesoscale-controls-stack',
  'swatch': 'msp-mesoscale-controls-swatch',
  'tight': 'msp-mesoscale-controls-tight',
} as const;

defineStyles('mesoscale/controls.module.css', `@layer msp.components {
.msp-mesoscale-controls-stack {
  gap: var(--msp-space-2);
  grid-template-columns: minmax(0, 1fr);
  display: grid;
}

.msp-mesoscale-controls-tight {
  gap: var(--msp-space-1);
  grid-template-columns: minmax(0, 1fr);
  display: grid;
}

.msp-mesoscale-controls-line {
  align-items: center;
  gap: var(--msp-space-2);
  min-height: var(--msp-control-height);
  display: flex;

  & > :last-child {
    flex: 1;
    min-width: 0;
  }
}

.msp-mesoscale-controls-label {
  width: var(--msp-label-width);
  flex: none;
}

.msp-mesoscale-controls-copy {
  font-family: var(--msp-font-mono);
  font-size: var(--msp-font-size-sm);
  color: var(--msp-color-text-muted);
  user-select: text;
  overflow-wrap: anywhere;
}

.msp-mesoscale-controls-swatch {
  width: var(--msp-space-4);
  height: var(--msp-space-4);
  border-radius: var(--msp-radius-sm);
  display: block;
}
}
`);
