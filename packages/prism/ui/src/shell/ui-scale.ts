/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { observableState } from '../reactive/observable-state.js';
import type { ReadonlyState } from '../reactive/readonly-state.js';
import { derive } from '../reactive/state.js';

/**
 * The UI scale's steps (styling.md §6): 100 % and a few around it, more above (the point is a larger UI). Whole
 * percents, so the value reads plainly; the list rows round to whole pixels in CSS whatever the step.
 */
export const UIScales: readonly number[] = [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** The scale as the person reads it: `125 %`. */
export function formatUIScale(scale: number): string {
  return `${Math.round(scale * 100)} %`;
}

/** The step nearest `value`; 1 for what is not a finite number (a kept value from elsewhere). */
function nearestStep(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  let best = UIScales[0];
  for (const s of UIScales) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
  return best;
}

/**
 * The UI scale (styling.md §6): how large the UI is drawn, set as `--msp-ui-scale` on the element the UI is themed by
 * (as `ThemeModel` sets `data-msp-theme`). The size tokens multiply by it; the canvas is not touched (its picture, its
 * pixel ratio and its labels are the renderer's), only its region gets smaller as the panels grow.
 */
export class UIScaleModel {
  readonly #scale;
  readonly canGrow: ReadonlyState<boolean>;
  readonly canShrink: ReadonlyState<boolean>;

  constructor(initial: unknown = 1) {
    this.#scale = observableState(nearestStep(initial));
    this.canGrow = derive(this.#scale.asReadonly, (s) => s < UIScales[UIScales.length - 1]);
    this.canShrink = derive(this.#scale.asReadonly, (s) => s > UIScales[0]);
  }

  get scale(): ReadonlyState<number> {
    return this.#scale.asReadonly;
  }

  get value(): number {
    return this.#scale.value;
  }

  /** Sets the step nearest `scale`. */
  set(scale: number) {
    this.#scale.set(nearestStep(scale));
  }

  larger() {
    const i = UIScales.indexOf(this.#scale.value);
    this.#scale.set(UIScales[Math.min(i + 1, UIScales.length - 1)]);
  }

  smaller() {
    const i = UIScales.indexOf(this.#scale.value);
    this.#scale.set(UIScales[Math.max(i - 1, 0)]);
  }

  reset() {
    this.#scale.set(1);
  }

  /** Keeps `--msp-ui-scale` on `el` in step (none at 100 %: the tokens' own sizes); returns the unsubscribe. */
  applyTo(el: HTMLElement): () => void {
    const sub = this.#scale.asReadonly.subscribe((s) => {
      if (s === 1) el.style.removeProperty('--msp-ui-scale');
      else el.style.setProperty('--msp-ui-scale', String(s));
    });
    return () => sub.unsubscribe();
  }
}
