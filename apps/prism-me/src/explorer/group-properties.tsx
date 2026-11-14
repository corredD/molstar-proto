/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Icon, TextInput } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { ViewerApi } from '@molstar/prism-viewer/api';
import { Hint, Line, propertiesClasses as classes } from './properties-view.js';

// A list's Group section (paint-group; _spec/ui.md §4, Group): Pick instances (a click in 3D adds or removes one, a
// group copy whole; Esc stops), their count, a name, and Make group (`mesoscale.group`, one step). The group is then a
// row of the list (Paint with it).

export function GroupProps(props: { api: ViewerApi; particles: string }) {
  const area = props.api.mesoscale;
  if (!area) return <Hint>The mesoscale tools are not loaded.</Hint>;
  const pick = area.groupPick;
  const here = mapState(pick.state.asReadonly, (s) => (s?.particles === props.particles ? s : undefined));
  const on = mapState(here, (s) => !!s);
  const count = mapState(here, (s) => s?.instances.length ?? 0);
  let name = '';
  const make = async () => {
    const indices = pick.indices;
    if (!indices.length) return;
    const r = await props.api.run('mesoscale.group', {
      particles: props.particles,
      indices,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (r.ok) pick.stop();
  };
  return (
    <div class={classes.tight}>
      <Line label="Instances">
        <Button
          size="xs"
          variant="ghost"
          icon={<Icon name="mouse-pointer-click" />}
          pressed={on}
          title="Click particles in 3D: a click adds or removes an instance (a group copy whole); Esc stops"
          onClick={() => (on.value ? pick.stop() : area.startGroupPick(props.particles))}
        >
          {mapState(on, (o) => (o ? 'Stop picking' : 'Pick instances'))}
        </Button>
        <Hint>{mapState(count, (n) => (n === 1 ? '1 picked' : `${n} picked`))}</Hint>
      </Line>
      <Line label="Name">
        <TextInput
          size="sm"
          aria-label="The group's name"
          placeholder="Group 1, Group 2, …"
          onInput={(v) => {
            name = v;
          }}
          onSubmit={(v) => {
            name = v;
            void make();
          }}
        />
      </Line>
      <Line>
        <Button
          size="xs"
          icon={<Icon name="layers" />}
          disabled={mapState(count, (n) => n === 0)}
          title="The instances picked made a group: a brush of the list, painted and grown as one; they stay"
          onClick={() => void make()}
        >
          Make group
        </Button>
      </Line>
    </div>
  );
}
