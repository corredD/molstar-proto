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
  'label': 'msp-mesoscale-controls-label',
  'line': 'msp-mesoscale-controls-line',
  'stack': 'msp-mesoscale-controls-stack',
  'tight': 'msp-mesoscale-controls-tight',
} as const;

defineStyles('mesoscale/controls.module.css', `@layer msp.components {
.msp-mesoscale-controls-stack {
  gap: var(--msp-space-2);
  display: grid;
}

.msp-mesoscale-controls-tight {
  gap: var(--msp-space-1);
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
}
`);
