/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Choices, Slider } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { GraphicsMode, MesoscaleApi } from './operations.js';

// The mesoscale controls, shown by the extension's Entities tab and by a host's panels (prism-me's properties): the
// graphics mode and the particles' motion, as the representations have them. They act through the `mesoscale` area:
// a slider once released (one step).

const Line = 'display: flex; align-items: center; gap: var(--msp-space-2); min-height: 28px';

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
      <div style="flex: 1; min-width: 0">
        <Slider
          aria-label={label}
          value={mapState(graphics, (g) => g?.[key] ?? 0)}
          min={0}
          max={max}
          step={0.1}
          unit="Å"
          onCommit={(v) => void props.area.motion({ [key]: v, ...of } as never)}
        />
      </div>
    </div>
  );
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-1)">
      {slider('Wiggle', 5, 'wiggle')}
      {slider('Tumble', 10, 'tumble')}
    </div>
  );
}
