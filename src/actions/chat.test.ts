import { describe, expect, it } from 'vitest'
import type { Env } from '../../worker'
import { dmRoomId } from '../schemas/chat-schema'
import { fakeTools } from './fake-tools'
import { markRead, openChat, sendMessage, sendVoice } from './chat'

const env = {} as Env

async function setup() {
  const f = fakeTools('alice')
  await f.tools.create(
    'public_images',
    { ownerId: 'alice', imageUrl: '/a.png', promptTranscript: 'calm sea', status: 'live' },
    'img1',
  )
  await f.tools.create(
    'public_images',
    { ownerId: 'alice', imageUrl: '/b.png', promptTranscript: 'storm', status: 'live' },
    'img2',
  )
  const run = (
    handler: typeof openChat,
    userId: string,
    params: Record<string, unknown>,
  ) => handler({ userId, params, tools: f.as(userId).tools, env, callerJwt: 't' })
  const room = (id: string) => f.store.get('private_rooms')?.get(id)?.data as Record<string, any> | undefined
  const messages = () => [...(f.store.get('private_messages')?.values() ?? [])].map((r) => r.data)
  return { f, run, room, messages }
}

describe('dmRoomId', () => {
  it('is the same for both orderings', () => {
    expect(dmRoomId('b', 'a')).toBe(dmRoomId('a', 'b'))
  })
})

describe('openChat', () => {
  it('creates one room per pair with a system card, and reuses it', async () => {
    const { run, room, messages } = await setup()
    const first = await run(openChat, 'bob', { imageId: 'img1' })
    expect(first).toEqual({ success: true, data: { roomId: dmRoomId('alice', 'bob') } })
    const id = dmRoomId('alice', 'bob')
    expect(room(id)!.participants).toEqual(['alice', 'bob'])
    expect(messages()).toHaveLength(1)
    expect(messages()[0]).toMatchObject({ type: 'system', senderId: 'bob', imageRefId: 'img1', imageRefOwnerId: 'alice' })
    expect(room(id)!.unread).toEqual({ alice: 1 })

    // Same image again: same room, no duplicate card.
    await run(openChat, 'bob', { imageId: 'img1' })
    expect(messages()).toHaveLength(1)

    // Different image from the same person: same room, a new card.
    await run(openChat, 'bob', { imageId: 'img2' })
    expect(messages()).toHaveLength(2)
    expect(messages().every((m) => m.roomId === id)).toBe(true)
  })

  it('refuses chatting with yourself and with removed images', async () => {
    const { f, run } = await setup()
    expect(await run(openChat, 'alice', { imageId: 'img1' })).toMatchObject({ success: false, code: 'self_chat' })
    await f.tools.update('public_images', 'img1', { status: 'removed' })
    expect(await run(openChat, 'bob', { imageId: 'img1' })).toMatchObject({ success: false, code: 'not_found' })
  })
})

describe('room membership', () => {
  it('lets participants message and bumps the peer unread count', async () => {
    const { run, room, messages } = await setup()
    await run(openChat, 'bob', { imageId: 'img1' })
    const roomId = dmRoomId('alice', 'bob')

    expect((await run(sendMessage, 'alice', { roomId, text: 'hi bob' })).success).toBe(true)
    expect(room(roomId)!.unread).toEqual({ alice: 1, bob: 1 })
    expect(room(roomId)!.lastMessagePreview).toBe('hi bob')
    expect(messages().at(-1)).toMatchObject({ senderId: 'alice', type: 'text', content: 'hi bob', participants: ['alice', 'bob'] })

    await run(markRead, 'alice', { roomId })
    expect(room(roomId)!.unread).toEqual({ alice: 0, bob: 1 })
  })

  it('refuses outsiders without confirming the room exists', async () => {
    const { run, messages } = await setup()
    await run(openChat, 'bob', { imageId: 'img1' })
    const roomId = dmRoomId('alice', 'bob')
    const before = messages().length

    expect(await run(sendMessage, 'carol', { roomId, text: 'let me in' })).toMatchObject({ success: false, code: 'not_found' })
    expect(await run(markRead, 'carol', { roomId })).toMatchObject({ success: false, code: 'not_found' })
    expect(await run(sendVoice, 'carol', { roomId, audioBase64: 'AAAA', mimeType: 'audio/webm' })).toMatchObject({
      success: false,
      code: 'not_found',
    })
    expect(await run(sendMessage, 'carol', { roomId: 'dm_nope', text: 'x' })).toMatchObject({ code: 'not_found' })
    expect(messages()).toHaveLength(before)
  })

  it('validates text and voice payloads', async () => {
    const { run } = await setup()
    await run(openChat, 'bob', { imageId: 'img1' })
    const roomId = dmRoomId('alice', 'bob')
    expect((await run(sendMessage, 'bob', { roomId, text: '   ' })).success).toBe(false)
    expect((await run(sendMessage, 'bob', { roomId, text: 'x'.repeat(2001) })).success).toBe(false)
    expect((await run(sendVoice, 'bob', { roomId, audioBase64: 'AAAA', mimeType: 'text/html' })).success).toBe(false)
  })
})
