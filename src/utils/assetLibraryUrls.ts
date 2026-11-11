const prefixes = [
  'https://cdn.jsdelivr.net/gh/bruhnn/Brown-Dust-2-Asset@master/',
  'https://raw.githubusercontent.com/bruhnn/Brown-Dust-2-Asset/refs/heads/master/',
  'https://raw.githubusercontent.com/bruhnn/Brown-Dust-2-Asset/master/',
]

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
