/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from track-gutter.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '@molstar/prism-ui/styles/registry';

export const classes = {
  'gutter': 'msp-viewer-track-gutter-gutter',
  'hint': 'msp-viewer-track-gutter-hint',
  'icon': 'msp-viewer-track-gutter-icon',
} as const;

defineStyles('viewer/sequence/track-gutter.module.css', `@layer msp.components {
.msp-viewer-track-gutter-gutter {
  pointer-events: none;
  width: 28px;
  position: absolute;
  top: 8px;
  left: 0;
}

.msp-viewer-track-gutter-icon {
  width: 24px;
  min-height: 24px;
  color: var(--msp-color-text-muted);
  opacity: 0;
  pointer-events: none;
  border-radius: 4px;
  justify-content: center;
  align-items: center;
  margin-left: 4px;
  display: flex;
  position: absolute;
  top: 0;
  left: 0;

  &[data-hover], &[data-active] {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover, &:focus-visible {
    background: var(--msp-color-hover);
    color: var(--msp-color-text);
  }

  &[data-active] {
    color: var(--msp-color-accent);
  }
}

.msp-viewer-track-gutter-icon svg {
  width: 16px;
  height: 16px;
}

@media (hover: none) {
  .msp-viewer-track-gutter-icon {
    opacity: .6;
    pointer-events: auto;

    &[data-active] {
      opacity: 1;
    }
  }
}

.msp-viewer-track-gutter-hint {
  color: var(--msp-color-text-subtle);
  white-space: nowrap;
  pointer-events: auto;
  border-radius: 4px;
  margin-left: 4px;
  padding: 0 2px;
  font-size: 11px;
  position: absolute;
  top: 0;
  left: 0;

  &:hover, &:focus-visible {
    background: var(--msp-color-hover);
    color: var(--msp-color-text);
  }
}
}
`);
