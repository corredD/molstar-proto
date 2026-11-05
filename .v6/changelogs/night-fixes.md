## prism-me: night fixes

- A structure's handle release goes through `stage.move`, so its clip and labels follow, in one undo step; a mesh's
  clip moves with it; `stage.scale` carries a list's labels and clips.
- Remove of an object with its labels is one undo step. A picked row whose object, label or clip is gone is no longer
  picked. A right-click on a label keeps its Move.
- Clip whole Objects clears the atoms flag a graded way left hidden. By zoom on a uniform-colored list keeps its color.
  The examples list is fetched again after an HTTP error.
- `stage.label`, `cryoet` and `mesoscale` colors take what Prism's picker takes (`#f80`, `rgb()`, `hsl()`, names).
- Faster: a big group row's hover and pick (`Particle.selectLoci` merges in pairs), no `includes` per id in the clip
  ways, one objects state per explorer, no recount of a list's entities after each move.
