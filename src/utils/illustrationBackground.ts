import fallbackMapping from '../data/illustrationBackgrounds.json' with { type: 'json' }

type IllustrationMapping = { backgrounds: Record<string, string>; skeletons: Record<string, string> }

export function findIllustrationBackground(filename: string, mapping: IllustrationMapping = fallbackMapping) {
  let name: string
  try {
    name = decodeURIComponent(filename.split(/[?#]/)[0]!).split(/[\\/]/).pop()!
      .replace(/\.(skel|json)$/i, '').toLowerCase()
  } catch { return null }
  // Standing previews use PrefabName (charNNNNNN), while IllustName names the UI image.
  // Some NPC designs use a different prefab ID, so follow the table instead of deriving it.
  if (/^char\d{6}$/.test(name)) name = mapping.skeletons[name] ?? ''
  if (!/^illust_char\d{6}_\d+$/.test(name)) return null
  const resource = mapping.backgrounds[name]
  const match = resource?.match(/^novel_background_(\d+)$/)
  return match ? { illustration: name, resource, id: Number(match[1]) } : null
}
