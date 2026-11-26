/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Virus capsids (PDB IDs) the Random button picks from, with the mesoscale examples (app.tsx MesoscaleExamples)
export const RandomStructurePdbIds = [
    '2tbv', // tomato bushy stunt virus
    '2plv', // poliovirus
    '4rhv', // human rhinovirus 14
    '1al2', // poliovirus P1/Mahoney
    '1stm', // satellite panicum mosaic virus
    '1a34', // satellite tobacco mosaic virus with RNA
    '2buk', // satellite tobacco necrosis virus
    '2ms2', // bacteriophage MS2
    '1cwp', // cowpea chlorotic mottle virus
    '1smv', // sesbania mosaic virus
    '2bbv', // black beetle virus
    '1f8v', // pariacoto virus
    '1sva', // simian virus 40
] as const;
