import assert from 'node:assert/strict'
import test from 'node:test'
import mapping from '../src/data/illustrationBackgrounds.json' with { type: 'json' }
import { findIllustrationBackground } from '../src/utils/illustrationBackground.ts'

test('official illustrations use the background associated with their design, including prestige skins', () => {
  assert.equal(findIllustrationBackground('illust_char000101_1.skel').resource, 'novel_background_160')
  assert.equal(findIllustrationBackground('illust_char000102_44.json').resource, 'novel_background_53')
  assert.equal(findIllustrationBackground('illust_char001207_114.skel').resource, 'novel_background_131')
  assert.equal(findIllustrationBackground('illust_char001297_229.skel').resource, 'novel_background_131')
  assert.deepEqual(findIllustrationBackground('http://bd2library.localhost/spine-4.2/char/char067203/char067203.skel?library=F%3A%2FAssets'), {
    illustration: 'illust_char067203_230', resource: 'novel_background_76', id: 76,
  })
})

test('local Mod filenames and library URLs resolve to the same illustration', () => {
  const expected = findIllustrationBackground('illust_char000101_1.skel')
  for (const filename of [
    'F:\\Mods\\角色 立绘\\char000101.json',
    'http://bd2library.localhost/spine/char/char000101/char000101.skel?library=F%3A%2FAssets',
    'https://example.com/My%20Mods/ILLUST_CHAR000101_1.SKEL?version=2#test',
  ]) assert.deepEqual(findIllustrationBackground(filename), expected)
})

test('skill, dating, NPC, unknown and malformed resources never borrow another costume background', () => {
  for (const filename of [
    '', 'cutscene_char000101.skel', 'illust_dating1.json', 'illust_npc000001_5.skel',
    'char999999.skel',
    'illust_char000101_9999.skel', 'illust_char999999_1.json', 'illust_char000101_1.png',
    'illust_char000101_1.skel.backup', '__proto__', 'constructor', '%broken.skel',
  ]) assert.equal(findIllustrationBackground(filename), null, filename)
})

test('the extracted snapshot contains 208 complete mappings and records its official source', () => {
  assert.equal(Object.keys(mapping.backgrounds).length, 208)
  assert.equal(Object.keys(mapping.skeletons).length, 208)
  assert.equal(mapping.source.backgroundTable, 'CostumeDesignConceptInfoTable')
  assert.equal(mapping.source.backgroundField, 'CostumeBgResoureceName')
  for (const [illustration, background] of Object.entries(mapping.backgrounds)) {
    assert.match(illustration, /^illust_char\d{6}_\d+$/)
    assert.match(background, /^novel_background_\d+$/)
  }
  // Official NPC design 901 uses Char100401; deriving a skeleton from 901 would be wrong.
  assert.equal(mapping.skeletons.char100401, 'illust_char100401_8')
  assert.equal(findIllustrationBackground('char100401.skel').resource, mapping.backgrounds.illust_char100401_8)
  assert.equal(findIllustrationBackground('char000901.skel'), null)
})
