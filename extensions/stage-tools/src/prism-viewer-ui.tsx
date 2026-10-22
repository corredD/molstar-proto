/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Choices, domView, onCleanup, openContextMenu, Show } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { menuItems, rootOf } from './menu.js';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { SceneNode } from '@molstar/prism-viewer';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';
import { SceneRow } from '@molstar/prism-viewer/views/structure/scene-row';
import type { CutInfo, StageApi } from './operations.js';

// The stage tools' views (apps/prism-me/_spec/features.md, "Stage tools"; Stories Untold's stage menu and cut
// guides): the canvas's right-click menu, on what was picked (a structure, a particle and its entity, a volume, a cut's
// guide), and a Cut row under each structure, particle list and volume (the shape, where along its normal, its size,
// flip, the guides). They act through the API as the person, so each choice is one step of the history.

export const CutRow = 'stage-tools.row.cut';
export const GuidesButton = 'stage-tools.toolbar.guides';

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';
const Line = 'display: flex; align-items: center; gap: var(--msp-space-2); min-height: 28px';

export function stageToolsUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.stage;
  if (!area) return {};
  // The menu follows the canvas's right-clicks for as long as the viewer lives.
  let close: (() => void) | undefined;
  area.setMenu(async (request) => {
    close?.();
    const items = await menuItems(ctx.api, area, request);
    if (!items.length) return;
    close = openContextMenu(rootOf(request), { x: request.x, y: request.y }, items);
  });
  const shown = area.guidesState();
  return {
    toolbar: [
      {
        id: GuidesButton,
        icon: 'crop',
        title: 'Show or hide the cuts',
        place: 'canvas',
        visible: area.anyCutState(),
        run: () => void area.guides({ visible: !shown.value }),
      },
    ],
    rows: [
      {
        id: CutRow,
        when: (node) => node.kind === 'structure' || node.kind === 'particles' || node.kind === 'volume',
        render: domView(({ ctx: view }) => {
          const target = (view.subject as SceneNode).id;
          const info = area.cutState(target);
          return (
            <SceneRow
              label="Cut"
              description={mapState(info, (i) =>
                i?.cut ? `${i.cut.shape}${i.cut.invert ? ', inside kept' : ''}` : 'Off',
              )}
              body={() => <CutControls area={area} target={target} info={info} />}
            />
          );
        }),
      },
    ],
  };
}

function CutControls(props: { area: StageApi; target: string; info: ReadonlyState<CutInfo | undefined> }) {
  const { area, target, info } = props;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  // The sliders change at pointer rate: one call a moment after the last.
  const adjust = (values: Record<string, unknown>, delay = 60) => {
    clearTimeout(timer);
    timer = setTimeout(() => void area.adjust({ target, ...values } as never), delay);
  };
  const shown = area.guidesState();
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-2)">
      <Choices
        label="Cut with"
        choices={[
          { id: '', label: 'None' },
          { id: 'plane', label: 'Plane' },
          { id: 'sphere', label: 'Sphere' },
          { id: 'box', label: 'Box' },
        ]}
        active={mapState(info, (i) => i?.cut?.shape ?? '')}
        onPick={(shape) =>
          void (shape ? area.cut({ shape: shape as 'plane' | 'sphere' | 'box', target }) : area.uncut({ target }))
        }
      />
      <Show when={mapState(info, (i) => !!i?.cut)}>
        {() => (
          <>
            <div style={Line}>
              <span style="width: 64px">Position</span>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                style="flex: 1"
                aria-label="Position along the normal"
                value={mapState(info, (i) => String(i?.offset ?? 0))}
                onInput={(e) => adjust({ offset: Number((e.target as HTMLInputElement).value) })}
              />
            </div>
            <Show when={mapState(info, (i) => i?.cut?.shape !== 'plane')}>
              {() => (
                <div style={Line}>
                  <span style="width: 64px">Size</span>
                  <input
                    type="range"
                    min="0.05"
                    max="2"
                    step="0.01"
                    style="flex: 1"
                    aria-label="Size"
                    value={mapState(info, (i) => String(i && i.cut ? i.cut.radius / i.reach : 0.6))}
                    onInput={(e) => adjust({ size: Number((e.target as HTMLInputElement).value) })}
                  />
                </div>
              )}
            </Show>
            <div style="display: flex; gap: var(--msp-space-2)">
              <Button size="sm" onClick={() => adjust({ flip: true }, 0)}>
                Flip
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void area.guides({ visible: !shown.value })}>
                {mapState(shown, (s) => (s ? 'Hide the cut' : 'Show the cut'))}
              </Button>
            </div>
            <p style={`margin: 0; ${Muted}`}>Right-click the scene for more: cut what you point at, flip, remove.</p>
          </>
        )}
      </Show>
    </div>
  );
}
