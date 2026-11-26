/**
 * public_images — every mood generated in the public room.
 *
 * Clients never write here: rows are created by the `generateMood` server
 * action (which enforces the daily cap and stores the file), and counts /
 * takedowns are changed only by server actions. That keeps the
 * "images are immutable" rule at the data layer, not just in the UI.
 *
 * `status` doubles as the visibility gate: a taken-down image ('removed')
 * disappears for everyone except its owner and admins.
 */

import type { CollectionSchema } from 'deepspace/schema'

export type PublicImage = {
  ownerId: string
  /** Stored key in the app's public file scope. */
  r2Key: string
  /** Serving path (relative to the app origin) — usable directly as <img src>. */
  imageUrl: string
  promptTranscript: string
  inputMode: 'voice' | 'typed'
  providerUsed: string
  likeCount: number
  dislikeCount: number
  status: 'live' | 'removed'
}

export const PROMPT_MAX_LENGTH = 500

const readOnly = { create: false, update: false, delete: false } as const

export const publicImagesSchema: CollectionSchema = {
  name: 'public_images',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'r2Key', storage: 'text', interpretation: 'plain', required: true },
    { name: 'imageUrl', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'promptTranscript',
      storage: 'text',
      interpretation: 'plain',
      required: true,
      maxLength: PROMPT_MAX_LENGTH,
    },
    { name: 'inputMode', storage: 'text', interpretation: { kind: 'select', options: ['voice', 'typed'] } },
    { name: 'providerUsed', storage: 'text', interpretation: 'plain' },
    { name: 'likeCount', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'dislikeCount', storage: 'number', interpretation: 'plain', default: 0 },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['live', 'removed'] },
      default: 'live',
    },
  ],
  ownerField: 'ownerId',
  visibilityField: { field: 'status', value: 'live' },
  permissions: {
    '*': { read: 'published', ...readOnly },
    viewer: { read: 'published', ...readOnly },
    member: { read: 'published', ...readOnly },
    admin: { read: true, ...readOnly },
  },
}
