/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author OpenAI
 */

import '../viewer/favicon.ico';
import './index.html';
import './style.scss';
import '../../mol-plugin-ui/skin/light.scss';
import { mountVirusOnTheRockApp } from './app';

void mountVirusOnTheRockApp();

export * from './app';
