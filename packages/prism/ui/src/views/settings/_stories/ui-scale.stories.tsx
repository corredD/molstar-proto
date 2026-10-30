/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Color } from '@molstar/core/util/color';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { Button } from '../../../components/button/button.js';
import { Icon } from '../../../components/icon/icon.js';
import { ParamsFormModel } from '../../../forms/params-form.js';
import { UIScaleModel } from '../../../shell/ui-scale.js';
import { story } from '../../../testing/story-root.js';
import { SettingsTab } from '../settings-tab.js';
import { UIScaleRow } from '../ui-scale-row.js';

const meta: Meta = { title: 'Overview/Foundations/UI scale' };
export default meta;

/** An Appearance group as the viewer's: the UI scale row, then a few of the canvas's params. */
function settings(scale: UIScaleModel) {
  const form = new ParamsFormModel(
    {
      backgroundColor: PD.Color(Color(0xffffff), { label: 'Background', isEssential: true }),
      highlightStrength: PD.Numeric(0.3, { min: 0, max: 1, step: 0.05 }, { label: 'Highlight strength' }),
      fog: PD.Boolean(true, { label: 'Fog' }),
    },
    { backgroundColor: Color(0xffffff), highlightStrength: 0.3, fog: true },
  );
  return (
    <SettingsTab
      model={{
        groups: [
          {
            id: 'appearance',
            title: 'Appearance',
            icon: 'palette',
            form,
            rows: [{ label: 'UI scale', keywords: 'zoom', view: () => <UIScaleRow scale={scale} /> }],
          },
        ],
      }}
    />
  );
}

/** One panel at a scale: `--msp-ui-scale` on its themed root, as the shell sets it (styling.md §6). */
function Panel(props: { theme: string; initial: number }) {
  const scale = new UIScaleModel(props.initial);
  return (
    <div
      data-msp-theme={props.theme}
      ref={(el) => scale.applyTo(el)}
      style="background: var(--msp-color-panel); color: var(--msp-color-text); padding: var(--msp-space-3); display: grid; gap: var(--msp-space-3); align-content: start; height: 520px"
    >
      <div style="display: flex; gap: var(--msp-space-2); align-items: center; font-size: var(--msp-font-size-sm)">
        <Icon name="palette" size={16} />
        <b>{props.theme}</b>
        <span style="flex: 1" />
        <Button size="sm" icon={<Icon name="download" size={14} />}>
          Export
        </Button>
      </div>
      {settings(scale)}
    </div>
  );
}

/**
 * The same Settings panel at 100 % and 150 %, light and dark: text, rows, controls, icons and spacing grow together
 * (the size tokens and the px in Prism's CSS times `--msp-ui-scale`); − and + step it in place.
 */
export const AtTwoScales: StoryObj = {
  render: () =>
    story(() => (
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1px">
        <Panel theme="light" initial={1} />
        <Panel theme="light" initial={1.5} />
        <Panel theme="dark" initial={1} />
        <Panel theme="dark" initial={1.5} />
      </div>
    )),
};
