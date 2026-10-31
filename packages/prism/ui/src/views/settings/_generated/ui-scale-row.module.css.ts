/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from ui-scale-row.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '../../../styles/registry.js';

export const classes = {
  'control': 'msp-settings-ui-scale-row-control',
  'label': 'msp-settings-ui-scale-row-label',
  'row': 'msp-settings-ui-scale-row-row',
  'value': 'msp-settings-ui-scale-row-value',
} as const;

defineStyles('views/settings/ui-scale-row.module.css', `@layer msp.components {
.msp-settings-ui-scale-row-row {
  grid-template-columns: var(--msp-label-width) minmax(0, 1fr);
  align-items: center;
  gap: var(--msp-space-3);
  min-height: var(--msp-control-height);
  display: grid;
}

.msp-settings-ui-scale-row-label {
  min-width: 0;
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-sm);
  white-space: nowrap;
  overflow: hidden;
}

.msp-settings-ui-scale-row-control {
  align-items: center;
  gap: var(--msp-space-2);
  display: flex;
}

.msp-settings-ui-scale-row-value {
  font-variant-numeric: tabular-nums;
  text-align: center;
  min-width: 5ch;
}
}
`);
