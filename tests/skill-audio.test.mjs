import assert from 'node:assert/strict'
import test from 'node:test'
import { SkillAudioScheduler, validSkillAudioTimeline } from '../src/utils/skillAudio.ts'
function setup(clips, end = 10) {
  const context = { currentTime: 0, state: 'running', destination: {}, starts: [], stops: [],
    createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} } },
    createBufferSource() { const ctx = this; const node = { playbackRate: { value: 1 }, connect() {}, disconnect() {},
      start(when, offset, duration) { ctx.starts.push({ node, when, offset, duration }) }, stop() { ctx.stops.push(node) } }; return node },
  }
  return { context, player: new SkillAudioScheduler(context, clips, end) }
}
const clip = (id, start, duration = 3, options = {}) => ({ id, event: id, kind: 'sfx', start, duration, offset: 0, speed: 1, volume: 1, stopMode: 'none', files: {}, buffer: { duration }, ...options })

test('voices overlap effects and share the clock used to position the animation', () => {
  const { context, player } = setup([clip('effect', 0, 7), clip('voice', .1, 2, { kind: 'voice' })])
  player.play(0); assert.equal(context.starts.length, 2)
  context.currentTime = 2.025
  assert.equal(player.position(99), 2)
  player.update(2); assert.equal(context.starts.length, 2)
})
test('pause cancels current and future sound; resume restores the correct offsets', () => {
  const { context, player } = setup([clip('effect', 0, 7), clip('voice', .1)])
  player.play(0); player.pause(1.5)
  assert.equal(context.stops.length, 2)
  context.currentTime = 5; player.play(1.5)
  assert.equal(context.starts.length, 4)
  assert.equal(context.starts[2].offset, 1.5)
  assert.equal(context.starts[3].offset, 1.4)
  assert.equal(context.starts[2].when, 5.025)
})
test('seeking skips old one-shot sounds and starts only currently audible clips', () => {
  const { context, player } = setup([clip('old', 0, 1), clip('current', 2, 4), clip('future', 8)])
  player.play(3)
  assert.equal(context.starts.length, 1)
  assert.equal(context.starts[0].offset, 1)
  assert.equal(context.starts[0].duration, 3)
})
test('none stop mode preserves a tail, while the preview end and looping cancel it', () => {
  const { context, player } = setup([clip('tail', 0, 1, { buffer: { duration: 8 } })], 5)
  player.play(0); assert.equal(context.starts[0].duration, 5)
  context.currentTime = 5; player.play(0)
  assert.equal(context.stops.length, 1); assert.equal(context.starts.length, 2)
  player.dispose(); assert.equal(context.stops.length, 2)
  const immediate = setup([clip('cut', 0, 1, { buffer: { duration: 8 }, stopMode: 'immediate' })])
  immediate.player.play(0); assert.equal(immediate.context.starts[0].duration, 1)
})
test('audio manifests reject path traversal, duplicate events and invalid timing', () => {
  const data = { schemaVersion: 1, cutsceneId: '000708', visualSignature: 'a'.repeat(64), duration: 8.5,
    clips: [clip('one', 0, 1, { files: { sfx: ['sfx/Char000708_Skill_CutScene_01.wav'] } })] }
  assert.equal(validSkillAudioTimeline(data), true)
  for (const file of ['../secret.wav', 'sfx/../secret.wav', 'https://example.com/a.wav']) {
    assert.equal(validSkillAudioTimeline({ ...data, clips: [{ ...data.clips[0], files: { sfx: [file] } }] }), false)
  }
  assert.equal(validSkillAudioTimeline({ ...data, clips: [data.clips[0], data.clips[0]] }), false)
  assert.equal(validSkillAudioTimeline({ ...data, clips: [{ ...data.clips[0], start: -1 }] }), false)
})
