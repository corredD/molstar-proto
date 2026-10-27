/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { PluginContext } from '@molstar/plugin/context';
import { RepresentationClip } from '@molstar/plugin/state/helpers/representation-clip';
import type { CutObject } from './cuts.js';
import { ClipBinding } from './gizmo/binding.js';

// A cut previewed outside the state (clipping.md §4): a view's gesture on a cut's numbers (a slider going) shows the cut
// as it goes on its live representations, as a handle's drag does (the same binding: a clip-only update, uniforms
// only), and its release is the app's one `clipping.update`. One preview in flight, the latest waiting (the others
// dropped); `end` puts back what the state holds once the one in flight lands.

export class CutPreview {
  readonly #binding: ClipBinding;
  /** The cut previewed, as the state held it when the preview began */
  #from: CutObject | undefined;
  #pending: CutObject | undefined;
  #running = false;
  #ending = false;

  constructor(plugin: PluginContext) {
    this.#binding = new ClipBinding(plugin, () => []);
  }

  /** Whether a preview is on */
  get active(): boolean {
    return this.#from !== undefined;
  }

  /** `from` (a cut as the state holds it) shown as `next` on its representations, not in the state */
  show(from: CutObject, next: CutObject): void {
    this.#ending = false;
    if (!this.#from || !RepresentationClip.sameCut(this.#from, from)) {
      // another cut: the one previewed back to the state first
      if (this.#from) this.#binding.cancel();
      this.#from = from;
      this.#binding.begin('', from);
    }
    this.#pending = next;
    if (!this.#running) void this.#flush();
  }

  /** The representations back to what the state holds (after a commit: as it now is) */
  end(): void {
    if (!this.#from) return;
    this.#pending = undefined;
    this.#ending = true;
    if (!this.#running) this.#restore();
  }

  async #flush() {
    this.#running = true;
    try {
      while (this.#pending && this.#from) {
        const next = this.#pending;
        this.#pending = undefined;
        await this.#binding.preview('', this.#from, next);
      }
    } finally {
      this.#running = false;
    }
    if (this.#ending) this.#restore();
  }

  #restore() {
    this.#binding.cancel();
    this.#from = undefined;
    this.#ending = false;
  }
}
