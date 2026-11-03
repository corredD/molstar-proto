/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '../../../dom/render.js';
import { ParamsFormModel } from '../../../forms/params-form.js';
import { ParamsForm } from '../params-form.js';

afterEach(() => {
  document.body.innerHTML = '';
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(form: ParamsFormModel<any>) {
  const container = document.createElement('div');
  document.body.append(container);
  render(() => <ParamsForm form={form} />, container);
  return container;
}

/** Types into a field and commits it, as the person does (change fires on blur and Enter). */
function type(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('typed numbers are rewritten to the value that holds', () => {
  it('a slider’s box: an out-of-range value that clamps to the current one, and text that is no number', async () => {
    const form = new ParamsFormModel({ level: PD.Numeric(100, { min: 0, max: 100, step: 1 }) });
    const box = mount(form).querySelector<HTMLInputElement>('input:not([type=range])')!;
    await flush();
    expect(box.value).toBe('100');
    type(box, '500');
    await flush();
    expect(box.value).toBe('100');
    expect((form.values.value as any).level).toBe(100);
    type(box, 'abc');
    await flush();
    expect(box.value).toBe('100');
    type(box, '40');
    await flush();
    expect(box.value).toBe('40');
    expect((form.values.value as any).level).toBe(40);
  });

  it('a number field with no range: "1.50" for a value that is 1.5', async () => {
    const form = new ParamsFormModel({ size: PD.Numeric(1.5) });
    const box = mount(form).querySelector<HTMLInputElement>('input[type=text]')!;
    await flush();
    type(box, '1.50');
    await flush();
    expect(box.value).toBe('1.5');
  });

  it('a vector’s fields: "1.50" is shown as 1.5, and text that is no number goes back to the value', async () => {
    const form = new ParamsFormModel({ offset: PD.Vec3([1.5, 0, 0] as any) });
    const container = mount(form);
    await flush();
    const x = container.querySelector<HTMLInputElement>('input[aria-label$="x"], input[aria-label="x"]')!;
    expect(x.value).toBe('1.5');
    type(x, '1.50');
    await flush();
    expect(x.value).toBe('1.5');
    type(x, 'zzz');
    await flush();
    expect(x.value).toBe('1.5');
    type(x, '2.0');
    await flush();
    expect(x.value).toBe('2');
    expect((form.values.value as any).offset[0]).toBe(2);
  });
});

describe('an interval', () => {
  it('with no bounds: two fields, any number (below 0, above 1), the ends never cross', async () => {
    const form = new ParamsFormModel({ domain: PD.Interval([-1, 1], { step: 0.001 }, { label: 'Domain' }) });
    const container = mount(form);
    await flush();
    expect(container.querySelector('input[type=range]')).toBeNull();
    const from = container.querySelector<HTMLInputElement>('input[aria-label="Domain from"]')!;
    const to = container.querySelector<HTMLInputElement>('input[aria-label="Domain to"]')!;
    // The default, below 0, is shown as it is.
    expect([from.value, to.value]).toEqual(['-1.000', '1.000']);
    type(from, '-2.5');
    type(to, '4');
    await flush();
    expect((form.values.value as any).domain).toEqual([-2.5, 4]);
    expect([from.value, to.value]).toEqual(['-2.500', '4.000']);
    // A from past the to stops at it; a to below the from too.
    type(from, '9');
    await flush();
    expect((form.values.value as any).domain).toEqual([4, 4]);
    expect(from.value).toBe('4.000');
    type(to, '-7');
    await flush();
    expect((form.values.value as any).domain).toEqual([4, 4]);
    expect(to.value).toBe('4.000');
    // A comma is the decimal point; text that is no number goes back to the value.
    type(from, '-0,5');
    type(to, 'zzz');
    await flush();
    expect((form.values.value as any).domain).toEqual([-0.5, 4]);
    expect([from.value, to.value]).toEqual(['-0.500', '4.000']);
  });

  it('with one bound only: two fields still', async () => {
    const form = new ParamsFormModel({ r: PD.Interval([2, 3], { min: 0 }, { label: 'R' }) });
    const container = mount(form);
    await flush();
    expect(container.querySelector('input[type=range]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="R from"]')!.value).toBe('2');
  });

  it('with both bounds: the two-knob track, at its bounds, as it was', async () => {
    const form = new ParamsFormModel({
      range: PD.Interval([2, 7.5], { min: 0, max: 10, step: 0.5 }, { label: 'Range' }),
    });
    const container = mount(form);
    await flush();
    const ends = [...container.querySelectorAll<HTMLInputElement>('input[type=range]')];
    expect(ends.map((e) => [e.getAttribute('aria-label'), e.min, e.max, e.step, e.value])).toEqual([
      ['Range from', '0', '10', '0.5', '2'],
      ['Range to', '0', '10', '0.5', '7.5'],
    ]);
    expect(container.querySelectorAll('input[type=text]').length).toBe(0);
    expect(container.textContent).toContain('2.0–7.5');
  });
});

describe('an interval set to the value it has is no change', () => {
  it('a field: an end retyped, or past the other end that already stops it, changes nothing', async () => {
    const changes: unknown[] = [];
    const params = { domain: PD.Interval([-1, 1], {}, { label: 'Domain' }) };
    const form = new ParamsFormModel(params, { domain: [4, 4] }, { onChange: (v) => changes.push(v.domain) });
    const container = mount(form);
    await flush();
    const to = container.querySelector<HTMLInputElement>('input[aria-label="Domain to"]')!;
    type(to, '-7');
    type(to, '4');
    await flush();
    expect(changes).toEqual([]);
    expect(to.value).toBe('4');
    type(to, '5');
    expect(changes).toEqual([[4, 5]]);
  });

  it('a knob: dragged against the other, no change at each step', async () => {
    const changes: unknown[] = [];
    const params = { range: PD.Interval([0, 1], { min: 0, max: 10, step: 1 }, { label: 'Range' }) };
    const form = new ParamsFormModel(params, { range: [4, 4] }, { onChange: (v) => changes.push(v.range) });
    const container = mount(form);
    await flush();
    const to = container.querySelector<HTMLInputElement>('input[aria-label="Range to"]')!;
    for (const v of ['3', '2', '1']) {
      to.value = v;
      to.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await flush();
    expect(changes).toEqual([]);
    expect(to.value).toBe('4');
  });
});
