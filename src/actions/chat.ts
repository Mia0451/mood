/**
 * Private chat server actions. All run RBAC-off, so each one re-checks that
 * the caller is a participant before touching a room.
 *
 *   openChat       { imageId }                         → { roomId }
 *   sendMessage    { roomId, text }
 *   sendVoice      { roomId, audioBase64, mimeType, durationMs }
 *   generateInChat { roomId, transcript, inputMode }   (counts toward the daily cap)
 *   markRead       { roomId }
 */

import { appFiles } from 'deepspace/worker'
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { base64ToBytes } from '../ai/providers'
import type { PublicImage } from '../schemas/images-schema'
import {
  dmRoomId,
  TEXT_MAX_LENGTH,
  type PrivateMessage,
  type PrivateRoom,
} from '../schemas/chat-schema'
import { extensionFor, generateForUser, normalizeTranscript } from './generation'

export const VOICE_MAX_BYTES = 1_500_000
export const VOICE_MAX_MS = 60_000

type Fail = { success: false; code?: string; error: string }
const fail = (error: string, code?: string): Fail => ({ success: false, error, ...(code ? { code } : {}) })

/** The room, if the caller is one of its two participants. */
export async function loadRoomFor(
  tools: ActionTools,
  roomId: unknown,
  userId: string,
): Promise<{ ok: true; room: PrivateRoom } | { ok: false; fail: Fail }> {
  if (typeof roomId !== 'string' || !roomId) return { ok: false, fail: fail('Missing chat.') }
  const r = await tools.get<PrivateRoom>('private_rooms', roomId)
  // Same answer for "missing" and "not yours": never confirm a room exists.
  if (!r.success || !r.data.record.data.participants?.includes(userId)) {
    return { ok: false, fail: fail('Chat not found.', 'not_found') }
  }
  return { ok: true, room: r.data.record.data }
}

async function postMessage(
  tools: ActionTools,
  roomId: string,
  room: PrivateRoom,
  message: Omit<PrivateMessage, 'roomId' | 'participants'>,
  preview: string,
  messageId = crypto.randomUUID(),
): Promise<{ success: true; data: { messageId: string } } | Fail> {
  const created = await tools.create(
    'private_messages',
    { ...message, roomId, participants: room.participants },
    messageId,
  )
  if (!created.success) return fail('Could not send the message. Try again.')

  const unread = { ...(room.unread ?? {}) }
  for (const p of room.participants) {
    if (p !== message.senderId) unread[p] = (unread[p] ?? 0) + 1
  }
  const updated = await tools.update('private_rooms', roomId, {
    lastMessageAt: new Date().toISOString(),
    lastMessagePreview: preview.slice(0, 140),
    lastSenderId: message.senderId,
    unread,
  })
  if (!updated.success) console.warn(`[chat] room update failed for ${roomId}: ${updated.error}`)
  return { success: true, data: { messageId } }
}

export const openChat: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const imageId = typeof params.imageId === 'string' ? params.imageId : ''
  const image = await tools.get<PublicImage>('public_images', imageId)
  if (!image.success || image.data.record.data.status === 'removed') {
    return fail('That image is no longer available.', 'not_found')
  }
  const img = image.data.record.data
  if (img.ownerId === userId) return fail("That's your own mood.", 'self_chat')

  const roomId = dmRoomId(userId, img.ownerId)
  let room: PrivateRoom
  const existing = await tools.get<PrivateRoom>('private_rooms', roomId)
  if (existing.success) {
    room = existing.data.record.data
  } else {
    room = {
      participants: [userId, img.ownerId].sort(),
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: '',
      lastSenderId: userId,
      unread: {},
    }
    const created = await tools.create('private_rooms', { ...room }, roomId)
    if (!created.success) {
      // A concurrent open by the peer may have just created it.
      const retry = await tools.get<PrivateRoom>('private_rooms', roomId)
      if (!retry.success) return fail('Could not open the chat. Try again.')
      room = retry.data.record.data
    }
  }

  // One context card per image per room.
  const already = await tools.query('private_messages', { where: { roomId, imageRefId: imageId }, limit: 1 })
  if (!already.success || already.data.records.length === 0) {
    const posted = await postMessage(
      tools,
      roomId,
      room,
      {
        senderId: userId,
        type: 'system',
        content: 'Started a chat from this mood',
        imageRefId: imageId,
        imageRefUrl: img.imageUrl,
        imageRefTranscript: img.promptTranscript,
        imageRefOwnerId: img.ownerId,
      },
      'Started a chat from a mood',
    )
    if (!posted.success) return posted
  }
  return { success: true, data: { roomId } }
}

export const sendMessage: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const loaded = await loadRoomFor(tools, params.roomId, userId)
  if (!loaded.ok) return loaded.fail
  const text = typeof params.text === 'string' ? params.text.trim() : ''
  if (!text) return fail('Write something first.')
  if (text.length > TEXT_MAX_LENGTH) return fail(`Keep it under ${TEXT_MAX_LENGTH} characters.`)
  return postMessage(tools, params.roomId as string, loaded.room, { senderId: userId, type: 'text', content: text }, text)
}

function audioExtension(mime: string): string | null {
  const base = mime.split(';')[0].trim().toLowerCase()
  if (base === 'audio/webm') return 'webm'
  if (base === 'audio/ogg') return 'ogg'
  if (base === 'audio/mp4' || base === 'audio/aac' || base === 'audio/x-m4a') return 'm4a'
  if (base === 'audio/mpeg') return 'mp3'
  return null
}

export const sendVoice: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const loaded = await loadRoomFor(tools, params.roomId, userId)
  if (!loaded.ok) return loaded.fail
  const roomId = params.roomId as string
  const mimeType = typeof params.mimeType === 'string' ? params.mimeType : ''
  const ext = audioExtension(mimeType)
  if (!ext || typeof params.audioBase64 !== 'string') return fail('Unsupported recording format.')
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(params.audioBase64)
  } catch {
    return fail('Unreadable recording.')
  }
  if (bytes.length === 0) return fail('The recording was empty.')
  if (bytes.length > VOICE_MAX_BYTES) return fail('That recording is too long. Keep voice notes under a minute.')
  const durationMs = Math.min(Math.max(0, Number(params.durationMs) || 0), VOICE_MAX_MS)

  const messageId = crypto.randomUUID()
  let key: string
  try {
    const stored = await appFiles(env, { scope: 'self', userId }).upload(
      new Blob([bytes as BlobPart], { type: mimeType.split(';')[0] }),
      { key: `dm/${roomId}/${messageId}.${ext}`, name: `voice-${messageId}.${ext}` },
    )
    key = stored.key
  } catch (err) {
    console.error(`[sendVoice] upload failed: ${err instanceof Error ? err.message : String(err)}`)
    return fail('Could not save the voice note. Try again later.', 'storage_failed')
  }
  return postMessage(
    tools,
    roomId,
    loaded.room,
    { senderId: userId, type: 'voice', content: key, durationMs },
    '🎙 Voice note',
    messageId,
  )
}

export const generateInChat: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const loaded = await loadRoomFor(tools, params.roomId, userId)
  if (!loaded.ok) return loaded.fail
  const roomId = params.roomId as string
  const transcript = normalizeTranscript(params.transcript)
  if (!transcript) return fail('Say or type a mood first (up to 500 characters).')

  const generated = await generateForUser({ userId, transcript, tools, env: env as unknown as Record<string, unknown> })
  if (!generated.ok) return fail(generated.error, generated.code)

  // Private: stored in the sender's own folder, never in the public scope.
  const messageId = crypto.randomUUID()
  let key: string
  try {
    const stored = await appFiles(env, { scope: 'self', userId }).upload(
      new Blob([generated.image.bytes as BlobPart], { type: generated.image.mimeType }),
      { key: `dm/${roomId}/${messageId}.${extensionFor(generated.image.mimeType)}`, name: `mood-${messageId}` },
    )
    key = stored.key
  } catch (err) {
    console.error(`[generateInChat] upload failed: ${err instanceof Error ? err.message : String(err)}`)
    return fail('Could not save the image. Try again later.', 'storage_failed')
  }
  return postMessage(
    tools,
    roomId,
    loaded.room,
    { senderId: userId, type: 'image', content: key, transcript },
    `🎨 “${transcript}”`,
    messageId,
  )
}

export const markRead: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const loaded = await loadRoomFor(tools, params.roomId, userId)
  if (!loaded.ok) return loaded.fail
  if ((loaded.room.unread?.[userId] ?? 0) === 0) return { success: true, data: { unread: 0 } }
  const r = await tools.update('private_rooms', params.roomId as string, {
    unread: { ...loaded.room.unread, [userId]: 0 },
  })
  if (!r.success) return fail('Could not update read state.')
  return { success: true, data: { unread: 0 } }
}
