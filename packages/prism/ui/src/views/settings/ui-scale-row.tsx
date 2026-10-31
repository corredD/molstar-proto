/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button } from '../../components/button/button.js';
import { Icon } from '../../components/icon/icon.js';
import { derive } from '../../reactive/state.js';
import { formatUIScale, type UIScaleModel } from '../../shell/ui-scale.js';
import { classes } from './_generated/ui-scale-row.module.css.js';

/**
 * The UI scale's row (styling.md §6; Settings › Appearance): − and + around the value, each disabled at its end. A
 * press is one step, applied at once (a CSS variable: nothing is rebuilt).
 */
export function UIScaleRow(props: { scale: UIScaleModel }) {
  const { scale } = props;
  return (
    <div class={classes.row}>
      <span class={classes.label}>UI scale</span>
      <div class={classes.control}>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="minus" size={14} />}
          title="Smaller UI"
          disabled={derive(scale.canShrink, (c) => !c)}
          onClick={() => scale.smaller()}
        />
        <span class={classes.value} aria-live="polite">
          {derive(scale.scale, formatUIScale)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="plus" size={14} />}
          title="Larger UI"
          disabled={derive(scale.canGrow, (c) => !c)}
          onClick={() => scale.larger()}
        />
      </div>
    </div>
  );
}
