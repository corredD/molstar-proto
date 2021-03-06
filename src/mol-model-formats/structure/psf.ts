/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { PsfFile } from '../../mol-io/reader/psf/parser';
import { Column, Table } from '../../mol-data/db';
import { EntityBuilder } from './common/entity';
import { ComponentBuilder } from './common/component';
import { guessElementSymbolString } from './util';
import { MoleculeType, getMoleculeType } from '../../mol-model/structure/model/types';
import { getChainId } from './common/util';
import { Task } from '../../mol-task';
import { ModelFormat } from './format';
import { Topology } from '../../mol-model/structure/topology/topology';
import { createBasic, BasicSchema } from './basic/schema';

function getBasic(atoms: PsfFile['atoms']) {
    const auth_atom_id = atoms.atomName
    const auth_comp_id = atoms.residueName

    const entityIds = new Array<string>(atoms.count)
    const asymIds = new Array<string>(atoms.count)
    const seqIds = new Uint32Array(atoms.count)
    const ids = new Uint32Array(atoms.count)

    const entityBuilder = new EntityBuilder()
    const componentBuilder = new ComponentBuilder(atoms.residueId, atoms.atomName)

    let currentEntityId = ''
    let currentAsymIndex = 0
    let currentAsymId = ''
    let currentSeqId = 0
    let prevMoleculeType = MoleculeType.Unknown
    let prevResidueNumber = -1

    for (let i = 0, il = atoms.count; i < il; ++i) {
        const residueNumber = atoms.residueId.value(i)
        if (residueNumber !== prevResidueNumber) {
            const compId = atoms.residueName.value(i)
            const moleculeType = getMoleculeType(componentBuilder.add(compId, i).type, compId)

            if (moleculeType !== prevMoleculeType || residueNumber !== prevResidueNumber + 1) {
                currentAsymId = getChainId(currentAsymIndex)
                currentAsymIndex += 1
                currentSeqId = 0
            }

            currentEntityId = entityBuilder.getEntityId(compId, moleculeType, currentAsymId)
            currentSeqId += 1

            prevResidueNumber = residueNumber
            prevMoleculeType = moleculeType
        }

        entityIds[i] = currentEntityId
        asymIds[i] = currentAsymId
        seqIds[i] = currentSeqId
        ids[i] = i
    }

    const auth_asym_id = Column.ofStringArray(asymIds)

    const atom_site = Table.ofPartialColumns(BasicSchema.atom_site, {
        auth_asym_id,
        auth_atom_id,
        auth_comp_id,
        auth_seq_id: atoms.residueId,
        id: Column.ofIntArray(ids),

        label_asym_id: auth_asym_id,
        label_atom_id: auth_atom_id,
        label_comp_id: auth_comp_id,
        label_seq_id: Column.ofIntArray(seqIds),
        label_entity_id: Column.ofStringArray(entityIds),

        occupancy: Column.ofConst(1, atoms.count, Column.Schema.float),
        type_symbol: Column.ofStringArray(Column.mapToArray(atoms.atomName, s => guessElementSymbolString(s))),

        pdbx_PDB_model_num: Column.ofConst(1, atoms.count, Column.Schema.int),
    }, atoms.count)

    return createBasic({
        entity: entityBuilder.getEntityTable(),
        chem_comp: componentBuilder.getChemCompTable(),
        atom_site
    })
}

//

export { PsfFormat }

type PsfFormat = ModelFormat<PsfFile>

namespace PsfFormat {
    export function is(x: ModelFormat): x is PsfFormat {
        return x.kind === 'psf'
    }

    export function fromPsf(psf: PsfFile): PsfFormat {
        return { kind: 'psf', name: psf.id, data: psf };
    }
}

export function topologyFromPsf(psf: PsfFile): Task<Topology> {
    return Task.create('Parse PSF', async ctx => {
        const format = PsfFormat.fromPsf(psf);
        const basic = getBasic(psf.atoms)

        const { atomIdA, atomIdB } = psf.bonds

        const bonds = {
            indexA: Column.ofLambda({
                value: (row: number) => atomIdA.value(row) - 1,
                rowCount: atomIdA.rowCount,
                schema: atomIdA.schema,
            }),
            indexB: Column.ofLambda({
                value: (row: number) => atomIdB.value(row) - 1,
                rowCount: atomIdB.rowCount,
                schema: atomIdB.schema,
            }),
            order: Column.ofConst(1, psf.bonds.count, Column.Schema.int)
        }

        return Topology.create(psf.id, basic, bonds, format)
    })
}