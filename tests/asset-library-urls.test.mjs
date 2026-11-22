import assert from 'node:assert/strict'
import test from 'node:test'
import { libraryAssetUrl, spineAssetCandidates } from '../src/utils/assetLibraryUrls.ts'

const base = 'http://bd2library.localhost/'
const root = 'F:\\Neowiz\\Brown-Dust-2-Asset-master'
const cdn = 'https://cdn.jsdelivr.net/gh/LLsetnow/Brown-Dust-2-Asset@master/'
const github = 'https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/refs/heads/master/'

test('Spine atlas pages resolve inside the selected skeleton folder', () => {
  const atlas = libraryAssetUrl(base, root, cdn + 'spine/char/char001207/char001207.atlas')
  assert.equal(new URL('texture page.png', atlas).pathname, '/spine/char/char001207/texture%20page.png')
})
test('dating pose URLs retain their sibling directory structure', () => {
  const skeleton = new URL(libraryAssetUrl(base, root, cdn + 'spine/illust/illust_dating/illust_dating22_1/illust_dating22_1.skel'))
  const parts = skeleton.pathname.split('/')
  parts[parts.length - 2] = 'illust_dating22_2'
  parts[parts.length - 1] = 'illust_dating22_2.skel'
  skeleton.pathname = parts.join('/')
  assert.equal(skeleton.pathname, '/spine/illust/illust_dating/illust_dating22_2/illust_dating22_2.skel')
})
test('all supported upstream URLs map to the same local asset', () => {
  const path = 'ui/novel_background/texture%20page.png'
  const urls = [cdn + path, 'https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/refs/heads/master/' + path, 'https://raw.githubusercontent.com/LLsetnow/Brown-Dust-2-Asset/master/' + path]
  assert.equal(new Set(urls.map(url => libraryAssetUrl(base, root, url))).size, 1)
})
test('changing roots invalidates URLs while disabled or unrelated URLs stay original', () => {
  assert.notEqual(libraryAssetUrl(base, root, cdn + 'ui/a.png'), libraryAssetUrl(base, 'D:\\Other', cdn + 'ui/a.png'))
  assert.equal(libraryAssetUrl(base, '', cdn + 'ui/a.png'), cdn + 'ui/a.png')
  assert.equal(libraryAssetUrl(base, root, 'https://example.com/a.png'), 'https://example.com/a.png')
})

test('official previews try both Spine 4.2 sources before the legacy folder', () => {
  for (const path of [
    'char/char067203/char067203',
    'cutscenes/cutscene_char067203/cutscene_char067203',
    'illust/illust_dating/illust_dating22_1/illust_dating22_1',
  ]) {
    const old = 'spine/' + path
    const pairs = spineAssetCandidates({
      type: 'url',
      skeletonUrl: cdn + old + '.skel',
      atlasUrl: cdn + old + '.atlas',
      skeletonUrlFallback: github + old + '.skel',
      atlasUrlFallback: github + old + '.atlas',
    })
    assert.deepEqual(pairs, [cdn + 'spine-4.2/' + path, github + 'spine-4.2/' + path, cdn + old, github + old]
      .map(url => ({ skeletonUrl: url + '.skel', atlasUrl: url + '.atlas' })))
    const localAtlas = libraryAssetUrl(base, root, pairs[1].atlasUrl)
    assert.equal(new URL('texture page.png', localAtlas).pathname, '/spine-4.2/' + path.slice(0, path.lastIndexOf('/')) + '/texture%20page.png')
  }
})

test('explicit Spine 4.2 links and minigame links resolve both version directories', () => {
  const suffix = 'misc/minigame'
  const pair = root => ({ skeletonUrl: cdn + root + suffix + '.json?load=1', atlasUrl: cdn + root + suffix + '.atlas' })
  const current = pair('spine-4.2/')
  const legacy = pair('spine/')
  assert.deepEqual(spineAssetCandidates({ type: 'url', ...current }), [current, legacy])
  assert.deepEqual(spineAssetCandidates({ type: 'url', ...legacy }), [current, legacy])
})

test('arbitrary preview links keep the order and URLs supplied by the caller', () => {
  const url = 'https://example.com/spine/char/test/test'
  const fallback = cdn + 'spine/char/test/test'
  const pair = { skeletonUrl: url + '.skel', atlasUrl: url + '.atlas' }
  assert.deepEqual(spineAssetCandidates({
    type: 'url', ...pair, skeletonUrlFallback: fallback + '.skel', atlasUrlFallback: fallback + '.atlas',
  }), [pair, { skeletonUrl: fallback + '.skel', atlasUrl: fallback + '.atlas' }])
})
