/**
 * Private 1:1 chat.
 *
 * Both collections are readable only by the two participants ('shared' via
 * `collaboratorsField: 'participants'`) and written only by server actions,
 * which check membership — so a client can never post into someone else's
 * room or add itself to one.
 *
 * private_rooms id is deterministic per pair (dmRoomId), so the same two
 * people always reuse one room. `unread` maps userId → unread count for the
 * badges; sendMessage bumps the peer's, markRead clears the caller's.
 *
 * private_messages.content is the text, or — for voice/image — the stored
 * file key in the SENDER's private file scope. Media is served only through
 * /api/media/dm/:messageId, which re-checks membership.
 */

import type { CollectionSchema } from 'deepspace/schema'

export type MessageType = 'text' | 'voice' | 'image' | 'system'

export type PrivateRoom = {
  participants: string[]
  lastMessageAt: string
  lastMessagePreview: string
  lastSenderId: string
  unread: Record<string, number>
}

export type PrivateMessage = {
  roomId: string
  participants: string[]
  /** Author user id; for 'system' messages, the user whose action created it. */
  senderId: string
  type: MessageType
  content: string
  /** 'system' messages: the public image the chat was opened from (snapshot). */
  imageRefId?: string
  imageRefUrl?: string
  imageRefTranscript?: string
  imageRefOwnerId?: string
  /** 'voice' messages: duration in ms. 'image' messages: the transcript. */
  durationMs?: number
  transcript?: string
}

export const TEXT_MAX_LENGTH = 2000

/** Same room id for the pair regardless of who opens it. */
export function dmRoomId(a: string, b: string): string {
  const [x, y] = [a, b].sort()
  return `dm_${x}_${y}`
}

const none = { read: false, create: false, update: false, delete: false } as const
const participantsRead = { read: 'shared', create: false, update: false, delete: false } as const

export const privateRoomsSchema: CollectionSchema = {
  name: 'private_rooms',
  columns: [
    { name: 'participants', storage: 'text', interpretation: { kind: 'json' }, required: true, immutable: true },
    { name: 'lastMessageAt', storage: 'text', interpretation: 'plain' },
    { name: 'lastMessagePreview', storage: 'text', interpretation: 'plain', maxLength: 140 },
    { name: 'lastSenderId', storage: 'text', interpretation: 'plain' },
    { name: 'unread', storage: 'text', interpretation: { kind: 'json' } },
  ],
  collaboratorsField: 'participants',
  permissions: {
    '*': { ...none },
    viewer: { ...none },
    member: { ...participantsRead },
    admin: { ...participantsRead },
  },
}

export const privateMessagesSchema: CollectionSchema = {
  name: 'private_messages',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'participants', storage: 'text', interpretation: { kind: 'json' }, required: true, immutable: true },
    { name: 'senderId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'type',
      storage: 'text',
      interpretation: { kind: 'select', options: ['text', 'voice', 'image', 'system'] },
      required: true,
    },
    { name: 'content', storage: 'text', interpretation: 'plain', maxLength: TEXT_MAX_LENGTH },
    { name: 'imageRefId', storage: 'text', interpretation: 'plain' },
    { name: 'imageRefUrl', storage: 'text', interpretation: 'plain' },
    { name: 'imageRefTranscript', storage: 'text', interpretation: 'plain' },
    { name: 'imageRefOwnerId', storage: 'text', interpretation: 'plain' },
    { name: 'durationMs', storage: 'number', interpretation: 'plain' },
    { name: 'transcript', storage: 'text', interpretation: 'plain' },
  ],
  collaboratorsField: 'participants',
  permissions: {
    '*': { ...none },
    viewer: { ...none },
    member: { ...participantsRead },
    admin: { ...participantsRead },
  },
}
