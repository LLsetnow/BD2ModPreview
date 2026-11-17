import { computed, onScopeDispose, ref, watch } from 'vue'
import type { SpinePlayer } from '../types/spine'
import type { StandingVoiceCatalog, StandingVoiceClip, StandingVoiceLanguage } from '../types/standing'
import { useAssetLibraryStore } from '../stores/assetLibrary'
import { useUIStore } from '../stores/ui'
import { useLogger } from './useLogger'
import { standingSkeleton, containsTriangle } from '../utils/standingInteractions'

declare const spine: any
const catalogs = new Map<string, Promise<StandingVoiceCatalog>>()

export function useStandingInteractions(options: { canInteract: () => boolean; beforePlay: () => void; isPaused: () => boolean; isSlotVisible: (name: string) => boolean }) {
  const library = useAssetLibraryStore()
  const ui = useUIStore()
  const { logMessage } = useLogger()
  const available = ref(false)
  const playingMotion = ref(false)
  const voicePlaying = ref(false)
  const ownsPlayback = computed(() => playingMotion.value || voicePlaying.value)
  const voiceCount = ref(0)
  const voiceLanguage = ref<StandingVoiceLanguage>('ja-JP')
  const audioStatus = ref<'idle' | 'loading' | 'ready' | 'missing' | 'failed'>('idle')
  const lastVoice = ref('')
  let player: SpinePlayer | null = null
  let skeletonId: string | null = null
  let idle = '', motion = ''
  let motionEntry: any = null
  let clips: StandingVoiceClip[] = []
  let generation = 0, playRequest = 0
  let controller: AbortController | null = null
  let context: AudioContext | null = null
  let gain: GainNode | null = null
  let source: AudioBufferSourceNode | null = null
  const buffers = new Map<string, Promise<AudioBuffer>>()
  const enabled = computed(() => available.value && ui.standingInteractions)

  function audioContext() {
    if (!context) {
      context = new AudioContext({ latencyHint: 'interactive' })
      gain = context.createGain()
      gain.connect(context.destination)
    }
    gain!.gain.value = Math.max(0, Math.min(100, ui.standingVoiceVolume)) / 100
    return context
  }

  function stopAudio() {
    playRequest++; voicePlaying.value = false
    if (source) { source.onended = null; source.stop(); source.disconnect(); source = null }
  }

  function cancelMotion() {
    motionEntry = null
    playingMotion.value = false
    stopAudio()
  }

  function stop() {
    const wasPlaying = playingMotion.value
    cancelMotion()
    if (wasPlaying && player && idle) player.animationState.setAnimation(0, idle, true)
  }

  function bufferFor(clip: StandingVoiceClip) {
    let request = buffers.get(clip.file)
    if (!request) {
      const ctx = audioContext()
      request = fetch(library.localUrl('audio/char/' + clip.file), { signal: controller?.signal })
        .then(response => { if (!response.ok) throw new Error('Audio HTTP ' + response.status); return response.arrayBuffer() })
        .then(bytes => ctx.decodeAudioData(bytes))
      buffers.set(clip.file, request)
      request.catch(() => { if (buffers.get(clip.file) === request) buffers.delete(clip.file) })
    }
    return request
  }

  async function loadVoices() {
    const current = ++generation
    stopAudio()
    controller?.abort()
    controller = new AbortController()
    buffers.clear(); clips = []; voiceCount.value = 0; lastVoice.value = ''
    audioStatus.value = 'idle'
    if (!skeletonId || !ui.standingAudio || !ui.standingInteractions) return
    await library.ready()
    if (current !== generation) return
    if (!library.activeRoot) { audioStatus.value = 'missing'; return }
    audioStatus.value = 'loading'
    try {
      const root = library.activeRoot
      let request = catalogs.get(root)
      if (!request) {
        request = fetch(library.localUrl('audio/char/index.json'), { signal: AbortSignal.timeout(8000) })
          .then(response => { if (!response.ok) throw new Error('Standing catalog HTTP ' + response.status); return response.json() as Promise<StandingVoiceCatalog> })
          .then(catalog => { if (catalog.schemaVersion !== 1 || !catalog.characters) throw new Error('Invalid standing voice catalog'); return catalog })
        catalogs.set(root, request)
        if (catalogs.size > 3) catalogs.delete(catalogs.keys().next().value!)
        request.catch(() => { if (catalogs.get(root) === request) catalogs.delete(root) })
      }
      const catalog = await request
      if (current !== generation || !skeletonId) return
      const voices = catalog.characters[skeletonId]?.voices
      const preferred = ui.standingVoiceLanguage === 'ko-KR' ? 'ko-KR' : 'ja-JP'
      const alternate = preferred === 'ja-JP' ? 'ko-KR' : 'ja-JP'
      voiceLanguage.value = voices?.[preferred]?.length ? preferred : alternate
      clips = (voices?.[voiceLanguage.value] ?? []).filter(clip =>
        /^(ja-JP|ko-KR)\/\d{6}\/Char\d{6}_[A-Za-z0-9_]+\.wav$/.test(clip.file))
      voiceCount.value = clips.length
      if (!clips.length) { audioStatus.value = 'missing'; return }
      const results = await Promise.allSettled(clips.map(bufferFor))
      if (current !== generation) return
      const expected = clips.length
      clips = clips.filter((_clip, index) => results[index]?.status === 'fulfilled')
      voiceCount.value = clips.length
      audioStatus.value = clips.length ? 'ready' : 'failed'
      if (clips.length !== expected) logMessage('Some standing voices could not be loaded for ' + skeletonId, 'warning')
    } catch (error) {
      if (current !== generation) return
      audioStatus.value = 'failed'
      logMessage('Could not load standing voices: ' + String(error), 'warning')
    }
  }

  async function playRandomVoice() {
    stopAudio()
    if (!ui.standingAudio || !clips.length) return
    const current = playRequest, loaded = generation
    const choices = clips.length > 1 ? clips.filter(clip => clip.name !== lastVoice.value) : clips
    const clip = choices[Math.floor(Math.random() * choices.length)]!
    const ctx = audioContext()
    try {
      await ctx.resume()
      const buffer = await bufferFor(clip)
      if (current !== playRequest || loaded !== generation || !ui.standingAudio || options.isPaused()) return
      const node = ctx.createBufferSource()
      node.buffer = buffer; node.connect(gain!)
      source = node; voicePlaying.value = true; lastVoice.value = clip.name
      node.onended = () => { if (source === node) { source = null; voicePlaying.value = false } node.disconnect() }
      node.start()
    } catch (error) {
      if (current === playRequest && loaded === generation) logMessage('Could not play standing voice ' + clip.name + ': ' + String(error), 'warning')
    }
  }

  function click() {
    if (!enabled.value || !player || !options.canInteract()) return false
    options.beforePlay()
    motionEntry = null; playingMotion.value = true
    const entry = player.animationState.setAnimation(0, motion, false)
    motionEntry = entry; playingMotion.value = true
    entry.listener = { complete: () => { if (motionEntry === entry) { motionEntry = null; playingMotion.value = false } } }
    player.animationState.addAnimation(0, idle, true, 0)
    player.play()
    void playRandomVoice()
    return true
  }

  function hitTest(event: PointerEvent) {
    if (!enabled.value || !player || !options.canInteract()) return false
    const rect = player.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    const point = player.sceneRenderer.camera.screenToWorld(new spine.Vector3(
      (event.clientX - rect.left) * player.canvas.width / rect.width,
      (event.clientY - rect.top) * player.canvas.height / rect.height, 0), player.canvas.width, player.canvas.height)
    const shapes: { vertices: number[]; triangles: number[]; extent: number }[] = []
    for (const slot of player.skeleton.drawOrder) {
      const attachment = slot.attachment
      if (!options.isSlotVisible(slot.data.name) || !attachment || slot.color.a <= 0.01 || (attachment.color?.a ?? 1) <= 0.01 || !slot.bone.active) continue
      const vertices: number[] = []
      let triangles: number[]
      if (attachment instanceof spine.RegionAttachment) {
        attachment.computeWorldVertices(slot, vertices, 0, 2); triangles = [0, 1, 2, 2, 3, 0]
      } else if (attachment instanceof spine.MeshAttachment) {
        attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, vertices, 0, 2); triangles = attachment.triangles
      } else continue
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i < vertices.length; i += 2) { minX = Math.min(minX, vertices[i]!); minY = Math.min(minY, vertices[i + 1]!); maxX = Math.max(maxX, vertices[i]!); maxY = Math.max(maxY, vertices[i + 1]!) }
      shapes.push({ vertices, triangles, extent: Math.max(maxX - minX, maxY - minY) })
    }
    const extents = shapes.map(shape => shape.extent).filter(size => size > 0).sort((a, b) => a - b)
    const median = extents[Math.floor(extents.length / 2)] ?? 0
    return shapes.some(shape => shape.extent <= median * 20 && shape.triangles.some((a, i, triangles) =>
      i % 3 === 0 && containsTriangle(shape.vertices, point.x, point.y, a, triangles[i + 1]!, triangles[i + 2]!)))
  }

  function clear() {
    generation++; cancelMotion(); controller?.abort(); controller = null
    player = null; skeletonId = null; clips = []; buffers.clear()
    available.value = false; voiceCount.value = 0; audioStatus.value = 'idle'; lastVoice.value = ''
  }

  function load(value: SpinePlayer, filename: string) {
    clear(); player = value; skeletonId = standingSkeleton(filename)
    const names: string[] = value.skeleton.data.animations.map((animation: any) => animation.name)
    idle = names.includes('idle') ? 'idle' : names.find(name => /^idle\d*$/i.test(name)) ?? ''
    motion = names.includes('motion') ? 'motion' : names.find(name => /^(motion|touch|tap)\d*$/i.test(name)) ?? ''
    available.value = !!skeletonId && !!idle && !!motion
    if (available.value) void loadVoices()
  }

  watch(() => [library.activeRoot, ui.standingVoiceLanguage, ui.standingAudio, ui.standingInteractions], () => {
    if (!ui.standingInteractions) stop()
    if (available.value) void loadVoices()
  })
  watch(() => ui.standingVoiceVolume, () => { if (gain) gain.gain.value = Math.max(0, Math.min(100, ui.standingVoiceVolume)) / 100 })
  watch(options.isPaused, paused => { if (paused) void context?.suspend(); else if (source) void context?.resume().catch(() => {}) })
  onScopeDispose(() => { clear(); void context?.close(); context = null; gain = null })
  return { available, enabled, playingMotion, ownsPlayback, voiceCount, voiceLanguage, audioStatus, lastVoice, load, clear, click, hitTest, stop, cancelMotion, stopAudio }
}
