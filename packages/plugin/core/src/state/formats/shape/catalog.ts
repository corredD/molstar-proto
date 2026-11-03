/**
 * Copyright (c) 2018-2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { PlyProvider } from './ply.js';
import { ObjProvider } from './obj.js';
import { VtpProvider } from './vtp.js';
import { GltfProvider } from './gltf.js';

export const BuiltInShapeFormats = [PlyProvider, ObjProvider, VtpProvider, GltfProvider] as const;

export type BuiltInShapeFormat = (typeof BuiltInShapeFormats)[number]['name'];

/** @deprecated use BuiltInShapeFormat */
export type BuildInShapeFormat = BuiltInShapeFormat;
