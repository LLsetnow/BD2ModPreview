import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { useAssetLibraryStore } from './assetLibrary';
import { useLocalStorage } from "@vueuse/core";
import { invoke } from "@tauri-apps/api/core";

export interface BackgroundPrompt {
	key: string;
	count: number;
	bytes: number;
}

export const useGameBackgroundStore = defineStore("gameBackgrounds", () => {
	const mode = useLocalStorage<"ask" | "always">("GAME_BACKGROUND_MODE", "ask");
	const showByDefault = useLocalStorage("GAME_BACKGROUND_SHOW", true);
	const showIllustrationByDefault = useLocalStorage("ILLUSTRATION_BACKGROUND_SHOW", true);
	const library = useAssetLibraryStore();
	const cacheSize = ref(0);
	const prompt = ref<BackgroundPrompt | null>(null);
	const decided = new Set<string>();
	const loaded = new Map<string, Promise<string>>();
	let pendingApply: (() => void) | null = null;

	function load(hash: string): Promise<string> {
		const key = `${library.activeRoot}|${hash}`;
		let request = loaded.get(key);
		if (!request) {
			request = library.ready().then(() => invoke<string>("get_game_background", { hash }));
			request.then(refreshCacheSize, () => loaded.delete(key));
			loaded.set(key, request);
		}
		return request;
	}

	async function refreshCacheSize() {
		cacheSize.value = await invoke<number>("get_game_background_cache_size");
	}

	async function clearCache() {
		await invoke("clear_game_background_cache");
		loaded.clear();
		await refreshCacheSize();
	}

	async function offer(
		key: string,
		hashes: string[],
		bytes: number,
		apply: () => void,
	) {
		if (!showByDefault.value || decided.has(key)) return;
		await library.ready();
		if (
			mode.value === "always" ||
			(await invoke<boolean>("has_game_backgrounds", { hashes }))
		) {
			decided.add(key);
			apply();
		} else if (!prompt.value) {
			prompt.value = { key, count: hashes.length, bytes };
			pendingApply = apply;
		}
	}

	function answer(accept: boolean, remember: boolean) {
		if (!prompt.value) return;
		decided.add(prompt.value.key);
		prompt.value = null;
		if (remember) {
			if (accept) mode.value = "always";
			else showByDefault.value = false;
		}
		if (accept) pendingApply?.();
		pendingApply = null;
	}

	watch(() => library.activeRoot, () => { loaded.clear(); decided.clear(); prompt.value = null; pendingApply = null });
	return { mode, showByDefault, showIllustrationByDefault, cacheSize, prompt, load, refreshCacheSize, clearCache, offer, answer };
});
