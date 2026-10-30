## Graphics: ghosts of what clips cut

- A clip object's `ghost` (`Clip.Params`): what it cuts is drawn again as faint outlines only, by a depth draw of the
  cut part into the transparent depth that the outline pass outlines (outlines on); `Scene.hasGhosts`,
  `Renderer.renderDepthGhost`. `OutlineParams.transparentColor` (null: the outline's color) colors transparent
  outlines and the ghosts. Prism: `clipping.update` `ghost`; the Mesoscale Explorer on Prism: a clip's Ghosts,
  Outline what it cuts.
