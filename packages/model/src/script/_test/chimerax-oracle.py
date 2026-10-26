# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
#
# Records ChimeraX's atom counts for the atom specs in chimerax-oracle.json, which chimerax-oracle.test.ts compares
# Mol*'s against. By hand, with ChimeraX installed (fetches 1TUP; Mol*'s test reads data/examples/1tup.bcif):
#   ChimeraX --nogui --exit --script packages/model/src/script/_test/chimerax-oracle.py
import json, os
from chimerax.core.commands import run, atomspec

here = os.path.dirname(os.path.abspath(__file__))
examples = os.path.join(here, '../../../../../data/examples')
path = os.path.join(here, 'chimerax-oracle.json')
with open(path) as f:
    fixture = json.load(f)

opens = {'1cbs_updated.cif': 'open ' + os.path.join(examples, '1cbs_updated.cif'), '1tup.bcif': 'open 1tup'}
for name, entry in fixture['structures'].items():
    run(session, 'close')
    run(session, opens[name])
    counts = {}
    for spec in entry['specs']:
        counts[spec] = len(atomspec.AtomSpecArg.parse(spec, session)[0].evaluate(session).atoms)
    entry['counts'] = counts

with open(path, 'w') as f:
    json.dump(fixture, f, indent=2)
    f.write('\n')
