/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { clearFontAtlasCache, setCanvasModule } from '@molstar/graphics/geo/geometry/text/font-atlas';
import { afterAll, beforeAll } from 'vitest';

// A view's annotations are drawn as labels (prism.md §5.2), whose text goes into a font atlas, which Node has no canvas
// for: a stand-in context that draws nothing (as stage-tools' distance test), unset after the file (the module is
// shared by the worker's files).

export function stubCanvasForLabels() {
  beforeAll(() => {
    const context = {
      measureText: () => ({ width: 8 }),
      clearRect() {},
      fillText() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    };
    setCanvasModule({ createCanvas: () => ({ getContext: () => context }) });
  });
  afterAll(() => {
    setCanvasModule(undefined);
    clearFontAtlasCache();
  });
}
