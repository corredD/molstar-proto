# Decisions for Ludo

Moved to a Claude doc (Ludo answers there): https://claude.ai/artifact/Jh985ir9vUiRxaUagxuKqV. This file is the
2026-11-13 snapshot; the doc is the one to read.

Write your answer after `Answer:` (yes / no / a value / a sentence). Leave it empty to decide later. Tell Claude
"decisions updated" and each answered point goes into the spec and, where needed, a lane.

Each point: what it is now, then the question.

## From paint-refine (merged into prism-me)

### 1. A fiber unit as the Grow source
Now: a fiber painted on a surface has its units' axis along the path, tangent to the surface. Growing from its last
unit turns the copies about 90° off it.
Question: should such a source use its offset direction as its "up"?
Answer:

### 2. Place Auto over a mesh
Now: with Place Auto, a non-membrane brush paints at a depth, turned at random; only Place Surface stands copies on
the mesh's normal.
Question: should Auto switch to Surface whenever the pointer is over a mesh?
Answer:

### 3. Painted fibers following the normal
Now: a grown walk/helix keeps its units' up along the surface normal; a fiber painted on a surface (Fiber on) does not.
Question: should painted fibers get the same?
Answer:

### 4. Undo after Grow
Now: not reproduced (⌘Z, History's Undo, Chrome and WebKit, during a big grow). A test pins it.
Question: if you saw it fail, which Undo, which browser, which scene? (A large scene turns undo off.)
Answer:

### 5. Rotating in Paint
Now: left drag paints, so Alt+left drag is the only way to rotate while painting (right drag pans, wheel zooms).
Question: OK as is?
Answer:

## From grow-helix (not merged yet)

### 6. Helix defaults
Now: Pitch 4 × the copy's diameter, Radius 1 × the diameter (in space), Turns 5.
Question: keep these?
Answer:

### 7. Helix going Down
Now: Down keeps the hand (the same helix going the other way), not a mirror.
Question: keep?
Answer:

### 8. Helix Turns or Length
Now: Turns only, no Length setting.
Question: keep?
Answer:

### 9. The painted copy and the helix
Now: the source is not one of the helix's copies; the first unit is one Rise along it.
Question: keep?
Answer:

### 10. Merge grow-helix
Now: on branch me/grow-helix, live on port 1368 (Helix, live settings, Count, Clear; Spiral in progress).
Question: merge into prism-me and push once Spiral is done?
Answer:

## From grow-mesh

### 11. Rings beside Count on a mesh
Now: Tiling on a mesh uses Count; Rings is still shown.
Question: keep Rings beside Count on a mesh, or hide it there?
Answer:

## Earlier

### 12. Grow round 2: Symmetry
Now: not started. Point groups Cn, Dn, T, O, I; helical; the structure's space group. Then density-weight
(plans/2026-11-10-paint-on-density.md).
Question: start it, and in which order?
Answer:

### 13. Color… on a VTP
Now: a part's Color… replaces a VTP's array coloring with one color.
Question: allowed, or should Color… leave an array theme alone?
Answer:

### 14. bin.ts and VolumeFromCcp4.bin
Now: library code that lives only on prism-me.
Question: move them to their own lane from master (for upstream)?
Answer:

### 15. mesoscope.scripps.edu
Now: mesoscope has prism-me at eb77182ab (grow-mesh); paint-refine is not on it.
Question: update mesoscope with the current prism-me (and grow-helix once merged)?
Answer:

## Added since (grow-helix round 2)

### 16. Mode change on a live grow
Now: picking another Mode turns the last grow into the new mode (same grow, one undo step).
Question: keep, or should a Mode change start a new grow?
Answer:

### 17. Clear and fewer copies take the grows built on them
Now: Clear also removes grows made from the cleared copies; lowering a Count removes grows made from the removed
copies.
Question: keep?
Answer:

### 18. Seed on a grow made again
Now: a live grow keeps its seed while the Seed box is empty.
Question: keep?
Answer:

### 19. Helix Turns on the 5° grid
Now: Turns ends at the last 5° step, so it can stop slightly short of the exact number.
Question: OK?
Answer:

## Added since (grow-helix round 3: Spiral)

### 20. Spiral Step is the fiber's Rise
Now: Step (Å between copies along the arm) is the spiral's Rise: one distance control, not two.
Question: keep?
Answer:

### 21. Spiral length by Count
Now: Count is the length control; Turns is shown only (read-only).
Question: keep?
Answer:

### 22. Spiral center
Now: copy k sits k × Step along the arc from the source, no minimum radius at the center (the first turn's copies
sit closer than a Step in a straight line).
Question: keep, or add a minimum center radius?
Answer:

### 23. Spiral on a curved mesh
Now: rolled over the surface: exact on the capsid's body (cylinder, cone), arms close up on caps and vesicles until
it stops. A true geodesic spiral needs geodesic distances (more work).
Question: rolled is enough, or a geodesic spiral?
Answer:

### 24. Spiral stops before crossing itself
Now: it stops where it would cross its own arm (e.g. wrapping around the capsid's body: Count 120 gave 80 copies);
the section still shows the asked Count.
Question: keep? Should the Count slider show the copies actually made?
Answer: Skip crowded, keep going (Ludo, 2026-11-13, in chat) — copies that would land on an earlier arm are skipped
and the spiral continues until Count copies are placed; in progress in grow-helix round 3b.

### 25. Shared values between modes
Now: Arm spacing shares its value with Tiling's Spacing, Count with Sphere's Count.
Question: keep shared, or give each mode its own?
Answer:
