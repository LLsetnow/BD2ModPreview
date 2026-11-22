import { BaseDirectory, readTextFile } from "@tauri-apps/plugin-fs"
import bundledIndex from "../data/cutscenes/index.json"
import { useAssetCatalogStore } from "../stores/assetCatalog"
import { useAssetLibraryStore } from "../stores/assetLibrary"
import type { Scene } from "../composables/useGameCutscene"
import { useLogger } from "../composables/useLogger"

const bundled = import.meta.glob<{ default: Scene }>("../data/cutscenes/[0-9]*.json")
const options = { baseDir: BaseDirectory.AppData }
const { logMessage } = useLogger()

function validScene(data: any): data is Scene {
  return data && Number.isInteger(data.revision) && data.revision > 0 &&
    Number.isFinite(data.duration) && data.duration > 0 &&
    Array.isArray(data.nodes) && data.nodes.length > 0 &&
    data.nodes.every((node: any) => node && typeof node.path === "string" &&
      node.position && node.scale && node.size && node.pivot && node.anchorMin && node.anchorMax && node.color) &&
    Array.isArray(data.curves) && Array.isArray(data.tracks) && data.tracks.length > 0 &&
    data.tracks.every((track: any) => track && Number.isInteger(track.node) &&
      track.node >= 0 && track.node < data.nodes.length && Array.isArray(track.clips) &&
      track.clips.every((clip: any) => clip && typeof clip.name === "string" &&
        [clip.start, clip.duration, clip.clipIn, clip.speed].every(Number.isFinite)))
}

async function readSaved(id: string): Promise<Scene | null> {
  try {
    const path = `cutscenes/${id}.json`
    const data = JSON.parse(await readTextFile(path, options))
    if (!validScene(data)) throw new Error("Invalid saved timeline")
    return data
  } catch {
    return null
  }
}

export async function loadCutscene(id: string): Promise<Scene | null> {
  if (!/^\d+$/.test(id)) return null
  const catalog = await useAssetCatalogStore().load()
  const revision = catalog ? catalog.cutsceneRevisions[id] : (bundledIndex as Record<string, number>)[id]
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return null

  const saved = await readSaved(id)
  if (saved?.revision === revision) return saved
  const loadBundled = bundled[`../data/cutscenes/${id}.json`]
  const baseline = loadBundled ? (await loadBundled()).default : null
  if (baseline?.revision === revision) return baseline

  const library = useAssetLibraryStore()
  try {
    const path = `spine/cutscenes/timelines/${id}.r${revision}.json`
    const response = await fetch(library.localUrl(path), { cache: "no-store", signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: unknown = await response.json()
    if (!validScene(data) || data.revision !== revision) throw new Error("Invalid timeline revision")
    return data
  } catch (error) {
    logMessage(`Could not load cutscene ${id} revision ${revision}: ${error}`, "warning")
    return saved ?? baseline
  }
}
