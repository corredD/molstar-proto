/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

// Generated from extra-controls.module.css by scripts/css.mjs; do not edit.

import { defineStyles } from '../../../styles/registry.js';

export const classes = {
  'check': 'msp-params-extra-controls-check',
  'chevron': 'msp-params-extra-controls-chevron',
  'curve': 'msp-params-extra-controls-curve',
  'field': 'msp-params-extra-controls-field',
  'fieldContent': 'msp-params-extra-controls-fieldContent',
  'graph': 'msp-params-extra-controls-graph',
  'graphArea': 'msp-params-extra-controls-graphArea',
  'graphAt': 'msp-params-extra-controls-graphAt',
  'graphEditor': 'msp-params-extra-controls-graphEditor',
  'graphFoot': 'msp-params-extra-controls-graphFoot',
  'graphHint': 'msp-params-extra-controls-graphHint',
  'grid': 'msp-params-extra-controls-grid',
  'interval': 'msp-params-extra-controls-interval',
  'intervalRange': 'msp-params-extra-controls-intervalRange',
  'intervalTrack': 'msp-params-extra-controls-intervalTrack',
  'intervalValue': 'msp-params-extra-controls-intervalValue',
  'matrix': 'msp-params-extra-controls-matrix',
  'option': 'msp-params-extra-controls-option',
  'options': 'msp-params-extra-controls-options',
  'optionsContent': 'msp-params-extra-controls-optionsContent',
  'point': 'msp-params-extra-controls-point',
  'spark': 'msp-params-extra-controls-spark',
  'strip': 'msp-params-extra-controls-strip',
  'stripName': 'msp-params-extra-controls-stripName',
  'under': 'msp-params-extra-controls-under',
  'vec': 'msp-params-extra-controls-vec',
} as const;

defineStyles('components/params/extra-controls.module.css', `@layer msp.components {
.msp-params-extra-controls-field {
  align-items: center;
  gap: var(--msp-space-2);
  width: 100%;
  min-width: 0;
  height: calc(24px * var(--msp-ui-scale, 1));
  padding: 0 var(--msp-space-2) 0 var(--msp-space-3);
  border-radius: var(--msp-radius-md);
  background: var(--msp-color-control);
  box-shadow: inset 0 0 0 1px var(--msp-field-edge);
  color: var(--msp-color-text);
  font-size: var(--msp-font-size-sm);
  text-align: left;
  display: flex;

  &:hover, &[aria-expanded="true"] {
    background: var(--msp-color-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--msp-color-focus-ring);
    outline-offset: -2px;
  }
}

.msp-params-extra-controls-fieldContent {
  align-items: center;
  gap: var(--msp-space-2);
  min-width: 0;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  white-space: nowrap;
  flex: 1;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  display: flex;
  overflow: hidden;
}

.msp-params-extra-controls-chevron {
  color: var(--msp-color-text-muted);
  transition: transform var(--msp-motion-fast) var(--msp-ease);
  flex: none;

  [aria-expanded="true"] > & {
    transform: rotate(180deg);
  }
}

.msp-params-extra-controls-under {
  margin: var(--msp-space-1) 0 var(--msp-space-1);
  padding: var(--msp-space-1);
  border-radius: var(--msp-radius-md);
  background: color-mix(in oklab, var(--msp-color-control), transparent 40%);
  box-shadow: inset 0 0 0 1px var(--msp-glass-edge);
}

.msp-params-extra-controls-options {
  max-height: calc(240px * var(--msp-ui-scale, 1));
}

.msp-params-extra-controls-optionsContent {
  display: grid;
}

.msp-params-extra-controls-option {
  align-items: center;
  gap: var(--msp-space-2);
  min-height: calc(26px * var(--msp-ui-scale, 1));
  padding: 0 var(--msp-space-2) 0 var(--msp-space-3);
  border-radius: var(--msp-radius-sm);
  color: var(--msp-color-text-muted);
  font-size: var(--msp-font-size-sm);
  text-align: left;
  display: flex;

  & > span:first-child:not(.msp-params-extra-controls-strip) {
    flex: 1;
  }

  &:hover, &:focus-visible {
    background: var(--msp-color-hover);
    color: var(--msp-color-text);
    outline: none;
  }

  &[aria-selected="true"] {
    color: var(--msp-color-accent);
    font-weight: 600;
  }
}

.msp-params-extra-controls-check {
  visibility: hidden;
  flex: none;
  margin-left: auto;

  [aria-selected="true"] > & {
    visibility: visible;
  }
}

.msp-params-extra-controls-vec {
  gap: var(--msp-space-1);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;
  display: grid;
}

.msp-params-extra-controls-matrix {
  gap: var(--msp-space-1);
  padding: var(--msp-space-1);
  grid-template-columns: repeat(4, minmax(0, 1fr));
  display: grid;
}

.msp-params-extra-controls-interval {
  grid-template-columns: minmax(0, 1fr) calc(72px * var(--msp-ui-scale, 1));
  align-items: center;
  gap: var(--msp-space-2);
  width: 100%;
  display: grid;
}

.msp-params-extra-controls-intervalTrack {
  height: calc(16px * var(--msp-ui-scale, 1));
  margin-left: var(--msp-space-3);
  position: relative;

  &:before {
    content: "";
    height: calc(3px * var(--msp-ui-scale, 1));
    margin-top: calc(-1.5px * var(--msp-ui-scale, 1));
    background: linear-gradient(90deg,
      var(--msp-color-pressed) var(--msp-from),
      color-mix(in oklab, var(--msp-color-text-muted), transparent 45%) var(--msp-from) var(--msp-to),
      var(--msp-color-pressed) var(--msp-to));
    border-radius: 1.5px;
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
  }
}

.msp-params-extra-controls-intervalRange {
  -webkit-appearance: none;
  appearance: none;
  pointer-events: none;
  background: none;
  width: 100%;
  margin: 0;
  position: absolute;
  inset: 0;

  &::-webkit-slider-runnable-track {
    height: calc(3px * var(--msp-ui-scale, 1));
    background: none;
  }

  &::-webkit-slider-thumb {
    width: calc(10px * var(--msp-ui-scale, 1));
    height: calc(10px * var(--msp-ui-scale, 1));
    margin-top: calc(-3.5px * var(--msp-ui-scale, 1));
    background: var(--msp-color-text-muted);
    -webkit-appearance: none;
    appearance: none;
    pointer-events: auto;
    cursor: pointer;
    border-radius: 50%;
  }

  &::-moz-range-track {
    background: none;
  }

  &::-moz-range-thumb {
    width: calc(10px * var(--msp-ui-scale, 1));
    height: calc(10px * var(--msp-ui-scale, 1));
    background: var(--msp-color-text-muted);
    pointer-events: auto;
    cursor: pointer;
    border: 0;
    border-radius: 50%;
  }

  &:focus-visible {
    outline: none;
  }
}

.msp-params-extra-controls-intervalValue {
  height: calc(24px * var(--msp-ui-scale, 1));
  padding: 0 var(--msp-space-2);
  border-radius: var(--msp-radius-md);
  background: var(--msp-color-control);
  color: var(--msp-color-text);
  font-size: var(--msp-font-size-sm);
  font-variant-numeric: tabular-nums;
  line-height: calc(24px * var(--msp-ui-scale, 1));
  text-align: right;
}

.msp-params-extra-controls-strip {
  width: calc(56px * var(--msp-ui-scale, 1));
  height: calc(10px * var(--msp-ui-scale, 1));
  box-shadow: inset 0 0 0 1px var(--msp-glass-edge);
  border-radius: 2px;
  flex: none;
}

.msp-params-extra-controls-stripName {
  min-width: 0;
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  white-space: nowrap;
  flex: 1;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}

.msp-params-extra-controls-spark {
  width: calc(56px * var(--msp-ui-scale, 1));
  height: calc(14px * var(--msp-ui-scale, 1));
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2px;
  vector-effect: non-scaling-stroke;
  flex: none;
}

.msp-params-extra-controls-graphEditor {
  gap: var(--msp-space-1);
  padding: var(--msp-space-1);
  display: grid;
}

.msp-params-extra-controls-graph {
  width: 100%;
  height: calc(96px * var(--msp-ui-scale, 1));
  border-radius: var(--msp-radius-sm);
  background: var(--msp-color-panel);
  cursor: crosshair;
  touch-action: none;
  display: block;
}

.msp-params-extra-controls-grid {
  stroke: var(--msp-glass-edge);
  stroke-width: 1px;
  vector-effect: non-scaling-stroke;
}

.msp-params-extra-controls-curve {
  fill: none;
  stroke: var(--msp-color-text-muted);
  stroke-width: 1.5px;
  vector-effect: non-scaling-stroke;
}

.msp-params-extra-controls-point {
  fill: var(--msp-color-panel);
  stroke: var(--msp-color-text);
  stroke-width: 1.5px;
  vector-effect: non-scaling-stroke;
  cursor: grab;

  &:hover {
    fill: var(--msp-color-accent);
  }
}

.msp-params-extra-controls-graphArea {
  position: relative;
}

.msp-params-extra-controls-graphAt {
  top: var(--msp-space-1);
  right: var(--msp-space-2);
  color: var(--msp-color-text-subtle);
  font-size: var(--msp-font-size-xs);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  position: absolute;
}

.msp-params-extra-controls-graphFoot {
  align-items: center;
  gap: var(--msp-space-2);
  min-width: 0;
  display: flex;

  & > .msp-params-extra-controls-graphHint {
    flex: auto;
    min-width: 0;
  }
}

.msp-params-extra-controls-graphHint {
  color: var(--msp-color-text-subtle);
  font-size: var(--msp-font-size-xs);
  mask-image: linear-gradient(to right, #000 calc(100% - var(--msp-fade)), transparent);
  white-space: nowrap;
  margin: 0;
  animation-name: msp-fade-overflow;
  animation-fill-mode: both;
  animation-timeline: scroll(self inline);
  overflow: hidden;
}
}
`);
