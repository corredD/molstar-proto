/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Issues (design.md §7.4): every failure, unmet constraint and assumption the runtime reports, as data a UI can explain.
// Codes are stable and namespaced; `path` is a JSON pointer into the document; `phase` says which stage found it.

export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssuePhase = 'static' | 'load' | 'resolve' | 'render';

export interface Issue {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly phase: IssuePhase;
  readonly message: string;
  /** JSON pointer into the document (`/populations/3/abundance`). */
  readonly path?: string;
  /** The document ids the issue is about. */
  readonly ids?: readonly string[];
  /** For an unmet constraint: what was asked and what came out. */
  readonly constraint?: {
    readonly kind: string;
    readonly requested: number;
    readonly achieved: number;
    /** Why, in words a UI shows (the compartment is full at a packing fraction of 0.41, …). */
    readonly reason?: string;
  };
}

export const IssueCodes = {
  'format.version': 'The format or version is not one this runtime reads',
  'id.invalid': 'An id does not match the id pattern',
  'id.duplicate': 'Two nodes have the same id',
  'ref.missing': 'A reference names no node',
  'ref.kind': 'A reference names a node of the wrong kind',
  'compartment.cycle': 'Compartments contain each other',
  'frame.world': 'Not exactly one world frame',
  'frame.handedness': 'A frame does not say its handedness',
  'frame.unaligned': 'A spatial resource is in a frame with no alignment to the world',
  'location.membrane': 'A membrane location in a compartment without a membrane',
  'unit.unknown': 'A unit is not one the format knows',
  'value.range': 'A value is out of its range',
  'model.overlap': 'A population is realized by more than one model',
  'model.unrealized': 'A population is realized by no model: the default resolver packs it',
  'model.cycle': "Models avoid each other's copies in a cycle",
  'resolver.unknown': 'No resolver for a model method',
  'resolver.unsupported': 'The resolver cannot realize part of what the document asks',
  'resolver.failed': 'The resolver threw',
  'resource.unavailable': 'A resource could not be loaded',
  'constraint.unmet': 'A constraint was not met',
  'relation.ignored': "A relation no resolver of the scene honours (it stays the document's statement)",
  'catalog.unexpanded': 'A catalog was not expanded into populations',
  'assumption': 'The resolver made a choice the document did not make',
} as const;

export type IssueCode = keyof typeof IssueCodes | `${string}.${string}`;

export function issue(
  code: IssueCode,
  severity: IssueSeverity,
  phase: IssuePhase,
  message: string,
  extra?: Partial<Pick<Issue, 'path' | 'ids' | 'constraint'>>,
): Issue {
  return { code, severity, phase, message, ...extra };
}

export function hasErrors(issues: readonly Issue[]) {
  return issues.some((i) => i.severity === 'error');
}
