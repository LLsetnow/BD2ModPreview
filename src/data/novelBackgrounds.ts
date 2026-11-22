import { useAssetLibraryStore } from '../stores/assetLibrary';
import { useAssetCatalogStore } from '../stores/assetCatalog';
const GITHUB = "https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/refs/heads/master/ui/novel_background/";
// VITE_ASSET_BASE (for example http://127.0.0.1:8787/) points at a local copy of the asset repo.
const BASE = import.meta.env.VITE_ASSET_BASE
	? `${import.meta.env.VITE_ASSET_BASE}ui/novel_background/`
	: "https://cdn.jsdelivr.net/gh/LLsetnow/Brown-Dust-2-Asset@master/ui/novel_background/";

export const novelThumbnail = (id: number) => useAssetLibraryStore().url(`${BASE}thumb/novel_background_${id}.webp`);

export const novelBackgroundIds = () => useAssetCatalogStore().catalog?.novelBackgroundIds ?? [];

export async function loadNovelBackground(id: number) {
	const library = useAssetLibraryStore();
	await library.ready();
	for (const base of [BASE, GITHUB]) {
		const image = new Image();
		image.src = library.url(`${base}novel_background_${id}.png`);
		try {
			await image.decode();
			return image.src;
		} catch {}
	}
	return null;
}
