/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { domView, For, Show } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import type { SceneNode } from '@molstar/prism-viewer';
import type { ViewerExtensionUI, ViewerUIContext } from '@molstar/prism-viewer/spec';
import { SceneRow } from '@molstar/prism-viewer/views/structure/scene-row';
import { Decorations, MeshControls, Slice } from './controls.js';
import type { CryoetApi, DecorationsInfo } from './operations.js';

// The cryo-ET rows of the scene tree (apps/prism-me/_spec/features.md, "CryoET"): under a particle list, Decorations
// (the targets by class, and for each target or all of them what decorates it: an object of the scene, a PDB id or URL,
// or spheres); under a volume, Slice (the axis, the slice, the contrast). They read the `cryoet` area and act through it.

export const DecorationsRow = 'cryoet.row.decorations';
export const SegmentationsTab = 'cryoet.tab.segmentations';
export const SliceRow = 'cryoet.row.slice';

const Muted = 'color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';

export function cryoetUI(ctx: ViewerUIContext): ViewerExtensionUI {
  const area = ctx.api.cryoet;
  if (!area) return {};
  return {
    tabs: [
      {
        id: SegmentationsTab,
        title: 'Segmentations',
        icon: 'box',
        order: 16,
        render: domView(() => <Segmentations area={area} />),
      },
    ],
    rows: [
      {
        id: DecorationsRow,
        when: (node) => node.kind === 'particles',
        render: domView(({ ctx: view }) => {
          const particles = (view.subject as SceneNode).id;
          const info = area.decorationsState(particles);
          return (
            <SceneRow
              label="Decorations"
              description={mapState(info, describe)}
              body={() => (
                <Show when={mapState(info, (i) => !!i)}>
                  {() => <Decorations area={area} info={info as ReadonlyState<DecorationsInfo>} />}
                </Show>
              )}
            />
          );
        }),
      },
      {
        id: SliceRow,
        when: (node) => node.kind === 'volume',
        render: domView(({ ctx: view }) => {
          const volume = (view.subject as SceneNode).id;
          const slice = area.sliceState(volume);
          const description = mapState(slice, (s) =>
            s?.shown
              ? `${s.shown.axis} ${s.shown.index + 1} of ${s.dimensions[{ x: 0, y: 1, z: 2 }[s.shown.axis]]}`
              : 'Off',
          );
          return (
            <SceneRow label="Slice" description={description} body={() => <Slice area={area} volume={volume} />} />
          );
        }),
      },
    ],
  };
}

function describe(info: DecorationsInfo | undefined) {
  if (!info) return undefined;
  const n = info.targets.filter((t) => t.with).length;
  return `${n} of ${info.targets.length} target${info.targets.length === 1 ? '' : 's'} decorated${info.classes ? ` · by ${info.classes}` : ''}`;
}

/** The segmentation meshes (OBJ, PLY, VTP), each with its eye, surface or wireframe, opacity and color */
function Segmentations(props: { area: CryoetApi }) {
  const { area } = props;
  const list = area.meshesState();
  return (
    <div style="display: flex; flex-direction: column; gap: var(--msp-space-3); padding: var(--msp-space-3)">
      <Show
        when={mapState(list, (l) => l.length > 0)}
        fallback={() => (
          <p style={`margin: 0; ${Muted}`}>
            Drop segmentation meshes (OBJ, PLY, VTP) on the viewer: they show here, as a surface, a wireframe or both.
          </p>
        )}
      >
        {() => (
          <For each={list} by={(m) => m.ref}>
            {(m) => <MeshControls area={area} mesh={m} list={list} />}
          </For>
        )}
      </Show>
    </div>
  );
}
