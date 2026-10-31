/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Color } from '@molstar/core/util/color';
import { getDistinctBaseColors, getDistinctGroupColors } from '@molstar/core/util/color/distinct';
import { ColorLevels } from '@molstar/graphics/geo/geometry/color-levels';
import { ElementSymbolColors } from '@molstar/graphics/theme/color/element-symbol';
import { Slider } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { story } from '@molstar/prism-ui/testing/index';
import type { Meta, StoryObj } from '@storybook/web-components-vite';

// Colors that follow the zoom (color-levels.md; cellVIEW's LevelLerpFactor as a slider): a few proteins' atoms colored
// by `ColorLevels.blend`, the rule the shaders run, at the size on screen the slider sets. Left to right: the far color
// (the compartment's), the entity's, its chains' hues, the atoms' elements, blended in Oklab. No viewer.

const meta: Meta = { title: 'Explorer/Colors by zoom' };
export default meta;

const [envelope, capsid] = getDistinctBaseColors(2, 0);
const capsidEntities = getDistinctGroupColors(2, capsid, 20, 0);
const envelopeEntities = getDistinctGroupColors(2, envelope, 20, 0);

/** Each protein: its compartment's color (far), its entity's, its chain count */
const Proteins = [
  { name: 'CA (capsid)', far: capsid, entity: capsidEntities[0], chains: 1 },
  { name: 'NC (capsid)', far: capsid, entity: capsidEntities[1], chains: 2 },
  { name: 'gp120 (envelope)', far: envelope, entity: envelopeEntities[0], chains: 3 },
  { name: 'MA (envelope)', far: envelope, entity: envelopeEntities[1], chains: 3 },
];

/** A chain's atoms, by element: mostly carbon, as a protein */
const Atoms = ['C', 'C', 'N', 'C', 'O', 'C', 'C', 'S', 'C', 'O'] as const;

const swatch = (color: Color) =>
  `display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: ${Color.toHexStyle(color)}`;

function Levels() {
  const size = observableState(1);
  const props = ColorLevels.defaults;
  const level = mapState(size, (s) =>
    s < props.entity ? 'far (compartment)' : s < props.chain ? 'entity' : s < props.atom ? 'chain' : 'atom (element)',
  );
  return (
    <div style="display: flex; flex-direction: column; gap: 12px; padding: 16px; width: 520px">
      <div style="display: flex; align-items: center; gap: 8px">
        <span style="width: 120px">Atom on screen</span>
        <Slider
          aria-label="Pixels an atom covers"
          value={size.asReadonly}
          min={0.5}
          max={100}
          scale="log"
          unit="px"
          onPreview={(v) => size.set(v)}
          onCommit={(v) => size.set(v)}
        />
      </div>
      <span style="color: var(--msp-color-text-muted)">{mapState(level, (l) => `Mostly: ${l}`)}</span>
      {Proteins.map((p) => (
        <div style="display: flex; align-items: center; gap: 8px">
          <span style="width: 120px">{p.name}</span>
          {Array.from({ length: p.chains }, (_, c) => (
            <span style="display: flex; gap: 2px; margin-right: 6px">
              {Atoms.map((e) => (
                <span
                  style={mapState(size, (s) =>
                    swatch(
                      ColorLevels.blend(
                        p.far,
                        p.entity,
                        ElementSymbolColors[e],
                        ColorLevels.chainOffset(c, p.chains),
                        s,
                        props,
                      ),
                    ),
                  )}
                />
              ))}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Drag the slider: far, a protein shows its compartment's color; closer its entity's, its chains', its atoms'. */
export const LevelSlider: StoryObj = { render: () => story(() => <Levels />) };
