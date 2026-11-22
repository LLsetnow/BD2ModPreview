import { shallowRef, shallowReadonly } from 'vue'
import { defineStore } from 'pinia'
import { useAssetLibraryStore } from './assetLibrary'
import { useLogger } from '../composables/useLogger'

export interface MinigameCatalogEntry {
  id: string
  name: string
  skeleton: string
  atlas: string
  characters: Array<{ id: number; costumeId: string }>
  animations: {
    characterPattern: string
    characterNameTemplate: string
    idleTemplate: string
    feverIdleSuffix?: string
    reactions: Record<string, string[] | { tap: string; count: number }>
  }
  sounds?: Record<string, string>
}

export interface PreviewAssetCatalog {
  schemaVersion: number
  gameVersion: string
  catalogVersion: string
  illustrationBackgrounds: {
    backgrounds: Record<string, string>
    skeletons: Record<string, string>
  }
  novelBackgroundIds: number[]
  datingAssets: Record<string, string[]>
  cutsceneRevisions: Record<string, number>
  minigames: MinigameCatalogEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(entry => typeof entry === 'string')
}

function isMinigame(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.animations)) return false
  const { animations } = value
  return [value.id, value.name, value.skeleton, value.atlas, animations.characterPattern,
    animations.characterNameTemplate, animations.idleTemplate].every(entry => typeof entry === 'string') &&
    Array.isArray(value.characters) && value.characters.every(character =>
      isRecord(character) && Number.isSafeInteger(character.id) && typeof character.costumeId === 'string') &&
    isRecord(animations.reactions) && Object.entries(animations.reactions).every(([action, reaction]) =>
      Array.isArray(reaction) ? reaction.every(entry => typeof entry === 'string') :
        action === 'fever' && isRecord(reaction) && typeof reaction.tap === 'string' && Number.isSafeInteger(reaction.count)) &&
    (animations.feverIdleSuffix === undefined || typeof animations.feverIdleSuffix === 'string') &&
    (value.sounds === undefined || isStringMap(value.sounds))
}

function isCatalog(value: unknown): value is PreviewAssetCatalog {
  if (!isRecord(value) || !isRecord(value.illustrationBackgrounds)) return false
  return value.schemaVersion === 1 && typeof value.gameVersion === 'string' &&
    typeof value.catalogVersion === 'string' &&
    isStringMap(value.illustrationBackgrounds.backgrounds) && isStringMap(value.illustrationBackgrounds.skeletons) &&
    Array.isArray(value.novelBackgroundIds) && value.novelBackgroundIds.every(Number.isSafeInteger) &&
    isRecord(value.datingAssets) && Object.values(value.datingAssets).every(assets =>
      Array.isArray(assets) && assets.every(asset => typeof asset === 'string')) &&
    isRecord(value.cutsceneRevisions) && Object.entries(value.cutsceneRevisions).every(([id, revision]) =>
      /^\d+$/.test(id) && typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) &&
    Array.isArray(value.minigames) && value.minigames.every(isMinigame)
}

export const useAssetCatalogStore = defineStore('assetCatalog', () => {
  const library = useAssetLibraryStore()
  const { logMessage } = useLogger()
  const catalog = shallowRef<PreviewAssetCatalog | null>(null)
  let request: Promise<PreviewAssetCatalog | null> | undefined
  let requestedRoot = ''
  let generation = 0

  async function load(): Promise<PreviewAssetCatalog | null> {
    await library.ready()
    const root = String(library.activeRoot || '')
    if (catalog.value && requestedRoot === root) return catalog.value
    if (request && requestedRoot === root) return request
    if (requestedRoot !== root) catalog.value = null
    requestedRoot = root
    const current = ++generation
    request = (async () => {
      try {
        const response = await fetch(library.localUrl('modpreview.json'), {
          cache: 'no-store', signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const value = await response.json()
        if (!isCatalog(value)) throw new Error('Invalid modpreview.json catalog')
        if (current === generation) catalog.value = value
        return value
      } catch (error) {
        logMessage(`Could not load asset catalog: ${String(error)}`, 'warning')
        return current === generation ? catalog.value : null
      } finally {
        if (current === generation) request = undefined
      }
    })()
    return request
  }

  return { catalog: shallowReadonly(catalog), load }
})
