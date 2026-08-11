import { ParamState } from '../redux/param/param-slice';
import { imageStoreIndexedDB } from '../util/image-store-indexed-db';
import { RMPSave, stringifyParam } from '../util/save';

/**
 * Export a portable save. The normal in-browser state only contains references
 * to local images; include their IndexedDB data so a save works on another device.
 */
export const stringifySelfHostedSave = async (param: ParamState) => {
    const save = JSON.parse(stringifyParam(param)) as RMPSave;
    const images: NonNullable<RMPSave['images']> = [];

    for (const id of save.graph.nodes) {
        const attrs = id.attributes as Record<string, any>;
        const image = attrs.image as { href?: string } | undefined;
        if (attrs.type !== 'image' || !image?.href?.startsWith('img-l')) continue;

        const base64 = await imageStoreIndexedDB.get(image.href);
        if (base64) images.push({ id: image.href, base64 });
    }

    if (images.length > 0) save.images = images;
    return JSON.stringify(save);
};
