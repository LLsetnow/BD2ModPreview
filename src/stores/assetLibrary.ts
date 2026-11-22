import { defineStore } from 'pinia'
import { readonly, ref, watch } from 'vue'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { libraryAssetUrl } from '../utils/assetLibraryUrls'

export const useAssetLibraryStore = defineStore('assetLibrary', () => {
  const rootDirectory = ref('')
  const activeRoot = ref('')
  const error = ref('')
  let ready: Promise<void> = Promise.resolve()
  let initializing: Promise<void> | undefined
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
  }, { flush: 'sync' })

  function url(remote: string) {
    if (!activeRoot.value) return remote
    return libraryAssetUrl(convertFileSrc('', 'bd2library'), activeRoot.value, remote)
  }
  function localUrl(relative: string) {
    return libraryAssetUrl(convertFileSrc('', 'bd2library'), activeRoot.value, 'https://cdn.jsdelivr.net/gh/LLsetnow/Brown-Dust-2-Asset@master/' + relative)
  }
  function initialize() {
    return initializing ??= (async () => {
      try {
        const directory = await invoke<string | null>('get_shared_asset_library_root')
        if (!rootDirectory.value && directory) rootDirectory.value = directory
        await ready
      } catch (cause) {
        error.value = String(cause)
      }
    })()
  }
  return { rootDirectory, activeRoot: readonly(activeRoot), error: readonly(error), ready: () => ready, initialize, url, localUrl }
})
