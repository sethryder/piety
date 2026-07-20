import gems from './data/gems.json'
import colours from './data/gem-colours.json'
import quests from './data/quests.json'
import characters from './data/characters.json'
import type { CharDb, ColourDb, GemDb, QuestDb } from './gemPlan'

export const gemDb = {
  gems: gems as GemDb,
  colours: colours as ColourDb,
  quests: quests as unknown as QuestDb,
  characters: characters as CharDb
}
