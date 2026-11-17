import assert from 'node:assert/strict'
import test from 'node:test'
import { libraryAssetUrl } from '../src/utils/assetLibraryUrls.ts'

const base = 'http://bd2library.localhost/'
const root = 'F:\\Neowiz\\Brown-Dust-2-Asset-master'
const cdn = 'https://cdn.jsdelivr.net/gh/LLsetnow/Brown-Dust-2-Asset@master/'

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
