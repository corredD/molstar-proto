/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '../../../dom/render.js';
import { ParamsFormModel } from '../../../forms/params-form.js';
import { UIScaleModel, UIScales } from '../../../shell/ui-scale.js';
import { SettingsTab } from '../settings-tab.js';
import { UIScaleRow } from '../ui-scale-row.js';

// Settings › Appearance › UI scale (styling.md §7): − and + around the value, each disabled at its end; a row of a
// group that the search finds by its label, as it finds the form's params.

const flush = () => new Promise((r) => setTimeout(r, 0));

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  document.body.innerHTML = '';
});

function mount(scale: UIScaleModel) {
  const container = document.createElement('div');
  document.body.append(container);
  const form = new ParamsFormModel({ backgroundColor: PD.Color(0 as never) }, { backgroundColor: 0 as never });
  disposers.push(
    render(
      () => (
        <SettingsTab
          model={{
            groups: [
              {
                id: 'appearance',
                title: 'Appearance',
                icon: 'palette',
                form,
                rows: [
                  {
                    label: 'UI scale',
                    keywords: 'size zoom text larger smaller',
                    view: () => <UIScaleRow scale={scale} />,
                  },
                ],
              },
            ],
          }}
        />
      ),
      container,
    ),
  );
  return container;
}

const button = (c: HTMLElement, name: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const search = async (c: HTMLElement, text: string) => {
  const input = c.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
};
const row = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-settings-row="UI scale"]')!;

describe('the UI scale row', () => {
  it('steps the scale with − and +, shows it, and stops at the ends', async () => {
    const scale = new UIScaleModel();
    const c = mount(scale);
    expect(row(c).textContent).toContain('UI scale');
    expect(row(c).textContent).toContain('100 %');
    button(c, 'Larger UI').click();
    await flush();
    expect(scale.value).toBe(UIScales[UIScales.indexOf(1) + 1]);
    expect(row(c).textContent).toContain(`${Math.round(scale.value * 100)} %`);
    scale.set(UIScales[UIScales.length - 1]);
    await flush();
    expect(button(c, 'Larger UI').disabled).toBe(true);
    button(c, 'Smaller UI').click();
    await flush();
    expect(scale.value).toBe(UIScales[UIScales.length - 2]);
  });

  it('is found by the search, by its label or a keyword, and hidden otherwise', async () => {
    const c = mount(new UIScaleModel());
    await search(c, 'zoom');
    expect(row(c).closest('[hidden]')).toBeNull();
    await search(c, 'background');
    expect(row(c).closest('[hidden]')).not.toBeNull();
    await search(c, 'ui sc');
    expect(row(c).closest('[hidden]')).toBeNull();
    expect(c.textContent).not.toContain('No setting matches');
  });
});
