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
  'canvas': 'msp-me-explorer-canvas',
  'caption': 'msp-me-explorer-caption',
  'frame': 'msp-me-explorer-frame',
  'frames': 'msp-me-explorer-frames',
  'layout': 'msp-me-explorer-layout',
  'rail': 'msp-me-explorer-rail',
  'status': 'msp-me-explorer-status',
  'viewButtons': 'msp-me-explorer-viewButtons',
} as const;

defineStyles('me/_stories/explorer.module.css', `@layer msp.components {
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
