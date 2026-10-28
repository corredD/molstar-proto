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
  'hint': 'msp-me-explorer-hint',
  'layout': 'msp-me-explorer-layout',
  'line': 'msp-me-explorer-line',
  'lineLabel': 'msp-me-explorer-lineLabel',
  'rail': 'msp-me-explorer-rail',
  'stack': 'msp-me-explorer-stack',
  'status': 'msp-me-explorer-status',
  'title': 'msp-me-explorer-title',
  'viewButtons': 'msp-me-explorer-viewButtons',
} as const;

defineStyles('me/_stories/explorer.module.css', `@layer msp.components {
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
