/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { CIF } from '../../../../mol-io/reader/cif';
import { Mat4, Vec3 } from '../../../../mol-math/linear-algebra';
import { createAssemblies } from '../../../../mol-model-formats/structure/property/assembly';
import { trajectoryFromMmCIF } from '../../../../mol-model-formats/structure/mmcif';
import { Task } from '../../../../mol-task';
import { Structure } from '../../structure';
import { to_mmCIF } from '../mmcif';

/** Two atoms in one chain, enough to exercise asym_id_list and give atom_site a row count to check. */
const TestCif = `data_test
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_asym_id
_atom_site.pdbx_PDB_model_num
ATOM 1 N N GLY A 1 1 1.000 2.000 3.000 1.00 0.00 1 A 1
ATOM 2 C CA GLY A 1 1 4.000 5.000 6.000 1.00 0.00 1 A 1
`;

/** Same, but already carrying an assembly, to check the source rows do not leak into the output. */
const TestCifWithAssembly = `data_test
_pdbx_struct_assembly.id                  1
_pdbx_struct_assembly.details             'source assembly'
#
_pdbx_struct_assembly_gen.assembly_id        1
_pdbx_struct_assembly_gen.oper_expression    1
_pdbx_struct_assembly_gen.asym_id_list       A
#
_pdbx_struct_oper_list.id               1
_pdbx_struct_oper_list.type             'identity operation'
_pdbx_struct_oper_list.name             1_555
_pdbx_struct_oper_list.matrix[1][1]     1.0
_pdbx_struct_oper_list.matrix[1][2]     0.0
_pdbx_struct_oper_list.matrix[1][3]     0.0
_pdbx_struct_oper_list.matrix[2][1]     0.0
_pdbx_struct_oper_list.matrix[2][2]     1.0
_pdbx_struct_oper_list.matrix[2][3]     0.0
_pdbx_struct_oper_list.matrix[3][1]     0.0
_pdbx_struct_oper_list.matrix[3][2]     0.0
_pdbx_struct_oper_list.matrix[3][3]     1.0
_pdbx_struct_oper_list.vector[1]        0.0
_pdbx_struct_oper_list.vector[2]        0.0
_pdbx_struct_oper_list.vector[3]        0.0
#
${TestCif.substring(TestCif.indexOf('loop_'))}`;

async function getTestStructure(cif = TestCif) {
    const parsed = await CIF.parseText(cif).run();
    if (parsed.isError) throw new Error(parsed.message);
    const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0] as any).run();
    const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
    return Structure.ofModel(model);
}

async function readBackAssemblies(cif: string) {
    const parsed = await CIF.parseText(cif).run();
    if (parsed.isError) throw new Error(parsed.message);
    const db = CIF.schema.mmCIF(parsed.result.blocks[0]);
    return {
        db,
        assemblies: createAssemblies(db.pdbx_struct_assembly, db.pdbx_struct_assembly_gen, db.pdbx_struct_oper_list)
    };
}

describe('instance assembly export', () => {
    it('is absent unless requested', async () => {
        const structure = await getTestStructure();
        const cif = to_mmCIF('test', structure, false) as string;
        expect(cif).not.toContain('pdbx_struct_oper_list');
    });

    it('writes one operator per transform and keeps a single copy of the coordinates', async () => {
        const structure = await getTestStructure();
        const transforms = [
            Mat4.identity(),
            Mat4.fromTranslation(Mat4(), Vec3.create(10, 20, 30)),
            Mat4.fromRotation(Mat4(), Math.PI / 2, Vec3.unitZ),
        ];

        const cif = to_mmCIF('test', structure, false, { instanceAssembly: { transforms } }) as string;
        const { db, assemblies } = await readBackAssemblies(cif);

        // a single copy of the coordinates, not one per instance
        expect(db.atom_site._rowCount).toBe(structure.elementCount);

        expect(db.pdbx_struct_oper_list._rowCount).toBe(transforms.length);
        expect(assemblies.length).toBe(1);

        const groups = assemblies[0].operatorGroups;
        expect(groups.length).toBe(1);
        expect(groups[0].asymIds).toEqual(['A']);
        expect(groups[0].operators.length).toBe(transforms.length);
    });

    it('round-trips operator matrices through the reader without transposing', async () => {
        const structure = await getTestStructure();
        // deliberately asymmetric so a transpose cannot go unnoticed
        const rotated = Mat4.fromRotation(Mat4(), Math.PI / 3, Vec3.create(1, 2, 3));
        Mat4.setTranslation(rotated, Vec3.create(-7.5, 11.25, 0.5));
        const transforms = [rotated, Mat4.fromTranslation(Mat4(), Vec3.create(1.5, -2.5, 3.5))];

        const cif = to_mmCIF('test', structure, false, { instanceAssembly: { transforms } }) as string;
        const { assemblies } = await readBackAssemblies(cif);
        const operators = assemblies[0].operatorGroups[0].operators;

        expect(operators.length).toBe(transforms.length);
        for (let i = 0; i < transforms.length; ++i) {
            for (let j = 0; j < 16; ++j) {
                expect(operators[i].matrix[j]).toBeCloseTo(transforms[i][j], 4);
            }
        }
    });

    // the export button always passes copyAllCategories, so that path needs its own coverage
    it('replaces the source assembly on the copyAllCategories path', async () => {
        const structure = await getTestStructure(TestCifWithAssembly);
        const transforms = [
            Mat4.fromTranslation(Mat4(), Vec3.create(5, 0, 0)),
            Mat4.fromTranslation(Mat4(), Vec3.create(0, 6, 0)),
            Mat4.fromTranslation(Mat4(), Vec3.create(0, 0, 7)),
        ];

        const cif = to_mmCIF('test', structure, false, {
            copyAllCategories: true,
            instanceAssembly: { transforms }
        }) as string;

        // exactly one of each category, not the source's plus ours
        expect(cif.match(/_pdbx_struct_oper_list\.id/g)?.length).toBe(1);
        expect(cif.match(/_pdbx_struct_assembly\.id/g)?.length).toBe(1);
        expect(cif.match(/_pdbx_struct_assembly_gen\.assembly_id/g)?.length).toBe(1);
        expect(cif).not.toContain('source assembly');

        const { db, assemblies } = await readBackAssemblies(cif);
        expect(db.pdbx_struct_oper_list._rowCount).toBe(transforms.length);
        expect(db.atom_site._rowCount).toBe(structure.elementCount);

        const operators = assemblies[0].operatorGroups[0].operators;
        expect(operators.length).toBe(transforms.length);
        for (let i = 0; i < transforms.length; ++i) {
            for (let j = 0; j < 16; ++j) {
                expect(operators[i].matrix[j]).toBeCloseTo(transforms[i][j], 4);
            }
        }
    });

    it('keeps the source assembly on the copyAllCategories path when no instances are given', async () => {
        const structure = await getTestStructure(TestCifWithAssembly);
        const cif = to_mmCIF('test', structure, false, { copyAllCategories: true }) as string;
        expect(cif).toContain('source assembly');
        expect(cif.match(/_pdbx_struct_oper_list\.id/g)?.length).toBe(1);
    });

    it('expands a compact oper_expression for many instances', async () => {
        const structure = await getTestStructure();
        const transforms: Mat4[] = [];
        for (let i = 0; i < 250; ++i) {
            transforms.push(Mat4.fromTranslation(Mat4(), Vec3.create(i, 0, 0)));
        }

        const cif = to_mmCIF('test', structure, false, { instanceAssembly: { transforms } }) as string;
        expect(cif).toContain('1-250');

        const { assemblies } = await readBackAssemblies(cif);
        const operators = assemblies[0].operatorGroups[0].operators;
        expect(operators.length).toBe(250);
        expect(Mat4.getValue(operators[249].matrix, 0, 3)).toBeCloseTo(249, 4);
    });
});
