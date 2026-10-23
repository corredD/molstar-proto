/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { Child } from '../../dom/jsx-types.js';
import { effect, frameState, watch, type WatchSource } from '../../dom/scope.js';
import { setAttr, setStyle } from '../../dom/writes.js';
import type { ReadonlyState } from '../../reactive/readonly-state.js';
import { classes } from './_generated/params-form.module.css.js';

export interface SliderProps {
  /** The value shown; `undefined` when it is mixed (several values): the knob at the start, the box empty */
  value: ReadonlyState<number | undefined>;
  min: number | ReadonlyState<number>;
  max: number | ReadonlyState<number>;
  /**
   * The knob's step and the box's decimals; none: a hundredth of the range (by powers of ten on a log scale); 'any':
   * no step (the box at most 4 decimals)
   */
  step?: number | 'any';
  /** 'log': the knob goes by powers of ten (a size over decades; min > 0), the box takes any value */
  scale?: 'linear' | 'log';
  /** A value typed in the box is clamped to [min, max] (default), or kept as it is (the knob goes only so far) */
  clamp?: boolean;
  /** The box's text for a value (default: the value at the step's decimals) and the value of a typed text */
  format?(v: number): string;
  parse?(text: string): number;
  /** After the box (a unit) */
  unit?: Child;
  /** The box's text for a mixed value */
  mixed?: string;
  labelId?: string;
  'aria-label'?: string;
  /** During a drag, once a frame (the value as it goes: a preview, or a value set live) */
  onPreview?(v: number): void;
  /** The knob released, or a value typed in the box */
  onCommit?(v: number): void;
}

/**
 * A number in a range: a quiet slider and its number box (ParamsForm's, for a PD.Numeric with a range). A drag is in
 * the frame lane (rendering.md §2.3): input events come several a frame, `onPreview` is called once a frame;
 * `onCommit` at the release, or when a value is typed.
 */
export function Slider(props: SliderProps) {
  const log = props.scale === 'log';
  const bound = (b: number | ReadonlyState<number>) => (typeof b === 'number' ? b : b.value);
  const toKnob = (v: number) => (log ? Math.log10(v) : v);
  const fromKnob = (k: number) => (log ? round(10 ** k) : k);
  const step = props.step;
  const format = props.format ?? ((v: number) => formatNumber(v, log || step === 'any' ? undefined : step));
  const parse = props.parse ?? parseNumber;
  const clampTo = (v: number) =>
    props.clamp === false ? v : Math.min(bound(props.max), Math.max(bound(props.min), v));

  let range!: HTMLInputElement;
  let box!: HTMLInputElement;
  /** What the knob and the box show: the value, or the drag's while it goes */
  const show = (v: number | undefined, knob = true) => {
    const min = toKnob(bound(props.min));
    const max = toKnob(bound(props.max));
    const k = v === undefined ? min : Math.min(max, Math.max(min, toKnob(v)));
    if (knob) setValue(range, String(k));
    // The filled part of the track, for the quiet styling (no native accent fill).
    setStyle(range, '--msp-progress', `${(100 * (k - min)) / (max - min || 1)}%`);
    setValue(box, v === undefined ? '' : format(v));
  };

  const dragged = frameState(Number.NaN, (a, b) => Object.is(a, b));
  effect(dragged, (v) => {
    if (Number.isNaN(v)) return;
    show(v, false);
    props.onPreview?.(v);
  });

  const el = (
    <div class={classes.slider}>
      <input
        class={classes.range}
        type="range"
        aria-labelledby={props.labelId}
        aria-label={props['aria-label']}
        ref={(e: HTMLInputElement) => (range = e)}
        onInput={(e) => dragged.offer(fromKnob(Number(e.currentTarget.value)))}
        onChange={(e) => {
          const v = fromKnob(Number(e.currentTarget.value));
          // The drag's last value, now (not a frame later, after the commit).
          dragged.offer(Number.NaN);
          show(v, false);
          props.onCommit?.(v);
        }}
      />
      <input
        class={classes.number}
        aria-labelledby={props.labelId}
        aria-label={props['aria-label']}
        placeholder={props.mixed ?? 'mixed'}
        ref={(e: HTMLInputElement) => (box = e)}
        onChange={(e) => {
          const typed = parse(e.currentTarget.value);
          const ok = Number.isFinite(typed) && (!log || typed > 0);
          const v = ok ? clampTo(typed) : props.value.value;
          // The box says what holds, whether or not the value changed (a clamp to the same value, text that is no number).
          show(v);
          if (ok) props.onCommit?.(v!);
        }}
      />
      {props.unit === undefined ? null : <span class={classes.unit}>{props.unit}</span>}
    </div>
  ) as HTMLElement;
  if (props.unit !== undefined) el.classList.add(classes.withUnit);

  const sources: WatchSource[] = [props.value];
  if (typeof props.min !== 'number') sources.push(props.min);
  if (typeof props.max !== 'number') sources.push(props.max);
  watch(sources, () => {
    const min = toKnob(bound(props.min));
    const max = toKnob(bound(props.max));
    setAttr(range, 'min', String(min));
    setAttr(range, 'max', String(max));
    setAttr(range, 'step', String(step ?? (log ? 0.01 : (max - min) / 100)));
    show(props.value.value);
  });
  return el;
}

/** An input's value, written only when it differs (a write moves the caret). */
function setValue(el: HTMLInputElement, v: string) {
  if (el.value !== v) el.value = v;
}

/** A size over decades, rounded: two significant digits under 10, three above */
function round(v: number) {
  return Number(v.toPrecision(v < 10 ? 2 : 3));
}

export function formatNumber(v: number, step?: number) {
  if (!Number.isFinite(v)) return '';
  // No step: the value as it is (at most 4 decimals), not rounded to a whole number.
  if (step === undefined) return String(Number(v.toFixed(4)));
  const digits = step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0;
  return v.toFixed(digits);
}

/** A typed number: "0.5", "0,5" (a comma as the decimal point), " -1 "; NaN when it is not one. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
}
