import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { readonly, ref, watch } from 'vue'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { libraryAssetUrl } from '../utils/assetLibraryUrls'

function initialRoot() {
  for (const [key, suffix] of [['DATING_AUDIO_DIRECTORY', /[\\/]audio[\\/]dating[\\/]?$/i], ['GAME_BACKGROUND_DIRECTORY', /[\\/]backgrounds[\\/]cutscene[\\/]?$/i]] as const) {
    const value = localStorage.getItem(key)
    if (value && suffix.test(value)) return value.replace(suffix, '')
  }
  return 'F:\\Neowiz\\Brown-Dust-2-Asset-master'
}

export const useAssetLibraryStore = defineStore('assetLibrary', () => {
  const rootDirectory = useLocalStorage('ASSET_LIBRARY_ROOT', initialRoot())
  const activeRoot = ref('')
  const error = ref('')
  let ready: Promise<void> = Promise.resolve()
  let generation = 0
  watch(rootDirectory, directory => {
    const request = ++generation
    ready = invoke('set_asset_library_root', { directory }).then(() => {
      if (request !== generation) return
      activeRoot.value = directory.trim(); error.value = ''
    }).catch(cause => {
      if (request !== generation) return
      activeRoot.value = ''; error.value = String(cause)
    })
  }, { immediate: true, flush: 'sync' })

  function url(remote: string) {
    if (!activeRoot.value) return remote
    return libraryAssetUrl(convertFileSrc('', 'bd2library'), activeRoot.value, remote)
  }
  return { rootDirectory, activeRoot: readonly(activeRoot), error: readonly(error), ready: () => ready, url }
})
