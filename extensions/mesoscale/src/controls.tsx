/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Choices, Icon, onCleanup, Show } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { EntityCut, GraphicsMode, MesoscaleApi, MesoscaleInfo } from './operations.js';

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
export function Motion(props: { area: MesoscaleApi }) {
  const graphics = props.area.graphicsState();
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
        onChange={(e) => void props.area.motion({ [key]: Number((e.target as HTMLInputElement).value) } as never)}
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

const sameIds = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((x, i) => x === [...b].sort((p, q) => p - q)[i]);

/** The cuts of exactly these entities, in their order */
export function cutsFor(info: MesoscaleInfo, entities: readonly number[]): EntityCut[] {
  return info.cuts.filter((c) => sameIds(c.entities, entities)).map((c) => c.cut);
}

/** The index among all the list's cuts (its clip object's) of these entities' `nth` cut */
export function cutIndexOf(info: MesoscaleInfo, entities: readonly number[], nth: number): number {
  return info.cuts.flatMap((c, i) => (sameIds(c.entities, entities) ? [i] : []))[nth] ?? -1;
}

/** One cut of some entities: its type (unless the host shows it), invert, axis, angle, position, size */
export function ClipControls(props: {
  area: MesoscaleApi;
  info: ReadonlyState<MesoscaleInfo>;
  entities: readonly number[];
  selection: { group?: string; entities?: string };
  depth: number;
  toggleGuides?: () => void;
  /** Which of these entities' cuts (0: the first) */
  cut?: number;
  /** Without the type's choices (a host shows the type itself) */
  noType?: boolean;
}) {
  const { area, info } = props;
  const nth = props.cut ?? 0;
  const cut = mapState(info, (i) => cutsFor(i, props.entities)[nth]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const set = (values: Record<string, unknown>, delay = 0) => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        void area.clip({
          ...props.selection,
          type: cut.value?.type ?? 'plane',
          particles: info.value.particles,
          cut: nth,
          ...values,
        } as never),
      delay,
    );
  };
  const slider = (label: string, key: string, min: number, max: number, read: (c: EntityCut) => number) => (
    <div style="display: flex; align-items: center; gap: var(--msp-space-2)">
      <span style="width: 64px">{label}</span>
      <input
        type="range"
        min={String(min)}
        max={String(max)}
        step="1"
        style="flex: 1"
        aria-label={label}
        value={mapState(cut, (c) => String(c ? read(c) : 0))}
        onInput={(e) => set({ [key]: Number((e.target as HTMLInputElement).value) }, 60)}
      />
      <span style={`${Muted}; width: 32px; text-align: right`}>{mapState(cut, (c) => (c ? String(read(c)) : ''))}</span>
    </div>
  );
  return (
    <div
      style={`display: flex; flex-direction: column; gap: var(--msp-space-1); padding-left: calc(${props.depth} * var(--msp-space-3)); padding-bottom: var(--msp-space-2)`}
    >
      {props.noType ? null : (
        <Choices
          choices={[
            { id: 'none', label: 'None' },
            { id: 'plane', label: 'Plane' },
            { id: 'sphere', label: 'Sphere' },
            { id: 'cube', label: 'Box' },
            { id: 'cylinder', label: 'Cylinder' },
          ]}
          active={mapState(cut, (c) => c?.type ?? 'none')}
          onPick={(type) => set({ type })}
        />
      )}
      <Show when={mapState(cut, (c) => !!c)}>
        {() => (
          <>
            <Button
              size="sm"
              variant="ghost"
              pressed={mapState(cut, (c) => !!c?.invert)}
              onClick={() => set({ invert: !cut.value?.invert })}
            >
              Invert
            </Button>
            <Choices
              label="Turn about"
              choices={[
                { id: 'x', label: 'X' },
                { id: 'y', label: 'Y' },
                { id: 'z', label: 'Z' },
              ]}
              active={mapState(cut, (c) => c?.axis ?? 'x')}
              onPick={(axis) => set({ axis })}
            />
            {props.toggleGuides ? (
              <Button size="sm" variant="ghost" icon={<Icon name="crop" />} onClick={props.toggleGuides}>
                Show or hide the cuts (right-click one to move, turn or size it)
              </Button>
            ) : null}
            {slider('Angle', 'angle', -180, 180, (c) => c.angle)}
            {slider('Position X', 'x', -100, 100, (c) => c.position[0])}
            {slider('Position Y', 'y', -100, 100, (c) => c.position[1])}
            {slider('Position Z', 'z', -100, 100, (c) => c.position[2])}
            <Show when={mapState(cut, (c) => c?.type !== 'plane')}>
              {() => (
                <>
                  {slider('Size X', 'sx', 0, 100, (c) => c.scale[0])}
                  {slider('Size Y', 'sy', 0, 100, (c) => c.scale[1])}
                  {slider('Size Z', 'sz', 0, 100, (c) => c.scale[2])}
                </>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
