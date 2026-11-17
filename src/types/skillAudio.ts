export type SkillVoiceLanguage = 'ja-JP' | 'ko-KR'
export interface SkillAudioClip {
  id: string
  event: string
  kind: 'voice' | 'sfx'
  start: number
  duration: number
  offset: number
  speed: number
  volume: number
  stopMode: 'none' | 'immediate' | 'fadeout'
  fadeIn?: number
  fadeOut?: number
  files: Partial<Record<SkillVoiceLanguage | 'sfx', string[]>>
}
export interface SkillAudioTimeline {
  schemaVersion: 1
  cutsceneId: string
  visualSignature: string
  duration: number
  clips: SkillAudioClip[]
}
export interface DecodedSkillClip extends SkillAudioClip {
  buffer: AudioBuffer
}
