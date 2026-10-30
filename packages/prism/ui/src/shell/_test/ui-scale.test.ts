/** @vitest-environment jsdom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { formatUIScale, UIScaleModel, UIScales } from '../ui-scale.js';

// The UI scale (styling.md §7): one CSS variable on the element the UI is themed by, in steps; nothing else written.

describe('UIScaleModel', () => {
  it('starts at 100 % and steps up and down, stopping at the ends', () => {
    const m = new UIScaleModel();
    expect(m.value).toBe(1);
    m.larger();
    expect(m.value).toBe(UIScales[UIScales.indexOf(1) + 1]);
    for (let i = 0; i < 20; i++) m.larger();
    expect(m.value).toBe(UIScales[UIScales.length - 1]);
    expect(m.canGrow.value).toBe(false);
    for (let i = 0; i < 20; i++) m.smaller();
    expect(m.value).toBe(UIScales[0]);
    expect(m.canShrink.value).toBe(false);
    m.reset();
    expect(m.value).toBe(1);
  });

  it('snaps a kept value to the nearest step, and ignores what is not a number', () => {
    expect(new UIScaleModel(1.27).value).toBe(1.25);
    expect(new UIScaleModel(99).value).toBe(UIScales[UIScales.length - 1]);
    expect(new UIScaleModel(Number.NaN).value).toBe(1);
    expect(new UIScaleModel('big' as never).value).toBe(1);
  });

  it('writes only --msp-ui-scale on the element, and removes it at 100 %', () => {
    const el = document.createElement('div');
    el.style.color = 'red';
    const m = new UIScaleModel();
    const stop = m.applyTo(el);
    expect(el.style.getPropertyValue('--msp-ui-scale')).toBe('');
    m.larger();
    expect(el.style.getPropertyValue('--msp-ui-scale')).toBe(String(m.value));
    expect(el.style.length).toBe(2);
    m.reset();
    expect(el.style.getPropertyValue('--msp-ui-scale')).toBe('');
    stop();
    m.larger();
    expect(el.style.getPropertyValue('--msp-ui-scale')).toBe('');
  });

  it('says the scale as a percentage', () => {
    expect(formatUIScale(1)).toBe('100 %');
    expect(formatUIScale(1.25)).toBe('125 %');
  });
});
