import { describe, expect, it, vi } from 'vitest'
import { resolveOrder, routeImage, monthPeriod, type UsageStore } from './image-router'
import { decodeImageData, mockProvider, MOCK_SIZE, type ImageProvider, type ProviderName } from './providers'

function memoryUsage(initial: Record<string, number> = {}): UsageStore & { counts: Record<string, number> } {
  const counts = { ...initial }
  return {
    counts,
    getCount: async (p, period) => counts[`${p}:${period}`] ?? 0,
    increment: async (p, period) => {
      counts[`${p}:${period}`] = (counts[`${p}:${period}`] ?? 0) + 1
    },
  }
}

function fakeProvider(name: ProviderName, opts: Partial<ImageProvider> = {}): ImageProvider {
  return {
    name,
    monthlyFreeLimit: 2,
    isConfigured: () => true,
    generate: async () => ({ mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }),
    ...opts,
  }
}

const NOW = new Date('2026-11-25T12:00:00Z')
const PERIOD = monthPeriod(NOW)

describe('resolveOrder', () => {
  it('defaults to mock only in local dev so nothing spends credits', () => {
    expect(resolveOrder({ ALLOW_DEBUG_ROUTES: 'true' })).toEqual(['mock'])
  })
  it('uses the full default order when deployed', () => {
    expect(resolveOrder({})).toEqual(['deepspace', 'google', 'openai', 'meta', 'mock'])
  })
  it('honours a configured order, drops unknown names, and always ends with mock', () => {
    expect(resolveOrder({ IMAGE_PROVIDER_ORDER: 'mock, openai,bogus,deepspace,openai' })).toEqual([
      'openai',
      'deepspace',
      'mock',
    ])
  })
})

describe('routeImage', () => {
  it('uses the first configured provider under quota and counts it', async () => {
    const usage = memoryUsage()
    const r = await routeImage('calm', {
      ctx: { env: {} },
      usage,
      order: ['deepspace', 'mock'],
      providers: { deepspace: fakeProvider('deepspace') },
      now: NOW,
    })
    expect(r.provider).toBe('deepspace')
    expect(usage.counts[`deepspace:${PERIOD}`]).toBe(1)
  })

  it('skips unconfigured providers', async () => {
    const r = await routeImage('calm', {
      ctx: { env: {} },
      usage: memoryUsage(),
      order: ['google', 'openai', 'mock'],
      now: NOW,
    })
    expect(r.provider).toBe('mock')
    expect(r.attempts.map((a) => a.outcome)).toEqual(['unconfigured', 'unconfigured', 'used'])
  })

  it('skips a provider whose monthly quota is exhausted', async () => {
    const gen = vi.fn(async () => ({ mimeType: 'image/png', bytes: new Uint8Array([9]) }))
    const r = await routeImage('calm', {
      ctx: { env: {} },
      usage: memoryUsage({ [`deepspace:${PERIOD}`]: 2 }),
      order: ['deepspace', 'mock'],
      providers: { deepspace: fakeProvider('deepspace', { generate: gen }) },
      now: NOW,
    })
    expect(gen).not.toHaveBeenCalled()
    expect(r.provider).toBe('mock')
    expect(r.attempts[0]).toEqual({ provider: 'deepspace', outcome: 'quota_exhausted' })
  })

  it('falls through on provider failure without counting it', async () => {
    const usage = memoryUsage()
    const r = await routeImage('calm', {
      ctx: { env: {} },
      usage,
      order: ['deepspace', 'mock'],
      providers: {
        deepspace: fakeProvider('deepspace', {
          generate: async () => {
            throw new Error('insufficient_credits')
          },
        }),
      },
      now: NOW,
    })
    expect(r.provider).toBe('mock')
    expect(r.attempts[0]).toMatchObject({ outcome: 'failed', error: 'insufficient_credits' })
    expect(usage.counts[`deepspace:${PERIOD}`]).toBeUndefined()
  })
})

describe('mock provider', () => {
  it('produces a valid, deterministic PNG', async () => {
    const a = await mockProvider.generate('a quiet rainy evening', { env: {} })
    const b = await mockProvider.generate('a quiet rainy evening', { env: {} })
    const c = await mockProvider.generate('bright, loud, happy', { env: {} })
    expect(Array.from(a.bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(a.bytes.buffer, a.bytes.byteOffset)
    expect(view.getUint32(16)).toBe(MOCK_SIZE)
    expect(view.getUint32(20)).toBe(MOCK_SIZE)
    expect(a.bytes).toEqual(b.bytes)
    expect(a.bytes).not.toEqual(c.bytes)
    expect(a.bytes.length).toBeLessThan(200_000)
  })
})

describe('decodeImageData', () => {
  it('reads data URIs and bare base64', () => {
    expect(decodeImageData('data:image/jpeg;base64,AQID')).toEqual({
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(decodeImageData('AQID').mimeType).toBe('image/png')
  })
})
