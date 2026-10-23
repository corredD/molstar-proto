/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { render } from '../../../dom/render.js';
import { flushFrame } from '../../../reactive/frame-state.js';
import { observableState } from '../../../reactive/observable-state.js';
import { Slider, type SliderProps } from '../slider.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(props: Omit<SliderProps, 'value'> & { value?: number }) {
  const value = observableState<number | undefined>(props.value);
  const previews: number[] = [];
  const commits: number[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  render(
    () => (
      <Slider
        {...props}
        value={value.asReadonly}
        onPreview={(v) => previews.push(v)}
        onCommit={(v) => commits.push(v)}
      />
    ),
    container,
  );
  const range = container.querySelector('input[type=range]') as HTMLInputElement;
  const box = container.querySelector('input:not([type=range])') as HTMLInputElement;
  const drag = (v: string) => {
    range.value = v;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const release = () => range.dispatchEvent(new Event('change', { bubbles: true }));
  const type = (text: string) => {
    box.value = text;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { value, previews, commits, range, box, drag, release, type };
}

describe('Slider', () => {
  it('previews a drag once a frame, commits once at the release', async () => {
    const s = mount({ value: 0, min: 0, max: 1, step: 0.01 });
    s.drag('0.2');
    s.drag('0.3');
    expect(s.previews).toEqual([]);
    flushFrame();
    expect(s.previews).toEqual([0.3]);
    expect(s.box.value).toBe('0.30');
    s.drag('0.4');
    s.release();
    flushFrame();
    // The release's value, now; not a late preview after it.
    expect(s.commits).toEqual([0.4]);
    expect(s.previews).toEqual([0.3]);
    await flush();
  });

  it('shows a mixed value as an empty box and the knob at the start', async () => {
    const s = mount({ min: 0, max: 1, step: 0.01 });
    await flush();
    expect(s.box.value).toBe('');
    expect(s.box.placeholder).toBe('mixed');
    expect(s.range.value).toBe('0');
    s.value.set(0.5);
    await flush();
    expect(s.box.value).toBe('0.50');
  });

  it('a typed value is clamped, unless the slider takes any; text that is no number shows what holds', async () => {
    const clamped = mount({ value: 0.5, min: 0, max: 1, step: 0.01 });
    clamped.type('3');
    expect(clamped.commits).toEqual([1]);
    clamped.type('abc');
    expect(clamped.commits).toEqual([1]);
    expect(clamped.box.value).toBe('0.50');
    const free = mount({ value: 0, min: -10, max: 10, clamp: false });
    free.type('250');
    expect(free.commits).toEqual([250]);
    await flush();
  });

  it('goes by powers of ten on a log scale; the box takes any positive value', async () => {
    const s = mount({ value: 4, min: 0.5, max: 5000, scale: 'log' });
    await flush();
    expect(Number(s.range.value)).toBeCloseTo(Math.log10(4));
    expect(s.range.min).toBe(String(Math.log10(0.5)));
    s.drag('2');
    s.release();
    expect(s.commits).toEqual([100]);
    s.type('0');
    expect(s.commits).toEqual([100]);
    s.type('12000');
    expect(s.commits).toEqual([100, 5000]);
  });

  it('follows a bound that changes', async () => {
    const max = observableState(10);
    const s = mount({ value: 3, min: 0, max: max.asReadonly, step: 1 });
    await flush();
    expect(s.range.max).toBe('10');
    max.set(20);
    await flush();
    expect(s.range.max).toBe('20');
  });

  it('formats and parses its own way, with a unit after the box', async () => {
    const s = mount({
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => String(Math.round(v * 100)),
      parse: (t) => Number(t) / 100,
      unit: '%',
    });
    await flush();
    expect(s.box.value).toBe('50');
    s.type('25');
    expect(s.commits).toEqual([0.25]);
    expect(s.box.parentElement!.textContent).toContain('%');
  });
});
