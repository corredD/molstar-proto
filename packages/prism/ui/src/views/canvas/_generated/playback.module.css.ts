/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from playback.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '../../../styles/registry.js';

export const classes = {
  'bar': 'msp-canvas-playback-bar',
  'bare': 'msp-canvas-playback-bare',
  'card': 'msp-canvas-playback-card',
  'counter': 'msp-canvas-playback-counter',
  'deck': 'msp-canvas-playback-deck',
  'description': 'msp-canvas-playback-description',
  'descriptionContent': 'msp-canvas-playback-descriptionContent',
  'dot': 'msp-canvas-playback-dot',
  'dots': 'msp-canvas-playback-dots',
  'lead': 'msp-canvas-playback-lead',
  'list': 'msp-canvas-playback-list',
  'listIndex': 'msp-canvas-playback-listIndex',
  'listRow': 'msp-canvas-playback-listRow',
  'listRows': 'msp-canvas-playback-listRows',
  'listRowsContent': 'msp-canvas-playback-listRowsContent',
  'plain': 'msp-canvas-playback-plain',
  'position': 'msp-canvas-playback-position',
  'rowTitle': 'msp-canvas-playback-rowTitle',
  'scrubber': 'msp-canvas-playback-scrubber',
  'snapshots': 'msp-canvas-playback-snapshots',
  'time': 'msp-canvas-playback-time',
  'title': 'msp-canvas-playback-title',
  'trajectoryLabel': 'msp-canvas-playback-trajectoryLabel',
} as const;

defineStyles('views/canvas/playback.module.css', `@layer msp.components {
.msp-canvas-playback-card {
  font-size: var(--msp-font-size-sm);
  border-radius: var(--msp-radius-lg);
  background: var(--msp-glass-bg);
  box-shadow: var(--msp-glass-shadow);
  -webkit-backdrop-filter: var(--msp-glass-filter);
}

.msp-canvas-playback-deck {
  width: fit-content;
  max-width: 100%;
  font-size: var(--msp-font-size-sm);
  border-radius: var(--msp-radius-lg);
  background: var(--msp-glass-bg);
  box-shadow: var(--msp-glass-shadow);
  -webkit-backdrop-filter: var(--msp-glass-filter);
  grid-template-columns: minmax(0, 1fr);
  justify-self: start;
  display: grid;
  overflow: clip;

  &:not(:has([data-row])) {
    display: none;
  }

  & [data-row] {
    box-shadow: 0 -1px 0 var(--msp-color-border);
  }

  & .msp-canvas-playback-bar {
    height: calc(32px * var(--msp-ui-scale, 1));
    padding: 0 var(--msp-space-1);
    gap: 0;
  }

  & :is(.msp-canvas-playback-rowTitle, .msp-canvas-playback-trajectoryLabel) {
    max-width: calc(168px * var(--msp-ui-scale, 1));
    padding: 0 var(--msp-space-2);
    flex: 0 auto;
    font-weight: 500;
  }

  & :is(.msp-canvas-playback-rowTitle, .msp-canvas-playback-position) {
    margin-right: auto;
  }

  & :is(.msp-canvas-playback-counter, .msp-canvas-playback-position, .msp-canvas-playback-time) {
    font-size: var(--msp-font-size-xs);
  }

  & .msp-canvas-playback-counter {
    min-width: calc(36px * var(--msp-ui-scale, 1));
  }

  & .msp-canvas-playback-time {
    min-width: calc(56px * var(--msp-ui-scale, 1));
    padding-right: var(--msp-space-1);
  }

  & .msp-canvas-playback-scrubber {
    flex: 1 0 96px;
  }
}

.msp-canvas-playback-bare {
  min-width: 0;
  min-height: 0;
  font-size: var(--msp-font-size-sm);
  flex-direction: column;
  flex: 1 1 0;
  display: flex;

  & > .msp-canvas-playback-snapshots {
    flex: 1 1 0;
  }

  & .msp-canvas-playback-description {
    flex: 1 1 0;
    max-height: none;
  }
}

.msp-canvas-playback-snapshots {
  flex-direction: column;
  min-height: 0;
  display: flex;
}

.msp-canvas-playback-bar {
  align-items: center;
  gap: var(--msp-space-1);
  height: calc(34px * var(--msp-ui-scale, 1));
  padding: 0 var(--msp-space-2);
  display: flex;

  & button {
    color: var(--msp-color-text-muted);

    &:hover:not(:disabled) {
      color: var(--msp-color-text);
    }

    &[aria-pressed="true"] {
      color: var(--msp-color-accent);
    }
  }

  & svg {
    width: calc(16px * var(--msp-ui-scale, 1));
    height: calc(16px * var(--msp-ui-scale, 1));
  }
}

.msp-canvas-playback-lead {
  width: calc(24px * var(--msp-ui-scale, 1));
  height: calc(24px * var(--msp-ui-scale, 1));
  color: var(--msp-color-text-muted);
  flex: none;
  place-items: center;
  display: grid;
}

.msp-canvas-playback-counter {
  min-width: calc(44px * var(--msp-ui-scale, 1));
  font-size: var(--msp-font-size-sm);
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--msp-color-text-muted);
}

.msp-canvas-playback-title {
  min-width: 0;
  padding: 0 var(--msp-space-2) 0 var(--msp-space-3);
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  white-space: nowrap;
  flex: 1;
  font-weight: 600;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-canvas-playback-description {
  max-height: 40cqh;
}

.msp-canvas-playback-descriptionContent {
  min-width: 0;
  padding: 0 var(--msp-space-4) var(--msp-space-4);
  font-size: var(--msp-font-size-sm);
  overflow-wrap: anywhere;
}

.msp-canvas-playback-plain {
  white-space: pre-wrap;
  margin: 0;
  line-height: 1.5;
}

.msp-canvas-playback-scrubber {
  min-width: calc(40px * var(--msp-ui-scale, 1));
  height: calc(16px * var(--msp-ui-scale, 1));
  margin: 0 var(--msp-space-2);
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
    border-radius: 1px;
  }

  &::-moz-range-thumb {
    width: calc(10px * var(--msp-ui-scale, 1));
    height: calc(10px * var(--msp-ui-scale, 1));
    background: var(--msp-color-text);
    border: 0;
    border-radius: 50%;
  }

  &:focus-visible {
    outline: 2px solid var(--msp-color-focus-ring);
    outline-offset: 2px;
    border-radius: var(--msp-radius-sm);
  }
}

.msp-canvas-playback-rowTitle {
  min-width: 0;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  white-space: nowrap;
  flex: 1;
  font-weight: 600;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-canvas-playback-time {
  min-width: calc(64px * var(--msp-ui-scale, 1));
  color: var(--msp-color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
  flex: none;
}

.msp-canvas-playback-trajectoryLabel {
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  white-space: nowrap;
  font-weight: 600;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-canvas-playback-dots {
  margin-right: var(--msp-space-2);
  align-items: center;
  display: flex;
}

.msp-canvas-playback-dot {
  width: calc(14px * var(--msp-ui-scale, 1));
  height: calc(24px * var(--msp-ui-scale, 1));
  place-items: center;
  display: grid;

  &:before {
    content: "";
    width: calc(6px * var(--msp-ui-scale, 1));
    height: calc(6px * var(--msp-ui-scale, 1));
    background: var(--msp-color-border-strong);
    border-radius: 50%;
  }

  &:hover:before {
    background: var(--msp-color-text-muted);
  }

  &[aria-selected="true"]:before {
    background: var(--msp-color-text);
  }
}

.msp-canvas-playback-position {
  height: calc(24px * var(--msp-ui-scale, 1));
  white-space: nowrap;
  padding: 0 var(--msp-space-2);
  border-radius: var(--msp-radius-md);
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-sm);
  font-variant-numeric: tabular-nums;
  flex: none;

  &:hover, &[aria-expanded="true"] {
    background: var(--msp-color-hover);
    color: var(--msp-color-text);
  }
}

.msp-canvas-playback-list {
  gap: var(--msp-space-2);
  padding: 0 var(--msp-space-2) var(--msp-space-2);
  display: grid;
}

.msp-canvas-playback-listRows {
  max-height: calc(220px * var(--msp-ui-scale, 1));
}

.msp-canvas-playback-listRowsContent {
  grid-template-columns: minmax(0, 1fr);
  display: grid;
}

.msp-canvas-playback-listRow {
  grid-template-columns: calc(24px * var(--msp-ui-scale, 1)) 1fr;
  align-items: center;
  gap: var(--msp-space-2);
  height: calc(26px * var(--msp-ui-scale, 1));
  padding: 0 var(--msp-space-2);
  border-radius: var(--msp-radius-md);
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-sm);
  text-align: left;
  display: grid;

  &:hover {
    background: var(--msp-color-hover);
    color: var(--msp-color-text);
  }

  &[aria-selected="true"] {
    color: var(--msp-color-text);
    font-weight: 600;
  }
}

.msp-canvas-playback-listIndex {
  color: var(--msp-color-text-subtle);
  font-size: var(--msp-font-size-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
}
`);
