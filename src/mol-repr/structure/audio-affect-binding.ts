/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Which structure a render object was built from, so the audio "who" scope can mask it.
 * Units visuals have one symmetry group (instance index = unit in that group, group index = element in the unit).
 * Complex visuals bake every unit into one mesh (group index = serial element index).
 */

import { Structure, Unit } from '../../mol-model/structure';

export type AudioAffectBinding =
    | { kind: 'units', structure: Structure, group: Unit.SymmetryGroup }
    | { kind: 'serial', structure: Structure };

const bindings = new WeakMap<object, AudioAffectBinding>();

export function bindAudioAffect(renderObject: object, binding: AudioAffectBinding) {
    bindings.set(renderObject, binding);
}

export function getAudioAffectBinding(renderObject: object) {
    return bindings.get(renderObject);
}
