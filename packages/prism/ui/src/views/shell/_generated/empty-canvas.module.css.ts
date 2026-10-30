/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from empty-canvas.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '../../../styles/registry.js';

export const classes = {
  'empty': 'msp-shell-empty-canvas-empty',
  'fade-in': 'msp-shell-empty-canvas-fade-in',
  'fade-out': 'msp-shell-empty-canvas-fade-out',
  'mark': 'msp-shell-empty-canvas-mark',
  'splash': 'msp-shell-empty-canvas-splash',
} as const;

defineStyles('views/shell/empty-canvas.module.css', `@layer msp.components {
.msp-shell-empty-canvas-empty {
  inset: 0 var(--msp-canvas-right-inset, 0) 0 0;
  pointer-events: none;
  animation: msp-shell-empty-canvas-fade-in .9s var(--msp-ease) both;
  position: absolute;

  &[data-phase="out"] {
    animation: msp-shell-empty-canvas-fade-out .25s var(--msp-ease) forwards;
  }
}

.msp-shell-empty-canvas-splash {
  inset: 0 calc(-1 * var(--msp-canvas-right-inset, 0px)) 0 0;
  animation: msp-shell-empty-canvas-fade-in 1.2s var(--msp-ease) both;
  position: absolute;
}

.msp-shell-empty-canvas-mark {
  left: round(down, calc(50% - calc(85.5px * var(--msp-ui-scale, 1))), 1px);
  top: round(down, calc(50% - calc(33px * var(--msp-ui-scale, 1))), 1px);
  color: var(--msp-color-text-subtle);
  position: absolute;
}

@keyframes msp-shell-empty-canvas-fade-in {
  from {
    opacity: 0;
  }
}

@keyframes msp-shell-empty-canvas-fade-out {
  to {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .msp-shell-empty-canvas-empty {
    animation: none;
  }
}
}
`);
