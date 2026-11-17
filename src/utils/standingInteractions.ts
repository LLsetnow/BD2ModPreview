import illustrationMapping from '../data/illustrationBackgrounds.json' with { type: 'json' }

const illustrations = new Map(Object.entries(illustrationMapping.skeletons).map(([skeleton, illustration]) => [illustration.toLowerCase(), skeleton]))

export function standingSkeleton(filename: string): string | null {
  try {
    const name = decodeURIComponent(filename.split(/[?#]/)[0]!).split(/[\\/]/).pop()!.replace(/\.(skel|json)$/i, '').toLowerCase()
    if (/^char\d{6}$/.test(name)) return name
    return illustrations.get(name) ?? null
  } catch { return null }
}

export function containsTriangle(vertices: ArrayLike<number>, x: number, y: number, a: number, b: number, c: number) {
  const ax = vertices[a * 2]!, ay = vertices[a * 2 + 1]!
  const bx = vertices[b * 2]!, by = vertices[b * 2 + 1]!
  const cx = vertices[c * 2]!, cy = vertices[c * 2 + 1]!
  if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < 0.00001) return false
  const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
  const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx)
  const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
  return !((ab < 0 || bc < 0 || ca < 0) && (ab > 0 || bc > 0 || ca > 0))
}
