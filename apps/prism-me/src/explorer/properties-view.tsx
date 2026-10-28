/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { type Child, SectionList, type ShellModel } from '@molstar/prism-ui';
import { classes } from './_generated/properties.module.css.js';

// The picked row's properties as ui.md §4 draws them, shared by the app (properties.tsx) and its mock
// (_stories/properties.tsx): Prism UI only, no viewer, so the story stays pure. Its name and kind, what goes above the
// sections (a model's Group by), then the sections that apply on Prism's `SectionList` (open as the person left each,
// from pick to pick: one slot, its open state in the shell model the owner keeps; a folded section paused). Lines are a
// label in the label column (`--msp-label-width`) and a control.

export { classes as propertiesClasses };

/** The slot of the properties' sections */
export const PropertiesSlot = 'explorer:properties';

/** What each kind of row is called in the header: the app's kinds and the mock's */
const KindNames: Readonly<Record<string, string>> = {
  category: 'Category',
  structure: 'Structure',
  entity: 'Entity',
  'model entity': 'Entity',
  chain: 'Chain',
  model: 'Mesoscale model',
  'mesoscale model': 'Mesoscale model',
  group: 'Group',
  list: 'Particle list',
  'particle list': 'Particle list',
  target: 'Target',
  volume: 'Volume',
  slice: 'Slice',
  'oblique slice': 'Oblique slice',
  isosurface: 'Isosurface',
  'volume representation': 'Representation',
  mesh: 'Mesh',
  clip: 'Clip',
  label: 'Label',
  distance: 'Distance',
};

/** A row's kind as the header names it (an unknown one: as it is, capitalized) */
export function kindName(kind: string): string {
  return KindNames[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The properties of one picked row: made again for each pick (the section list's subject is fixed); `shell` outlives
 * the picks, so a section stays open (or folded) as the person left it
 */
export function PropertiesFrame(props: {
  shell: ShellModel;
  /** Its name (the label's text, the clip's shape: as it changes) */
  name: Child;
  kind: string;
  subject: unknown;
  /** Above the sections, not folded (a model's Group by) */
  above?: Child;
  /** Sections the person has not opened yet start folded (the app); else open (the stories, to be seen) */
  collapsed?: boolean;
}) {
  return (
    <div class={classes.stack}>
      <div class={classes.title}>
        <strong class={classes.name} data-properties-name="" data-tip-overflow="">
          {props.name}
        </strong>
        <span class={classes.hint} data-properties-kind="">
          {kindName(props.kind)}
        </span>
      </div>
      {props.above ?? null}
      <SectionList shell={props.shell} slot={PropertiesSlot} subject={props.subject} flat collapsed={props.collapsed} />
    </div>
  );
}

/** A line: its label in the label column (none: the column kept empty), then its control */
export function Line(props: { label?: string; children: Child }) {
  return (
    <div class={classes.line}>
      <span class={classes.lineLabel}>{props.label ?? ''}</span>
      {props.children}
    </div>
  );
}

/** A faint line of words (what is missing, how to add it) */
export function Hint(props: { children: Child }) {
  return <span class={classes.hint}>{props.children}</span>;
}
