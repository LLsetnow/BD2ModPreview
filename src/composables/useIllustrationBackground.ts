import { computed, ref, watch, type Ref } from 'vue'
import type { PreviewBackground } from '../stores/previewer'
import { useAssetLibraryStore } from '../stores/assetLibrary'
import { useAssetCatalogStore } from '../stores/assetCatalog'
import { loadNovelBackground } from '../data/novelBackgrounds'
import { findIllustrationBackground } from '../utils/illustrationBackground'

export function useIllustrationBackground(
  background: Ref<PreviewBackground | null>,
  showByDefault: () => boolean,
  warn: (message: string) => void,
) {
  const library = useAssetLibraryStore()
  const catalog = useAssetCatalogStore()
  const filename = ref('')
  const info = computed(() => findIllustrationBackground(filename.value, catalog.catalog?.illustrationBackgrounds))
  const image = ref('')
  const loading = ref(false)

  watch([info, () => background.value?.type, () => library.activeRoot], async ([entry, type], _previous, onCleanup) => {
    let cancelled = false
    onCleanup(() => { cancelled = true })
    image.value = ''
    loading.value = false
    if (!entry || type !== 'illustration') return
    loading.value = true
    try {
      const path = await loadNovelBackground(entry.id)
      if (cancelled) return
      if (path) image.value = path
      else warn(`Illustration background unavailable: ${entry.illustration} → ${entry.resource}`)
    } catch (error) {
      if (!cancelled) warn(`Illustration background failed: ${error}`)
    } finally {
      if (!cancelled) loading.value = false
    }
  })

  function load(value: string) {
    filename.value = value
    if (!info.value && background.value?.type === 'illustration') background.value = { type: 'theme' }
    else if (info.value && background.value?.type === 'theme' && showByDefault()) background.value = { type: 'illustration' }
  }

  return { info, image, loading, load, clear: () => { filename.value = '' } }
}
