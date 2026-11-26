import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { generateMood } from './generate-mood'
import { react } from './react'
import { takedownImage } from './takedown'

export const actions: Record<string, ActionHandler<Env>> = {
  generateMood,
  react,
  takedownImage,
}
