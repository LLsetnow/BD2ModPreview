import type { SkillAudioTimeline, DecodedSkillClip } from '../types/skillAudio'

// Only the animation arrangement affects sound timing; background revisions may differ safely.
export function skillTimelineKey(scene: { duration: number; nodes: { path: string }[]; tracks: { node: number; trackIndex?: number; clips: { name: string; start: number; duration: number; clipIn: number; speed: number }[] }[] }) {
  return JSON.stringify([scene.duration, scene.tracks.map(track => [scene.nodes[track.node]?.path, track.trackIndex ?? 0,
    track.clips.map(clip => [clip.name, clip.start, clip.duration, clip.clipIn, clip.speed])])])
}
export function validSkillAudioTimeline(data: unknown): data is SkillAudioTimeline {
  const d = data as SkillAudioTimeline | null
  return !!d && d.schemaVersion === 1 && /^\d+$/.test(d.cutsceneId) && /^[a-f0-9]{64}$/.test(d.visualSignature) &&
    Number.isFinite(d.duration) && d.duration > 0 && Array.isArray(d.clips) &&
    new Set(d.clips.map(c => c?.id)).size === d.clips.length && d.clips.every(c => c && typeof c.id === 'string' &&
      typeof c.event === 'string' && ['voice', 'sfx'].includes(c.kind) && ['none', 'immediate', 'fadeout'].includes(c.stopMode) &&
      [c.start, c.duration, c.offset, c.speed, c.volume].every(Number.isFinite) &&
      c.start >= 0 && c.duration > 0 && c.offset >= 0 && c.speed > 0 && c.volume >= 0 &&
      [c.fadeIn, c.fadeOut].every(v => v === undefined || (Number.isFinite(v) && v >= 0)) &&
      c.files && Object.entries(c.files).every(([language, files]) => ['sfx', 'ja-JP', 'ko-KR'].includes(language) &&
        Array.isArray(files) && files.every(file => typeof file === 'string' &&
          (language === 'sfx' ? /^sfx\/[\w-]+\.wav$/.test(file) : new RegExp('^' + language + '/[0-9]+/[A-Za-z0-9_ -]+\\.wav$').test(file)))))
}

/** One clock for animation and sound. Pausing/seeking discards scheduled nodes, never historical events. */
export class SkillAudioScheduler {
  private sources = new Map<AudioBufferSourceNode, GainNode>()
  private scheduled = new Set<string>()
  private voice: GainNode
  private sfx: GainNode
  private anchorTime = 0
  private anchorAudio = 0
  private running = false
  private context: AudioContext
  private clips: DecodedSkillClip[]
  private end: number
  constructor(context: AudioContext, clips: DecodedSkillClip[], end: number) {
    this.context = context; this.clips = clips; this.end = end
    this.voice = context.createGain(); this.sfx = context.createGain()
    this.voice.connect(context.destination); this.sfx.connect(context.destination)
  }
  setVolume(voice: number, sfx: number) {
    this.voice.gain.value = Math.max(0, Math.min(100, voice)) / 100
    this.sfx.gain.value = Math.max(0, Math.min(100, sfx)) / 100
  }
  play(time: number) {
    this.pause(time)
    this.running = true; this.anchorTime = time; this.anchorAudio = this.context.currentTime + 0.025
    this.update(time)
  }
  position(fallback: number) {
    if (!this.running) return fallback
    if (this.context.state !== 'running') return this.anchorTime
    return this.anchorTime + Math.max(0, this.context.currentTime - this.anchorAudio)
  }
  pause(time: number) {
    this.running = false; this.anchorTime = time
    for (const [source, gain] of this.sources) {
      source.onended = null
      try { source.stop() } catch { /* already ended */ }
      source.disconnect(); gain.disconnect()
    }
    this.sources.clear(); this.scheduled.clear()
  }
  update(time: number) {
    if (!this.running || this.context.state !== 'running') return
    for (const clip of this.clips) {
      if (this.scheduled.has(clip.id) || clip.start > time + 0.2) continue
      const naturalEnd = clip.start + (clip.buffer.duration - clip.offset) / clip.speed
      const end = Math.min(this.end, naturalEnd, clip.stopMode === 'none' ? Infinity : clip.start + clip.duration)
      this.scheduled.add(clip.id)
      if (end <= time || clip.start >= this.end || end <= clip.start) continue
      const begin = Math.max(time, clip.start)
      const when = Math.max(this.context.currentTime, this.anchorAudio + begin - this.anchorTime)
      const offset = clip.offset + (begin - clip.start) * clip.speed
      const source = this.context.createBufferSource(), gain = this.context.createGain()
      source.buffer = clip.buffer; source.playbackRate.value = clip.speed
      source.connect(gain); gain.connect(clip.kind === 'voice' ? this.voice : this.sfx)
      gain.gain.setValueAtTime(clip.volume, when)
      if (clip.fadeIn && begin < clip.start + clip.fadeIn) {
        gain.gain.setValueAtTime(clip.volume * (begin - clip.start) / clip.fadeIn, when)
        gain.gain.linearRampToValueAtTime(clip.volume, when + Math.min(end - begin, clip.start + clip.fadeIn - begin))
      }
      if (clip.fadeOut) {
        const fadeStart = Math.max(begin, end - clip.fadeOut)
        gain.gain.setValueAtTime(clip.volume * Math.min(1, (end - begin) / clip.fadeOut), when + fadeStart - begin)
        gain.gain.linearRampToValueAtTime(0, when + end - begin)
      }
      this.sources.set(source, gain)
      source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect() }
      source.start(when, offset, (end - begin) * clip.speed)
    }
  }
  dispose() { this.pause(0); this.voice.disconnect(); this.sfx.disconnect() }
}
