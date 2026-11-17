import { onScopeDispose, ref, watch } from 'vue'
import { useAssetLibraryStore } from '../stores/assetLibrary'
import { useUIStore } from '../stores/ui'
import { useLogger } from './useLogger'
import type { Scene } from './useGameCutscene'
import type { SkillAudioTimeline, DecodedSkillClip, SkillVoiceLanguage } from '../types/skillAudio'
import { SkillAudioScheduler, skillTimelineKey, validSkillAudioTimeline } from '../utils/skillAudio'

export function useGameCutsceneAudio(getTime: () => number) {
  const library = useAssetLibraryStore(), ui = useUIStore(), { logMessage } = useLogger()
  const status = ref<'idle' | 'loading' | 'ready' | 'partial' | 'missing' | 'failed' | 'mismatch' | 'muted'>('idle')
  const fallbackCount = ref(0), missingCount = ref(0)
  const language = ref<SkillVoiceLanguage | 'mixed' | ''>('')
  let id = '', scene: Scene | null = null, context: AudioContext | null = null
  let scheduler: SkillAudioScheduler | null = null, controller: AbortController | null = null
  let generation = 0, playRequest = 0, playing = false, end = 0, hidden = false
  const buffers = new Map<string, AudioBuffer>()

  function audioContext() { return context ??= new AudioContext({ latencyHint: 'interactive' }) }
  function pauseNodes() { playRequest++; scheduler?.pause(getTime()) }
  function updateVolume() { scheduler?.setVolume(ui.standingVoiceVolume, ui.skillSfxVolume) }
  function resume() {
    if (!playing || hidden || !scheduler) return
    const request = ++playRequest, ctx = audioContext()
    void ctx.resume().then(() => {
      if (request !== playRequest || !playing || hidden || !scheduler) return
      scheduler.play(getTime()); updateVolume()
    }).catch(error => logMessage('Could not start skill audio: ' + String(error), 'warning'))
  }
  async function reload() {
    const current = ++generation
    pauseNodes(); scheduler?.dispose(); scheduler = null
    controller?.abort(); controller = new AbortController()
    fallbackCount.value = 0; missingCount.value = 0; language.value = ''
    if (!id || !scene) { status.value = 'idle'; return }
    if (!ui.skillVoiceAudio && !ui.skillSfxAudio) { status.value = 'muted'; return }
    const loadedId = id, loadedScene = scene, signal = controller.signal
    status.value = 'loading'
    try {
      await library.ready()
      if (current !== generation) return
      if (!library.activeRoot) { status.value = 'missing'; return }
      const response = await fetch(library.localUrl('audio/skills/timelines/' + loadedId + '.json'), { signal })
      if (current !== generation) return
      if (response.status === 404) { status.value = 'missing'; return }
      if (!response.ok) throw new Error('Skill timeline HTTP ' + response.status)
      const data: SkillAudioTimeline = await response.json()
      if (!validSkillAudioTimeline(data) || data.cutsceneId !== loadedId) throw new Error('Invalid skill audio timeline')
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(skillTimelineKey(loadedScene)))
      if (current !== generation) return
      if (Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') !== data.visualSignature) {
        status.value = 'mismatch'; return
      }
      const preferred: SkillVoiceLanguage = ui.standingVoiceLanguage === 'ko-KR' ? 'ko-KR' : 'ja-JP'
      const alternate = preferred === 'ja-JP' ? 'ko-KR' : 'ja-JP'
      const languages = new Set<SkillVoiceLanguage>()
      let fallback = 0, missing = 0
      const decoded = await Promise.all(data.clips.filter(c => c.kind === 'voice' ? ui.skillVoiceAudio : ui.skillSfxAudio).map(async clip => {
        const selected = clip.kind === 'sfx' ? 'sfx' : clip.files[preferred]?.length ? preferred : alternate
        const files = clip.files[selected] ?? []
        if (!files.length) { missing++; return null }
        try {
          // Variants, when present, are chosen once for this loaded performance.
          const file = files[Math.floor(Math.random() * files.length)]!
          let buffer = buffers.get(file)
          if (!buffer) {
            const r = await fetch(library.localUrl('audio/skills/' + file), { signal })
            if (!r.ok) throw new Error('Skill audio HTTP ' + r.status)
            buffer = await audioContext().decodeAudioData(await r.arrayBuffer())
            if (current !== generation) return null
            buffers.set(file, buffer)
          }
          if (clip.kind === 'voice') {
            languages.add(selected as SkillVoiceLanguage)
            if (selected !== preferred) fallback++
          }
          return { ...clip, buffer } as DecodedSkillClip
        } catch (error) {
          if (current === generation) { missing++; logMessage('Skill audio ' + clip.event + ': ' + String(error), 'warning') }
          return null
        }
      }))
      if (current !== generation) return
      fallbackCount.value = fallback; missingCount.value = missing
      language.value = languages.size > 1 ? 'mixed' : languages.values().next().value ?? ''
      const clips = decoded.filter((c): c is DecodedSkillClip => !!c)
      status.value = clips.length ? missing ? 'partial' : 'ready' : 'missing'
      if (clips.length) {
        scheduler = new SkillAudioScheduler(audioContext(), clips, end || data.duration)
        updateVolume(); resume()
      }
    } catch (error) {
      if (current !== generation) return
      status.value = 'failed'; logMessage('Could not load skill audio: ' + String(error), 'warning')
    }
  }
  function clear() {
    generation++; pauseNodes(); controller?.abort(); controller = null
    scheduler?.dispose(); scheduler = null; buffers.clear()
    id = ''; scene = null; playing = false; end = 0
    status.value = 'idle'; fallbackCount.value = 0; missingCount.value = 0; language.value = ''
  }
  function load(value: string, timeline: Scene, playbackEnd: number) {
    clear(); id = value; scene = timeline; end = playbackEnd
    void reload()
  }
  function start() { playing = true; hidden = document.hidden; void audioContext().resume().catch(() => {}); resume() }
  function pause(value: boolean) { playing = !value; pauseNodes(); if (!value) resume() }
  function seek() { pauseNodes(); resume() }
  function stop() { playing = false; pauseNodes() }
  function finish() { pauseNodes() }
  function position(fallback: number) { return playing && !hidden ? scheduler?.position(fallback) ?? fallback : hidden && playing ? getTime() : fallback }
  function update(time: number) { if (playing && !hidden) scheduler?.update(time) }
  function visibility() {
    hidden = document.hidden
    if (hidden) pauseNodes()
    else resume()
  }
  document.addEventListener('visibilitychange', visibility)
  watch(() => [ui.standingVoiceLanguage, ui.skillVoiceAudio, ui.skillSfxAudio], () => { void reload() })
  watch(() => [ui.standingVoiceVolume, ui.skillSfxVolume], updateVolume)
  onScopeDispose(() => { clear(); document.removeEventListener('visibilitychange', visibility); void context?.close() })
  return { status, language, fallbackCount, missingCount, load, clear, start, pause, seek, stop, finish, position, update }
}
