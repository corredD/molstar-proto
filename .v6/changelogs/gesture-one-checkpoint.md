## Prism: sliders' undo

- Prism's sliders (`gestureSteps`: the map levels, the transfer function, the representation quick controls, and apps'
  and extensions' live sliders) take one history checkpoint a drag, at its start, not one per applied step: on a scene
  whose snapshot is over 50 ms one drag no longer turns undo off. A drag is all or nothing: a step refused mid-drag
  stops the drag's steps and undoes it at its end. After a step that threw, the next change starts another drag (it
  went nowhere, and the release's value was lost).
