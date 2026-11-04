# Lane assistant-tools (2026-11-03)

Branch `me/assistant-tools`, worktree `~/prism-me-lanes/assistant-tools`, dev server port 1348.

## Brief (Ludo, 2026-11-03)

"The assistant could not start: Tool "add_label" is registered twice", on opening the Assistant with nothing loaded;
then "yes" to: leave Prism's Measurements tools out where the stage tools have the same names, and a test that the
explorer's tools have one name each.

## Built

- `apps/prism-me/src/spec.ts` `withoutStageTools`: Prism's skills that name a stage tool, each without those tools,
  added by the same id (it takes the default's place). Measurements keeps `list_measurements` and `remove_measurement`;
  `add_label`, `measure_distance`, `measure_angle`, `measure_dihedral` are the stage tools'.
- `_test/assistant-tools.test.ts`: every declared tool id once (the core, Prism's skills after the change, each
  extension's, a lazy one's stub's: their tools join only on disclosure, where a duplicate would throw mid-turn); the
  headless agent's toolkit is made. Both fail on the old spec ("add_label" registered twice; 4 ids twice).
- In the browser (1348): the Assistant opens, 101 tools, 21 skills.

## Review

| Finding                                                         | Verdict    | Commit                                       |
| --------------------------------------------------------------- | ---------- | -------------------------------------------- |
| list/remove of Prism's measurements lost                        | should-fix | fixed: Measurements replaced, not removed    |
| `add_label` no longer labels an atom or residue by selection    | should-fix | noted in features.md and the changelog; open |
| the test misses lazy skills' tools                              | should-fix | fixed: declared ids checked                  |
| the clash was four ids, not two; features.md row; progress file | nits       | fixed                                        |

## Learned

The stage tools and Prism's Measurements clashed since stage-tools gained `measure_distance` (2026-10-24); no test built
the explorer's agent, so the Assistant was broken unseen.

Size: about 20 production lines (brief: 10), the rest tests.
