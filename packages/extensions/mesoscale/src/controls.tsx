/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Choices } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { GraphicsMode, MesoscaleApi } from './operations.js';

// The mesoscale controls, shown by the extension's Entities tab and by a host's panels (prism-me's properties): the
// graphics mode and the particles' motion, as the representations have them. They act through the `mesoscale` area:
// a slider once released (one step).

const Line = 'display: flex; align-items: center; gap: var(--msp-space-2); min-height: 28px';
const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';

/** The graphics mode (the particles' level of detail and the canvas's resolution) */
export function GraphicsMode(props: { area: MesoscaleApi }) {
  const graphics = props.area.graphicsState();
  return (
    <Choices
      choices={[
        { id: 'ultra', label: 'Ultra' },
        { id: 'quality', label: 'Quality' },
        { id: 'balanced', label: 'Balanced' },
        { id: 'performance', label: 'Fast' },
      ]}
      active={mapState(graphics, (g) => g?.mode ?? '')}
      onPick={(id) => void props.area.graphics({ mode: id as GraphicsMode })}
    />
  );
}

/** Wiggle and tumble sliders (the Mesoscale Explorer's procedural animation) */
/** The particles' wiggle and tumble: one model's when it is given (a host's properties), else every list's */
export function Motion(props: { area: MesoscaleApi; particles?: string }) {
  const graphics = props.area.graphicsState(props.particles);
  const of = props.particles ? { particles: props.particles } : {};
  const slider = (label: string, max: number, key: 'wiggle' | 'tumble') => (
    <div style={Line}>
      <span style="width: 56px">{label}</span>
      <input
        type="range"
        min="0"
        max={String(max)}
        step="0.1"
        value={mapState(graphics, (g) => String(g?.[key] ?? 0))}
        style="flex: 1"
        aria-label={label}
        onChange={(e) =>
          void props.area.motion({ [key]: Number((e.target as HTMLInputElement).value), ...of } as never)
        }
      />
      <span style={`width: 40px; text-align: right; ${Muted}`}>
        {mapState(graphics, (g) => `${(g?.[key] ?? 0).toFixed(1)} Å`)}
      </span>
    </div>
  );
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      {slider('Wiggle', 5, 'wiggle')}
      {slider('Tumble', 10, 'tumble')}
    </div>
  );
}
