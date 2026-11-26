/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * What a mesoscale structure is part of, as the mesoscale explorer splits them: a membrane, a protein sitting in one,
 * a protein inside, or (cellPACK) one outside any compartment.
 * - Petworld: one structure per model and kind; the membrane is the model's asym ids starting with `MEM`.
 * - cellPACK: one structure per entity; its kind is the last node of the entity's compartment path
 *   (`root.cell.membrane`, `root.cell.surface.proteins`, `root.cell.interior.fibers`, ...).
 */

import { Structure, StructureElement, StructureProperties, Unit } from '../../mol-model/structure';
import { State, StateObjectCell, StateTransform } from '../../mol-state';
import { Model } from '../../mol-model/structure/model';
import { MmcifFormat } from '../../mol-model-formats/structure/mmcif';

export type MesoscalePart = 'membrane' | 'surface' | 'interior' | 'other'

export const MesoscalePartLabel: Record<MesoscalePart, string> = {
    membrane: 'Membrane',
    surface: 'Surface proteins',
    interior: 'Interior proteins',
    other: 'Other proteins',
};

/** the tag of a mesoscale file's whole-assembly structure, which its parts are cut from and which is never drawn */
export const MesoscaleBaseTag = 'mesoscale-base';

function isPetworldModel(model: Model) {
    return MmcifFormat.is(model.sourceData) && !!model.sourceData.data.frame.categories.pdbx_model;
}

function isCellpackModel(model: Model) {
    if (!MmcifFormat.is(model.sourceData)) return false;
    const { frame, db } = model.sourceData.data;
    if (frame.header.toUpperCase().includes('CELLPACK')) return true;
    const { method_details } = db.pdbx_struct_assembly;
    for (let i = 0, il = method_details.rowCount; i < il; ++i) {
        if (method_details.value(i).toUpperCase() === 'CELLPACK') return true;
    }
    return false;
}

/** the kind of a cellPACK entity, from its compartment path (its description less the last node) */
function cellpackPart(structure: Structure): MesoscalePart {
    const unit = structure.units[0];
    const location = StructureElement.Location.create(structure, unit, unit.elements[0]);
    const description = StructureProperties.entity.pdbx_description(location)[0] || '';
    const path = description.toLowerCase().split('.').slice(0, -1);
    if (path[path.length - 1] === 'membrane') return 'membrane';
    if (path.includes('surface')) return 'surface';
    if (path.includes('interior')) return 'interior';
    return 'other';
}

function isMembraneAsym(asymId: string) {
    return asymId.startsWith('MEM');
}

const modelHasMembrane = new WeakMap<Model, boolean>();
function hasMembrane(model: Model) {
    let has = modelHasMembrane.get(model);
    if (has === undefined) {
        const { label_asym_id, _rowCount } = model.atomicHierarchy.chains;
        has = false;
        for (let i = 0; i < _rowCount; ++i) {
            if (isMembraneAsym(label_asym_id.value(i))) {
                has = true;
                break;
            }
        }
        modelHasMembrane.set(model, has);
    }
    return has;
}

function unitIsMembrane(unit: Unit) {
    if (!Unit.isAtomic(unit) || unit.elements.length === 0) return false;
    const h = unit.model.atomicHierarchy;
    const first = h.chainAtomSegments.index[unit.elements[0]];
    const last = h.chainAtomSegments.index[unit.elements[unit.elements.length - 1]];
    for (let c = first; c <= last; ++c) {
        if (!isMembraneAsym(h.chains.label_asym_id.value(c))) return false;
    }
    return true;
}

const partCache = new WeakMap<Structure, MesoscalePart | null>();

/**
 * The part a mesoscale structure is: a Petworld one (one model, membrane or not) or a cellPACK one (one entity);
 * undefined for any other structure, a cellPACK file's whole assembly included
 */
export function getMesoscalePart(structure: Structure): MesoscalePart | undefined {
    let part = partCache.get(structure);
    if (part === undefined) {
        part = null;
        const model = structure.models.length === 1 ? structure.models[0] : undefined;
        if (model && structure.units.length > 0) {
            if (isPetworldModel(model)) {
                part = unitIsMembrane(structure.units[0]) ? 'membrane' : hasMembrane(model) ? 'surface' : 'interior';
            } else if (isCellpackModel(model) && structure.unitSymmetryGroups.length > 0 && isSingleEntity(structure)) {
                part = cellpackPart(structure);
            }
        }
        partCache.set(structure, part);
    }
    return part ?? undefined;
}

function isSingleEntity(structure: Structure) {
    const location = StructureElement.Location.create(structure);
    let id: string | undefined;
    for (const group of structure.unitSymmetryGroups) {
        const unit = group.units[0];
        location.unit = unit;
        location.element = unit.elements[0];
        const entityId = StructureProperties.entity.id(location);
        if (id === undefined) id = entityId;
        else if (id !== entityId) return false;
    }
    return true;
}

/**
 * The example a mesoscale part belongs to: a Petworld part hangs from its trajectory, a cellPACK part names the
 * whole-assembly structure it is cut from (`structureRef`). Its label is the download's (the file's, the example's).
 */
export function getMesoscaleGroup(state: State, cell: StateObjectCell): { ref: string, label: string } {
    const params = cell.transform.params as { structureRef?: unknown } | undefined;
    const ref = typeof params?.structureRef === 'string' && params.structureRef ? params.structureRef : cell.transform.parent;
    let top = ref;
    let parent = state.tree.transforms.get(top)?.parent;
    while (parent && parent !== StateTransform.RootRef) {
        top = parent;
        parent = state.tree.transforms.get(top)?.parent;
    }
    const label = state.cells.get(top)?.obj?.label ?? state.cells.get(ref)?.obj?.label ?? 'Mesoscale';
    return { ref, label };
}

/** membrane and the proteins in it move along the surface normal; the inside keeps the free wave */
export function isMesoscaleSurfacePart(part: MesoscalePart | undefined) {
    return part === 'membrane' || part === 'surface';
}
