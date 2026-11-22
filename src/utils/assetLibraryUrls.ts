import type { SpineSource } from '../types/spine'

const prefixes = [
  'https://cdn.jsdelivr.net/gh/LLsetnow/Brown-Dust-2-Asset@master/',
  'https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/refs/heads/master/',
  'https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/master/',
]

type SpineUrlPair = { skeletonUrl: string; atlasUrl: string }

function versionedSpinePair({ skeletonUrl, atlasUrl }: SpineUrlPair) {
  const prefix = prefixes.find(prefix => skeletonUrl.startsWith(prefix) && atlasUrl.startsWith(prefix))
  if (!prefix) return
  const directory = ['spine-4.2/', 'spine/'].find(dir =>
    skeletonUrl.startsWith(prefix + dir) && atlasUrl.startsWith(prefix + dir),
  )
  if (!directory) return

  const offset = prefix.length + directory.length
  const pair = (root: string): SpineUrlPair => ({
    skeletonUrl: prefix + root + skeletonUrl.slice(offset),
    atlasUrl: prefix + root + atlasUrl.slice(offset),
  })
  return { current: pair('spine-4.2/'), legacy: pair('spine/') }
}

export function spineAssetCandidates(source: Extract<SpineSource, { type: 'url' }>): SpineUrlPair[] {
  const candidates = [{ skeletonUrl: source.skeletonUrl, atlasUrl: source.atlasUrl }]
  if (source.skeletonUrlFallback && source.atlasUrlFallback) {
    candidates.push({ skeletonUrl: source.skeletonUrlFallback, atlasUrl: source.atlasUrlFallback })
  }

  const versions = candidates.map(versionedSpinePair)
  if (!versions[0]) return candidates
  return [
    ...versions.flatMap(pair => pair ? [pair.current] : []),
    ...candidates.map((pair, index) => versions[index]?.legacy ?? pair),
  ]
}

export function libraryAssetUrl(base: string, root: string, remote: string) {
  if (!root) return remote
  const prefix = prefixes.find(prefix => remote.startsWith(prefix))
  if (!prefix) return remote
  try {
    const path = decodeURIComponent(remote.slice(prefix.length).split(/[?#]/)[0]!)
    // Keep real URL directory separators: Spine resolves atlas pages and sibling dating poses relative to them.
    return `${base.replace(/\/?$/, '/')}${path.split('/').map(encodeURIComponent).join('/')}?library=${encodeURIComponent(root)}`
  } catch { return remote }
}
