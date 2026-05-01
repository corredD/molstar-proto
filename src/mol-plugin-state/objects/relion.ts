/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { ParticleList, ParticleListSet } from '../../mol-io/reader/particle-list';
import { PluginStateObject } from '../objects';

export class ParticleListSetObject extends PluginStateObject.Create<ParticleListSet>({ name: 'Particle List Set', typeClass: 'Object' }) { }
export class RelionStarParticleListObject extends PluginStateObject.Create<ParticleList>({ name: 'Particle List', typeClass: 'Object' }) { }
