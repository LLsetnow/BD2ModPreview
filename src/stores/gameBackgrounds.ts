import { defineStore } from "pinia";
import { ref } from "vue";
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
	const backgroundDirectory = useLocalStorage("GAME_BACKGROUND_DIRECTORY", "F:\\Neowiz\\Brown-Dust-2-Asset-master\\backgrounds\\cutscene");
	const cacheSize = ref(0);
	const prompt = ref<BackgroundPrompt | null>(null);
	const decided = new Set<string>();
	const loaded = new Map<string, Promise<string>>();
	let pendingApply: (() => void) | null = null;

	function load(hash: string): Promise<string> {
		const key = `${backgroundDirectory.value}|${hash}`;
		let request = loaded.get(key);
		if (!request) {
			request = invoke<string>("get_game_background", { hash, backgroundDirectory: backgroundDirectory.value });
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
		if (
			mode.value === "always" ||
			(await invoke<boolean>("has_game_backgrounds", { hashes, backgroundDirectory: backgroundDirectory.value }))
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

	return { mode, showByDefault, backgroundDirectory, cacheSize, prompt, load, refreshCacheSize, clearCache, offer, answer };
});
