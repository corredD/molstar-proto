# Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
#
# @author Ludovic Autin <autin@scripps.edu>
#
# Runs every line of chimerax-oracle.json in ChimeraX and records whether ChimeraX reads it (chimerax-oracle.test.ts
# checks that each example of the ChimeraX table is one ChimeraX takes). By hand, with ChimeraX installed (it fetches
# 1TQN), after `UPDATE_SPEC=1` wrote the lines:
#   ChimeraX --nogui --exit --script packages/extensions/command-language/src/language/_test/chimerax-oracle.py
import json, os
from chimerax.core.commands import run

here = os.path.dirname(os.path.abspath(__file__))
examples = os.path.join(here, '../../../../../../data/examples')
path = os.path.join(here, 'chimerax-oracle.json')
with open(path) as f:
    fixture = json.load(f)

def fresh():
    run(session, 'close', log=False)
    run(session, 'open ' + os.path.join(examples, '1cbs_updated.cif'), log=False)
    run(session, 'open 1tqn', log=False)

results = {}
for line in fixture['lines']:
    fresh()
    try:
        run(session, line, log=False)
        results[line] = 'ok'
    except Exception as e:
        results[line] = str(e).split('\n')[0][:200]
fixture['results'] = results
with open(path, 'w') as f:
    json.dump(fixture, f, indent=2)
    f.write('\n')
