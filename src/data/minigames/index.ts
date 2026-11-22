import type { MinigameCatalogEntry } from '../../stores/assetCatalog'

export type MinigameAction = 'tap' | 'hold' | 'release' | 'slide'

export interface MinigameDefinition {
  id: string
  sounds?: Partial<Record<MinigameAction | 'fever', string>>
  characters: (animations: string[]) => string[]
  idle: (character: string, fever: boolean) => string
  reactions: (action: MinigameAction, left: boolean, fever: boolean) => string[]
}

function expand(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)(?::(\d+))?\}/g, (_match, key: string, width?: string) => {
    const value = String(values[key] ?? '')
    return width ? value.padStart(Math.min(16, Number(width)), '0') : value
  })
}

export function minigameCharacterAnimation(config: MinigameCatalogEntry, id: number) {
  return expand(config.animations.characterNameTemplate, { characterId: id })
}

export function createMinigameDefinition(config: MinigameCatalogEntry): MinigameDefinition {
  let characterPattern: RegExp
  try { characterPattern = new RegExp(config.animations.characterPattern) }
  catch { characterPattern = /$a/ }

  return {
    id: config.id,
    sounds: config.sounds as MinigameDefinition['sounds'],
    characters: animations => config.characters
      .map(({ id }) => minigameCharacterAnimation(config, id))
      .filter(name => characterPattern.test(name) && animations.includes(name)),
    idle: (character, fever) => expand(config.animations.idleTemplate, {
      character,
      feverSuffix: fever ? config.animations.feverIdleSuffix ?? '' : '',
    }),
    reactions: (action, left, fever) => {
      const side = left ? 'l' : 'r'
      const configured = fever ? config.animations.reactions.fever : config.animations.reactions[action]
      if (!configured) return []
      if (Array.isArray(configured)) return configured.map(template => expand(template, { side }))
      if (action !== 'tap' || typeof configured !== 'object' || !('tap' in configured) || !('count' in configured)) return []
      const count = Math.max(0, Math.min(100, Number(configured.count) || 0))
      return Array.from({ length: count }, (_, index) => expand(configured.tap, { side, index }))
    },
  }
}
