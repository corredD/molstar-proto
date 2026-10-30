/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from trajectory-row.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '@molstar/prism-ui/styles/registry';

export const classes = {
  'button': 'msp-viewer-trajectory-row-button',
  'compact': 'msp-viewer-trajectory-row-compact',
  'controls': 'msp-viewer-trajectory-row-controls',
  'range': 'msp-viewer-trajectory-row-range',
  'scrubber': 'msp-viewer-trajectory-row-scrubber',
} as const;

defineStyles('viewer/views/structure/trajectory-row.module.css', `@layer msp.components {
.msp-viewer-trajectory-row-scrubber {
  flex: 1;
  align-items: center;
  gap: 2px;
  min-width: 0;
  display: flex;
}

.msp-viewer-trajectory-row-range {
  min-width: calc(40px * var(--msp-ui-scale, 1));
  height: calc(16px * var(--msp-ui-scale, 1));
  margin: 0 var(--msp-space-1);
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  background: none;
  flex: 1;

  &::-webkit-slider-runnable-track {
    height: calc(2px * var(--msp-ui-scale, 1));
    background: linear-gradient(to right,
      var(--msp-color-text-muted) var(--msp-progress, 0%),
      var(--msp-color-border-strong) var(--msp-progress, 0%));
    border-radius: 1px;
  }

  &::-webkit-slider-thumb {
    width: calc(10px * var(--msp-ui-scale, 1));
    height: calc(10px * var(--msp-ui-scale, 1));
    background: var(--msp-color-text);
    -webkit-appearance: none;
    appearance: none;
    border-radius: 50%;
    margin-top: -4px;
  }

  &::-moz-range-track {
    height: calc(2px * var(--msp-ui-scale, 1));
    background: var(--msp-color-border-strong);
    border-radius: 1px;
  }

  &::-moz-range-progress {
    height: calc(2px * var(--msp-ui-scale, 1));
    background: var(--msp-color-text-muted);
  }

  &::-moz-range-thumb {
    width: calc(10px * var(--msp-ui-scale, 1));
    height: calc(10px * var(--msp-ui-scale, 1));
    background: var(--msp-color-text);
    border: none;
    border-radius: 50%;
  }
}

.msp-viewer-trajectory-row-button {
  width: calc(24px * var(--msp-ui-scale, 1));
  height: calc(24px * var(--msp-ui-scale, 1));
  border-radius: var(--msp-radius-md);
  color: var(--msp-color-text-muted);
  cursor: pointer;
  background: none;
  border: none;
  flex: none;
  place-items: center;
  padding: 0;
  display: inline-grid;

  &:hover, &[aria-pressed="true"] {
    background: var(--msp-color-control);
    color: var(--msp-color-text);
  }
}

.msp-viewer-trajectory-row-compact .msp-viewer-trajectory-row-button {
  width: calc(22px * var(--msp-ui-scale, 1));
  height: calc(22px * var(--msp-ui-scale, 1));
}

.msp-viewer-trajectory-row-controls {
  gap: var(--msp-space-2);
  display: grid;
}
}
`);
