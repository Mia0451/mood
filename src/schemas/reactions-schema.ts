/**
 * image_reactions — one like/dislike per signed-in user per image.
 *
 * Written only by the `react` server action (which refuses self-reactions and
 * keeps the counts on public_images in step). Record id is `imageId:actorId`,
 * and `uniqueOn` backs that up at the data layer. Members can read only their
 * own rows (to highlight their current choice); public counts live on the
 * image, so nobody else's votes are exposed.
 */

import type { CollectionSchema } from 'deepspace/schema'

export type ReactionType = 'like' | 'dislike'

export type ImageReaction = {
  imageId: string
  actorId: string
  type: ReactionType
}

export function reactionId(imageId: string, actorId: string): string {
  return `${imageId}:${actorId}`
}

const none = { read: false, create: false, update: false, delete: false } as const

export const imageReactionsSchema: CollectionSchema = {
  name: 'image_reactions',
  columns: [
    { name: 'imageId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'actorId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'type', storage: 'text', interpretation: { kind: 'select', options: ['like', 'dislike'] }, required: true },
  ],
  uniqueOn: ['imageId', 'actorId'],
  ownerField: 'actorId',
  permissions: {
    '*': { ...none },
    viewer: { ...none },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
