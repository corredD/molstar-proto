/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 *
 * Who one audio route moves (audio-routing.ts). Each narrowed route is one shader slot.
 * A render object gets that slot's (instance, group-start, group-end), or a miss.
 * Group index is the element index in the unit (units visuals) or the serial element index
 * (complex visuals). A chain, residue or atom still moves its whole instance: one instance
 * matrix cannot leave the rest of that copy behind. Atom wiggle stays on the atoms in range.
 */

import { Interval, OrderedSet, SortedArray } from '../../mol-data/int';
import type { AnimationData } from '../../mol-geo/geometry/animation';
import { PluginContext } from '../../mol-plugin/context';
import { ElementIndex, Structure, StructureElement, Unit } from '../../mol-model/structure';
import { Model } from '../../mol-model/structure/model';
import { getAudioAffectBinding } from '../../mol-repr/structure/audio-affect-binding';
import { ValueCell } from '../../mol-util';
import { ModelRef } from '../manager/structure/hierarchy-state';
import { AudioAffect, AudioAffectLevel, AudioScopeSlotCount, canonicalAudioAffect } from '../manager/audio-routing';

/** the shader's uAudioAffectRanges[8], one slot per narrowed route */
export const AudioAffectRangeCount = 8;

type Range = { instance: number, groupStart: number, groupEnd: number };

const LevelRank: Record<AudioAffectLevel, number> = {
    all: 0, model: 1, entity: 2, instance: 3, chain: 4, residue: 5, atom: 6,
};

export type AudioAffectChoice = { id: string, label: string, affect: AudioAffect };

/** Indices into `elements` whose values lie in [start, end). `elements` is sorted. */
export function groupSpanInElements(elements: ArrayLike<number>, start: number, end: number): { start: number, end: number } | undefined {
    if (end <= start || elements.length === 0) return;
    const span = SortedArray.findRange(elements as SortedArray, start, end - 1);
    const from = Interval.start(span);
    const to = Interval.end(span);
    if (from >= to) return;
    return { start: from, end: to };
}

function operatorKey(unit: Unit) {
    return unit.conformation.operator.name || `#${unit.id}`;
}

function hierarchyModels(plugin: PluginContext) {
    return plugin.managers.structure.hierarchy.current.models;
}

function modelData(model: ModelRef) {
    return model.cell.obj?.data;
}

function findModel(plugin: PluginContext, affect: AudioAffect): ModelRef | undefined {
    const models = hierarchyModels(plugin);
    if (affect.modelRef) {
        const byRef = models.find(m => m.cell.transform.ref === affect.modelRef && modelData(m));
        if (byRef) return byRef;
    }
    if (affect.entryId) {
        const byEntry = models.find(m => {
            const data = modelData(m);
            return !!data && data.entryId === affect.entryId && (affect.modelNum === undefined || data.modelNum === affect.modelNum);
        });
        if (byEntry) return byEntry;
    }
    return models.find(m => modelData(m));
}

function structuresOf(model: ModelRef): Structure[] {
    const out: Structure[] = [];
    for (const s of model.structures) {
        const data = s.cell.obj?.data;
        if (data) out.push(data);
    }
    return out;
}

function sameRoot(a: Structure, b: Structure) {
    return a === b || Structure.areRootsEquivalent(a, b) || Structure.areEquivalent(a, b);
}

function modelForStructure(plugin: PluginContext, structure: Structure) {
    for (const model of hierarchyModels(plugin)) {
        if (!modelData(model)) continue;
        for (const s of model.structures) {
            const data = s.cell.obj?.data;
            if (data && sameRoot(data, structure)) return model;
        }
        const data = modelData(model);
        if (data && structure.models.some(m => m === data || m.id === data.id)) return model;
    }
}

function entityIds(model: Model) {
    const data = model.entities.data;
    const ids: { id: string, label: string }[] = [];
    for (let i = 0; i < data._rowCount; i++) {
        const id = data.id.value(i);
        const type = data.type.value(i);
        ids.push({ id, label: `${type} ${id}` });
    }
    return ids;
}

function firstEntityId(model: Model) {
    const ids = entityIds(model);
    return ids.find(e => e.label.startsWith('polymer '))?.id ?? ids[0]?.id;
}

function chainsOf(model: Model, entityId: string) {
    const chains = model.atomicHierarchy.chains;
    const out: { asymId: string, authId: string }[] = [];
    for (let i = 0; i < chains._rowCount; i++) {
        if (chains.label_entity_id.value(i) !== entityId) continue;
        out.push({ asymId: chains.label_asym_id.value(i), authId: chains.auth_asym_id.value(i) });
    }
    return out;
}

function chainIndexOf(model: Model, entityId: string, asymId: string) {
    return model.atomicHierarchy.index.findChainLabel({ label_entity_id: entityId, label_asym_id: asymId });
}

function residuesOf(model: Model, entityId: string, asymId: string) {
    const h = model.atomicHierarchy;
    const chain = chainIndexOf(model, entityId, asymId);
    if (chain < 0) return [];
    const elementStart = h.chainAtomSegments.offsets[chain];
    const elementEnd = h.chainAtomSegments.offsets[chain + 1];
    if (elementEnd <= elementStart) return [];
    const from = h.residueAtomSegments.index[elementStart];
    const to = h.residueAtomSegments.index[elementEnd - 1];
    const out: { seqId: number, insCode: string, compId: string }[] = [];
    for (let r = from; r <= to; r++) {
        const atom = h.residueAtomSegments.offsets[r];
        const ins = h.residues.pdbx_PDB_ins_code.value(r);
        out.push({
            seqId: h.residues.auth_seq_id.value(r),
            insCode: ins || '',
            compId: h.atoms.label_comp_id.value(atom),
        });
    }
    return out;
}

function atomsOf(model: Model, affect: AudioAffect) {
    if (!affect.entityId || !affect.asymId || affect.seqId === undefined) return [];
    const h = model.atomicHierarchy;
    const residue = h.index.findResidue(affect.entityId, affect.asymId, affect.seqId, affect.insCode ?? '');
    if (residue < 0) return [];
    const start = h.residueAtomSegments.offsets[residue];
    const end = h.residueAtomSegments.offsets[residue + 1];
    const out: { atomId: string, altId: string }[] = [];
    for (let a = start; a < end; a++) {
        const alt = h.atoms.label_alt_id.value(a);
        out.push({ atomId: h.atoms.label_atom_id.value(a), altId: alt || '' });
    }
    return out;
}

function unitContainsEntity(unit: Unit, entityId: string) {
    if (!Unit.isAtomic(unit) || unit.elements.length === 0) return false;
    const h = unit.model.atomicHierarchy;
    const first = h.chainAtomSegments.index[unit.elements[0]];
    const last = h.chainAtomSegments.index[unit.elements[unit.elements.length - 1]];
    for (let c = first; c <= last; c++) {
        if (h.chains.label_entity_id.value(c) === entityId) return true;
    }
    return false;
}

function unitContainsAsym(unit: Unit, asymId: string) {
    if (!Unit.isAtomic(unit) || unit.elements.length === 0) return false;
    const h = unit.model.atomicHierarchy;
    const first = h.chainAtomSegments.index[unit.elements[0]];
    const last = h.chainAtomSegments.index[unit.elements[unit.elements.length - 1]];
    for (let c = first; c <= last; c++) {
        if (h.chains.label_asym_id.value(c) === asymId) return true;
    }
    return false;
}

function elementRangeFor(unit: Unit, affect: AudioAffect): { start: number, end: number } | undefined {
    if (!Unit.isAtomic(unit)) return { start: 0, end: unit.elements.length };
    const h = unit.model.atomicHierarchy;
    const rank = LevelRank[affect.level];
    if (rank <= LevelRank.instance) return { start: 0, end: unit.elements.length };
    if (!affect.entityId || !affect.asymId) return { start: 0, end: unit.elements.length };
    if (rank === LevelRank.chain) {
        const chain = chainIndexOf(unit.model, affect.entityId, affect.asymId);
        if (chain < 0) return;
        return {
            start: h.chainAtomSegments.offsets[chain],
            end: h.chainAtomSegments.offsets[chain + 1],
        };
    }
    if (affect.seqId === undefined) return;
    if (rank === LevelRank.residue) {
        const residue = h.index.findResidue(affect.entityId, affect.asymId, affect.seqId, affect.insCode ?? '');
        if (residue < 0) return;
        return {
            start: h.residueAtomSegments.offsets[residue],
            end: h.residueAtomSegments.offsets[residue + 1],
        };
    }
    if (!affect.atomId) return;
    const element = h.index.findAtom({
        label_entity_id: affect.entityId,
        label_asym_id: affect.asymId,
        auth_seq_id: affect.seqId,
        pdbx_PDB_ins_code: affect.insCode ?? '',
        label_atom_id: affect.atomId,
        label_alt_id: affect.altId || undefined,
    });
    if (element < 0) return;
    return { start: element, end: element + 1 };
}

function localSpans(unit: Unit, affect: AudioAffect): { start: number, end: number }[] {
    const range = elementRangeFor(unit, affect);
    if (!range) return [];
    if (range.start === 0 && range.end === unit.elements.length) return [{ start: 0, end: unit.elements.length }];
    const span = groupSpanInElements(unit.elements, range.start, range.end);
    return span ? [span] : [];
}

function unitWanted(unit: Unit, affect: AudioAffect) {
    const rank = LevelRank[affect.level];
    if (affect.entityId && rank >= LevelRank.entity && !unitContainsEntity(unit, affect.entityId)) return false;
    if (affect.operatorName && rank >= LevelRank.instance && operatorKey(unit) !== affect.operatorName) return false;
    if (affect.asymId && rank >= LevelRank.chain && !unitContainsAsym(unit, affect.asymId)) return false;
    return true;
}

function rangesForUnits(structure: Structure, group: Unit.SymmetryGroup, affect: AudioAffect): Range[] {
    if (affect.level === 'all') return [{ instance: -1, groupStart: -1, groupEnd: 0 }];
    const rank = LevelRank[affect.level];
    const units = group.units;
    if (rank <= LevelRank.entity) {
        const matching = units.filter(u => unitWanted(u, affect));
        if (!matching.length) return [];
        if (matching.length === units.length) {
            const spans = localSpans(units[0], affect);
            if (spans.length === 1 && spans[0].start === 0 && spans[0].end === units[0].elements.length) {
                return [{ instance: -1, groupStart: -1, groupEnd: 0 }];
            }
            return spans.slice(0, AudioAffectRangeCount).map(s => ({ instance: -1, groupStart: s.start, groupEnd: s.end }));
        }
    }
    const ranges: Range[] = [];
    for (let i = 0; i < units.length && ranges.length < AudioAffectRangeCount; i++) {
        if (!unitWanted(units[i], affect)) continue;
        const spans = localSpans(units[i], affect);
        for (const span of spans) {
            if (ranges.length >= AudioAffectRangeCount) break;
            const whole = span.start === 0 && span.end === units[i].elements.length;
            ranges.push({ instance: i, groupStart: whole ? -1 : span.start, groupEnd: whole ? 0 : span.end });
        }
    }
    return ranges;
}

function rangesForSerial(structure: Structure, affect: AudioAffect): Range[] {
    if (affect.level === 'all') return [{ instance: -1, groupStart: -1, groupEnd: 0 }];
    const ranges: Range[] = [];
    for (const unit of structure.units) {
        if (!unitWanted(unit, affect)) continue;
        const unitIdx = structure.unitIndexMap.get(unit.id);
        if (unitIdx === undefined) continue;
        const cum = structure.serialMapping.cumulativeUnitElementCount[unitIdx];
        const spans = localSpans(unit, affect);
        for (const span of spans) {
            ranges.push({ instance: -1, groupStart: cum + span.start, groupEnd: cum + span.end });
        }
    }
    if (!ranges.length) return [];
    let min = Infinity;
    let max = -Infinity;
    for (const r of ranges) {
        min = Math.min(min, r.groupStart);
        max = Math.max(max, r.groupEnd);
    }
    if (min <= 0 && max >= structure.elementCount) return [{ instance: -1, groupStart: -1, groupEnd: 0 }];
    if (ranges.length > AudioAffectRangeCount) return [{ instance: -1, groupStart: min, groupEnd: max }];
    return ranges;
}

function instancesAllowed(kind: 'units' | 'serial', ranges: Range[], elementCount: number) {
    if (kind === 'units') return 1;
    if (ranges.some(r => r.groupStart < 0)) return 1;
    if (ranges.length === 1 && ranges[0].groupStart <= 0 && ranges[0].groupEnd >= elementCount) return 1;
    return 0;
}

const written = new WeakMap<object, string>();
/** by affect-ranges cell, the scopes and the structure binding its slots were last computed for */
const scopesFor = new WeakMap<object, { key: string, binding: ReturnType<typeof getAudioAffectBinding> }>();
const slotPacked = new Array<number>(AudioScopeSlotCount * 4);

function writeSlots(values: AnimationData) {
    const key = slotPacked.join(',');
    const cell = values.uAudioAffectRanges;
    if (!cell || written.get(cell) === key) return;
    ValueCell.update(cell, slotPacked.slice());
    written.set(cell, key);
}

function packSlot(plugin: PluginContext, binding: ReturnType<typeof getAudioAffectBinding>, affect: AudioAffect, offset: number) {
    const miss = () => {
        slotPacked[offset] = 0;
        slotPacked[offset + 1] = 0;
        slotPacked[offset + 2] = 0;
        slotPacked[offset + 3] = -1;
    };
    if (!binding) return miss();
    const owner = modelForStructure(plugin, binding.structure);
    if (!owner || owner.cell.transform.ref !== affect.modelRef) return miss();
    const ranges = binding.kind === 'units'
        ? rangesForUnits(binding.structure, binding.group, affect)
        : rangesForSerial(binding.structure, affect);
    if (!ranges.length) return miss();
    const range = ranges.find(item => item.instance < 0 && item.groupStart < 0) ?? ranges[0];
    slotPacked[offset] = range.instance;
    slotPacked[offset + 1] = range.groupStart;
    slotPacked[offset + 2] = range.groupEnd;
    // a baked serial mesh cannot move one copy, so instance motion stays off and atom wiggle keeps the span
    slotPacked[offset + 3] = instancesAllowed(binding.kind, ranges, binding.structure.elementCount) ? 1 : 0;
}

/**
 * Pushes each narrowed route's range onto every loaded structure's render objects.
 * Cheap when nothing changed: one key compare per object.
 */
export function syncAudioAffect(plugin: PluginContext) {
    const scopes = plugin.managers.audioReactive.scopes;
    const resolved = scopes.map(slot => resolveAudioAffect(plugin, slot.affect));
    // what the slots name: an object already written for it is skipped (a rebuilt object has a new cell)
    const scopesKey = resolved.map(affect => JSON.stringify(canonicalAudioAffect(affect))).join('|');
    for (const s of plugin.managers.structure.hierarchy.current.structures) {
        const structure = s.cell.obj?.data;
        if (!structure) continue;
        for (const component of s.components) {
            for (const r of component.representations) {
                const repr = r.cell.obj?.data.repr;
                if (!repr) continue;
                for (const ro of repr.renderObjects) {
                    const values = ro.values as Partial<AnimationData>;
                    if (!values.uAudioAffectRanges) continue;
                    const binding = getAudioAffectBinding(ro);
                    const last = scopesFor.get(values.uAudioAffectRanges);
                    if (last && last.key === scopesKey && last.binding === binding) continue;
                    scopesFor.set(values.uAudioAffectRanges, { key: scopesKey, binding });
                    for (let i = 0; i < AudioScopeSlotCount; i++) {
                        if (i >= resolved.length) {
                            slotPacked[i * 4] = 0;
                            slotPacked[i * 4 + 1] = 0;
                            slotPacked[i * 4 + 2] = 0;
                            slotPacked[i * 4 + 3] = -1;
                        } else {
                            packSlot(plugin, binding, resolved[i], i * 4);
                        }
                    }
                    writeSlots(values as AnimationData);
                }
            }
        }
    }
}

/** Drop detail finer than `maxLevel`. */
export function clampAffectToLevel(affect: AudioAffect, maxLevel: AudioAffectLevel): AudioAffect {
    if (LevelRank[affect.level] <= LevelRank[maxLevel]) return affect;
    return clearFiner(affect, maxLevel);
}

function clearFiner(affect: AudioAffect, level: AudioAffectLevel): AudioAffect {
    const next: AudioAffect = { ...affect, level };
    const rank = LevelRank[level];
    if (rank < LevelRank.entity) next.entityId = undefined;
    if (rank < LevelRank.instance) next.operatorName = undefined;
    if (rank < LevelRank.chain) next.asymId = undefined;
    if (rank < LevelRank.residue) {
        next.seqId = undefined;
        next.insCode = undefined;
    }
    if (rank < LevelRank.atom) {
        next.atomId = undefined;
        next.altId = undefined;
    }
    return next;
}

function operatorsOf(model: ModelRef, entityId: string | undefined) {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const structure of structuresOf(model)) {
        for (const unit of structure.units) {
            if (entityId && !unitContainsEntity(unit, entityId)) continue;
            const name = operatorKey(unit);
            if (seen.has(name)) continue;
            seen.add(name);
            names.push(name);
        }
    }
    return names;
}

/** Fill a level from what is loaded, keeping any coarser pick that still exists. */
export function specializeAudioAffect(plugin: PluginContext, current: AudioAffect, level: AudioAffectLevel): AudioAffect {
    if (level === 'all') return { level: 'all' };
    const affect = clearFiner(current, level);
    const model = findModel(plugin, affect) ?? hierarchyModels(plugin).find(m => modelData(m));
    const data = model ? modelData(model) : undefined;
    if (!model || !data) return { level };
    affect.modelRef = model.cell.transform.ref;
    affect.entryId = data.entryId;
    affect.modelNum = data.modelNum;
    if (level === 'model') return canonicalAudioAffect(affect);

    const entities = entityIds(data);
    if (!affect.entityId || !entities.some(e => e.id === affect.entityId)) affect.entityId = firstEntityId(data);
    if (level === 'entity' || !affect.entityId) return canonicalAudioAffect(affect);

    const operators = operatorsOf(model, affect.entityId);
    if (!affect.operatorName || !operators.includes(affect.operatorName)) affect.operatorName = operators[0];
    if (level === 'instance' || !affect.operatorName) return canonicalAudioAffect(affect);

    const chains = chainsOf(data, affect.entityId);
    if (!affect.asymId || !chains.some(c => c.asymId === affect.asymId)) affect.asymId = chains[0]?.asymId;
    if (level === 'chain' || !affect.asymId) return canonicalAudioAffect(affect);

    const residues = residuesOf(data, affect.entityId, affect.asymId);
    if (affect.seqId === undefined || !residues.some(r => r.seqId === affect.seqId && (r.insCode || '') === (affect.insCode || ''))) {
        affect.seqId = residues[0]?.seqId;
        affect.insCode = residues[0]?.insCode || undefined;
    }
    if (level === 'residue' || affect.seqId === undefined) return canonicalAudioAffect(affect);

    const atoms = atomsOf(data, affect);
    if (!affect.atomId || !atoms.some(a => a.atomId === affect.atomId && (a.altId || '') === (affect.altId || ''))) {
        affect.atomId = atoms[0]?.atomId;
        affect.altId = atoms[0]?.altId || undefined;
    }
    return canonicalAudioAffect(affect);
}

/** Reattach a saved affect to the models now loaded. */
export function resolveAudioAffect(plugin: PluginContext, affect: AudioAffect): AudioAffect {
    if (affect.level === 'all') return affect;
    const model = findModel(plugin, affect);
    const data = model ? modelData(model) : undefined;
    if (!model || !data) return affect;
    if (affect.modelRef === model.cell.transform.ref && affect.entryId === data.entryId && affect.modelNum === data.modelNum) return affect;
    return canonicalAudioAffect({ ...affect, modelRef: model.cell.transform.ref, entryId: data.entryId, modelNum: data.modelNum });
}

export function audioAffectFromLoci(plugin: PluginContext, loci: StructureElement.Loci, level: AudioAffectLevel): AudioAffect | undefined {
    if (level === 'all') return { level: 'all' };
    const location = loci.elements[0];
    if (!location || OrderedSet.size(location.indices) === 0) return;
    const unit = location.unit;
    const element = unit.elements[OrderedSet.getAt(location.indices, 0)] as ElementIndex;
    const model = modelForStructure(plugin, loci.structure);
    const data = model ? modelData(model) : undefined;
    const affect: AudioAffect = {
        level,
        modelRef: model?.cell.transform.ref,
        entryId: data?.entryId ?? unit.model.entryId,
        modelNum: data?.modelNum ?? unit.model.modelNum,
    };
    if (LevelRank[level] < LevelRank.entity || !Unit.isAtomic(unit)) return canonicalAudioAffect(affect);
    const h = unit.model.atomicHierarchy;
    const chain = h.chainAtomSegments.index[element];
    affect.entityId = h.chains.label_entity_id.value(chain);
    if (LevelRank[level] < LevelRank.instance) return canonicalAudioAffect(affect);
    affect.operatorName = operatorKey(unit);
    if (LevelRank[level] < LevelRank.chain) return canonicalAudioAffect(affect);
    affect.asymId = h.chains.label_asym_id.value(chain);
    if (LevelRank[level] < LevelRank.residue) return canonicalAudioAffect(affect);
    const residue = h.residueAtomSegments.index[element];
    affect.seqId = h.residues.auth_seq_id.value(residue);
    const ins = h.residues.pdbx_PDB_ins_code.value(residue);
    if (ins) affect.insCode = ins;
    if (LevelRank[level] < LevelRank.atom) return canonicalAudioAffect(affect);
    affect.atomId = h.atoms.label_atom_id.value(element);
    const alt = h.atoms.label_alt_id.value(element);
    if (alt) affect.altId = alt;
    return canonicalAudioAffect(affect);
}

/**
 * All, then the loaded models down to `maxLevel`. Residue and atom rows appear only under the chain
 * already picked, so a capsid does not list every residue of every copy.
 */
export function listRouteScopeChoices(plugin: PluginContext, affect: AudioAffect, maxLevel: AudioAffectLevel): AudioAffectChoice[] {
    const choices: AudioAffectChoice[] = [];
    const push = (next: AudioAffect, label: string) => {
        const canonical = canonicalAudioAffect(next);
        choices.push({ id: JSON.stringify(canonical), label, affect: canonical });
    };
    push({ level: 'all' }, 'All');
    const max = LevelRank[maxLevel];
    const selected = canonicalAudioAffect(affect);
    for (const model of hierarchyModels(plugin)) {
        const data = modelData(model);
        if (!data) continue;
        const modelLabel = data.label || data.entryId || `model ${data.modelNum}`;
        const modelAffect: AudioAffect = { level: 'model', modelRef: model.cell.transform.ref, entryId: data.entryId, modelNum: data.modelNum };
        push(modelAffect, modelLabel);
        if (max < LevelRank.entity) continue;
        for (const entity of entityIds(data)) {
            const entityAffect: AudioAffect = { ...modelAffect, level: 'entity', entityId: entity.id };
            push(entityAffect, `· ${entity.label}`);
            if (max < LevelRank.instance) continue;
            const operators = operatorsOf(model, entity.id);
            for (let i = 0; i < operators.length; i++) {
                const name = operators[i];
                const instanceAffect: AudioAffect = { ...entityAffect, level: 'instance', operatorName: name };
                push(instanceAffect, `·· Instance ${i + 1}`);
                if (max < LevelRank.chain) continue;
                for (const chain of chainsOf(data, entity.id)) {
                    const chainAffect: AudioAffect = { ...instanceAffect, level: 'chain', asymId: chain.asymId };
                    const chainLabel = chain.authId && chain.authId !== chain.asymId ? `${chain.asymId} (${chain.authId})` : chain.asymId;
                    push(chainAffect, `··· Chain ${chainLabel}`);
                    const onChain = max >= LevelRank.residue
                        && LevelRank[selected.level] >= LevelRank.chain
                        && selected.modelRef === modelAffect.modelRef
                        && selected.entityId === entity.id
                        && selected.operatorName === name
                        && selected.asymId === chain.asymId;
                    if (!onChain) continue;
                    for (const residue of residuesOf(data, entity.id, chain.asymId)) {
                        const ins = residue.insCode || undefined;
                        const residueAffect: AudioAffect = { ...chainAffect, level: 'residue', seqId: residue.seqId, insCode: ins };
                        push(residueAffect, `···· ${residue.compId} ${residue.seqId}${residue.insCode}`);
                        const onResidue = max >= LevelRank.atom
                            && LevelRank[selected.level] >= LevelRank.residue
                            && selected.seqId === residue.seqId
                            && (selected.insCode || '') === (residue.insCode || '');
                        if (!onResidue) continue;
                        for (const atom of atomsOf(data, residueAffect)) {
                            push({ ...residueAffect, level: 'atom', atomId: atom.atomId, altId: atom.altId || undefined }, `····· ${atom.altId ? `${atom.atomId} ${atom.altId}` : atom.atomId}`);
                        }
                    }
                }
            }
        }
    }
    return choices;
}

export function listAudioAffectChoices(plugin: PluginContext, affect: AudioAffect): AudioAffectChoice[] {
    if (affect.level === 'all') return [];
    const choices: AudioAffectChoice[] = [];
    const push = (next: AudioAffect, label: string) => {
        const canonical = canonicalAudioAffect(next);
        choices.push({ id: JSON.stringify(canonical), label, affect: canonical });
    };
    if (affect.level === 'model') {
        for (const model of hierarchyModels(plugin)) {
            const data = modelData(model);
            if (!data) continue;
            push({ level: 'model', modelRef: model.cell.transform.ref, entryId: data.entryId, modelNum: data.modelNum }, data.label || data.entryId || `model ${data.modelNum}`);
        }
        return choices;
    }
    const model = findModel(plugin, affect);
    const data = model ? modelData(model) : undefined;
    if (!model || !data) return choices;
    const base: AudioAffect = { level: affect.level, modelRef: model.cell.transform.ref, entryId: data.entryId, modelNum: data.modelNum };
    if (affect.level === 'entity') {
        for (const entity of entityIds(data)) push({ ...base, entityId: entity.id }, entity.label);
        return choices;
    }
    if (!affect.entityId) return choices;
    base.entityId = affect.entityId;
    if (affect.level === 'instance') {
        operatorsOf(model, affect.entityId).forEach((name, i) => push({ ...base, operatorName: name }, `Instance ${i + 1} (${name})`));
        return choices;
    }
    if (!affect.operatorName) return choices;
    base.operatorName = affect.operatorName;
    if (affect.level === 'chain') {
        for (const chain of chainsOf(data, affect.entityId)) {
            push({ ...base, asymId: chain.asymId }, chain.authId && chain.authId !== chain.asymId ? `Chain ${chain.asymId} (${chain.authId})` : `Chain ${chain.asymId}`);
        }
        return choices;
    }
    if (!affect.asymId) return choices;
    base.asymId = affect.asymId;
    if (affect.level === 'residue') {
        for (const residue of residuesOf(data, affect.entityId, affect.asymId)) {
            const ins = residue.insCode ? residue.insCode : undefined;
            push({ ...base, seqId: residue.seqId, insCode: ins }, `${residue.compId} ${residue.seqId}${residue.insCode}`);
        }
        return choices;
    }
    if (affect.seqId === undefined) return choices;
    base.seqId = affect.seqId;
    if (affect.insCode) base.insCode = affect.insCode;
    for (const atom of atomsOf(data, base)) {
        push({ ...base, atomId: atom.atomId, altId: atom.altId || undefined }, atom.altId ? `${atom.atomId} ${atom.altId}` : atom.atomId);
    }
    return choices;
}

export function describeAudioAffect(plugin: PluginContext, affect: AudioAffect) {
    if (affect.level === 'all') return 'Every loaded model';
    const model = findModel(plugin, affect);
    const data = model ? modelData(model) : undefined;
    const parts: string[] = [];
    parts.push(data ? (data.label || data.entryId || `model ${data.modelNum}`) : (affect.entryId ? `${affect.entryId} is not loaded` : 'No model loaded'));
    if (LevelRank[affect.level] >= LevelRank.entity && affect.entityId) {
        const label = data ? entityIds(data).find(e => e.id === affect.entityId)?.label : undefined;
        parts.push(label ?? `entity ${affect.entityId}`);
    }
    if (LevelRank[affect.level] >= LevelRank.instance && affect.operatorName) parts.push(`instance ${affect.operatorName}`);
    if (LevelRank[affect.level] >= LevelRank.chain && affect.asymId) parts.push(`chain ${affect.asymId}`);
    if (LevelRank[affect.level] >= LevelRank.residue && affect.seqId !== undefined) parts.push(`residue ${affect.seqId}${affect.insCode ?? ''}`);
    if (LevelRank[affect.level] >= LevelRank.atom && affect.atomId) parts.push(affect.atomId);
    return parts.join(' · ');
}
