/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import { RelionStarParticleList } from '../../mol-io/reader/relion/star';
import { PluginStateObject } from '../objects';

export class RelionStarParticleListObject extends PluginStateObject.Create<RelionStarParticleList>({ name: 'RELION STAR Particle List', typeClass: 'Object' }) { }
