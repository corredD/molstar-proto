/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { IconName } from '../components/icon/icon.js';
import type { Child } from '../dom/jsx-types.js';
import type { ParamsFormModel } from '../forms/params-form.js';

/**
 * A row of a group that is not a param of its form: a setting of the UI itself (the UI scale, styling.md §6), shown
 * before the form. The search finds it by its label and keywords, as it finds a param.
 */
export interface SettingsRow {
  label: string;
  /** More words the search finds it by. */
  keywords?: string;
  view: () => Child;
}

/**
 * A group of settings by intent (Appearance, Camera, Interaction, Performance, Interface, Behaviors, Advanced): a form
 * over the plugin's params (canvas, canvas context, layout, behaviors) mapped into it, so no param is lost and new ones
 * land in Advanced. Changes apply as they are made.
 */
export interface SettingsGroup {
  id: string;
  title: string;
  icon: IconName;
  form: ParamsFormModel<any>;
  /** Labels are long here (behaviors: "Camera Focus Loci on Canvas"): give them the row, the controls are small. */
  wideLabels?: boolean;
  /** Rows before the form (`SettingsRow`). */
  rows?: readonly SettingsRow[];
}

/** Whether `row` matches the search text (empty matches all). */
export function settingsRowMatch(row: SettingsRow, text: string): boolean {
  const q = text.trim().toLowerCase();
  return !q || row.label.toLowerCase().includes(q) || !!row.keywords?.toLowerCase().includes(q);
}

/** The Settings tab (implemented over Canvas3D, Canvas3DContext, the layout, and `plugin.state.behaviors`). */
export interface SettingsModel {
  groups: readonly SettingsGroup[];
}
