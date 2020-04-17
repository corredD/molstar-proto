/**
 * Copyright (c) 2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import UUID from './uuid';
import { iterableToArray } from '../mol-data/util';
import { ajaxGet, DataType, DataResponse, readFromFile } from './data-source';
import { Task } from '../mol-task';

export { AssetManager, Asset };

type _File = File;
type Asset = Asset.Url | Asset.File

namespace Asset {
    export type Url = { kind: 'url', id: UUID, url: string, title?: string, body?: string }
    export type File = { kind: 'file', id: UUID, name: string, file?: _File }

    export function Url(url: string, options?: { body?: string, title?: string }): Url {
        return { kind: 'url', id: UUID.create22(), url, ...options };
    }

    export function File(file: _File): File {
        return { kind: 'file', id: UUID.create22(), name: file.name, file };
    }

    export function isUrl(x?: Asset): x is Url {
        return x?.kind === 'url';
    }

    export function isFile(x?: Asset): x is File {
        return x?.kind === 'file';
    }

    export class Wrapper<T extends DataType = DataType> {
        dispose() {
            this.manager.release(this.asset);
        }

        constructor(public readonly data: DataResponse<T>, private asset: Asset, private manager: AssetManager) {

        }
    }
}

class AssetManager {
    // TODO: add URL based ref-counted cache?
    // TODO: when serializing, check for duplicates?

    private _assets = new Map<string, { asset: Asset, file: File }>();

    get assets() {
        return iterableToArray(this._assets.values());
    }

    set(asset: Asset, file: File) {
        this._assets.set(asset.id, { asset, file });
    }

    resolve<T extends DataType>(asset: Asset, type: T, store = true): Task<Asset.Wrapper<T>> {
        if (Asset.isUrl(asset)) {
            return Task.create(`Download ${asset.title || asset.url}`, async ctx => {
                if (this._assets.has(asset.id)) {
                    return new Asset.Wrapper(await readFromFile(this._assets.get(asset.id)!.file, type).runInContext(ctx), asset, this);
                }

                if (!store) {
                    return new Asset.Wrapper(await ajaxGet({ ...asset, type }).runInContext(ctx), asset, this);
                }

                const data = await ajaxGet({ ...asset, type: 'binary' }).runInContext(ctx);
                const file = new File([data], 'raw-data');
                this._assets.set(asset.id, { asset, file });
                return new Asset.Wrapper(await readFromFile(file, type).runInContext(ctx), asset, this);
            });
        } else {
            return Task.create(`Read ${asset.name}`, async ctx => {
                if (this._assets.has(asset.id)) {
                    return new Asset.Wrapper(await readFromFile(this._assets.get(asset.id)!.file, type).runInContext(ctx), asset, this);
                }
                if (!(asset.file instanceof File)) {
                    throw new Error(`Cannot resolve file asset '${asset.name}' (${asset.id})`);
                }
                if (store) {
                    this._assets.set(asset.id, { asset, file: asset.file });
                }
                return new Asset.Wrapper(await readFromFile(asset.file, type).runInContext(ctx), asset, this);
            });
        }
    }

    release(asset: Asset) {
        this._assets.delete(asset.id);
    }
}