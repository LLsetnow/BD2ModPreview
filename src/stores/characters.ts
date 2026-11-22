import { readonly, shallowRef } from "vue";
import { defineStore } from "pinia";
import { Character, LocalizedName } from "../types/character";
import { useI18n } from "vue-i18n"
import { useLogger } from "../composables/useLogger";
import { useAssetLibraryStore } from "./assetLibrary";

interface CharactersJson {
	version: string;
	characters: Character[];
	dating: DatingMap;
}

type DatingMap = Record<string, string>;

export const useCharactersStore = defineStore("characters", () => {
	const { logMessage } = useLogger();
	const { locale } = useI18n()
	const library = useAssetLibraryStore()

	const characters = shallowRef<Character[]>([]);
	const datingMap = shallowRef<DatingMap>({});

	function getLocalizedName(names: LocalizedName) {
		const language: Record<string, keyof LocalizedName> = {
			en_US: "en", zh_CN: "cn", ja_JP: "jp", ko_KR: "kr", zh_TW: "tw",
		}
		return names[language[locale.value] ?? "en"] || names.en
	}

	function getCharacterById(id: string) {
		return characters.value.find((char) => char.id === id);
	}

	function getCharacterByDatingId(id: string) {
		return characters.value.find((char) => char.dating_id === id);
	}

	function getCharacterIdByDatingId(id: string) {
		return datingMap.value[id];
	}

	async function loadCharacters() {
		await library.ready()
		for (const url of [library.localUrl("characters.json"), "/data/characters.json"]) {
			try {
				const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) })
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const data: CharactersJson = await response.json()
				if (typeof data.version !== "string" || !Array.isArray(data.characters) ||
					!data.dating || typeof data.dating !== "object" || Array.isArray(data.dating)) {
					throw new Error("Invalid characters.json catalog")
				}
				characters.value = data.characters
				datingMap.value = data.dating
				return
			} catch (error) {
				logMessage(`Could not read character catalog from ${url}: ${error}`, "warning")
			}
		}
	}

	return {
		characters: readonly(characters),
		loadCharacters,
		getCharacterById,
		getLocalizedName,
		getCharacterIdByDatingId,
		getCharacterByDatingId,
	};
});
