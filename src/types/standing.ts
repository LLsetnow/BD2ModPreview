export type StandingVoiceLanguage = 'ja-JP' | 'ko-KR'
export interface StandingVoiceClip { name: string; file: string; event: string }
export interface StandingCharacterVoices {
  costumeId: string
  illustration: string
  voices: Partial<Record<StandingVoiceLanguage, StandingVoiceClip[]>>
}
export interface StandingVoiceCatalog {
  schemaVersion: number
  characters: Record<string, StandingCharacterVoices>
}
