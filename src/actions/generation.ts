/**
 * Shared generation core for server actions: the per-user daily cap and the
 * quota-tracked provider router. Both public-room and private-chat
 * generations go through `generateForUser`, so both count toward the cap.
 *
 * Runs RBAC-off (server action tools) — every id used here is derived from the
 * verified caller or from server state, never from client params.
 */

import type { ActionTools } from 'deepspace/worker'
import { routeImage, type UsageStore } from '../ai/image-router'
import { imagePrompt, type GeneratedImage, type ProviderName } from '../ai/providers'
import { PROMPT_MAX_LENGTH } from '../schemas/images-schema'

export const DEFAULT_DAILY_IMAGE_LIMIT = 5
const LOCAL_DAILY_IMAGE_LIMIT = 50

export function dailyLimit(env: Record<string, unknown>): number {
  const configured = Number(env.DAILY_IMAGE_LIMIT)
  if (Number.isFinite(configured) && configured > 0) return configured
  return env.ALLOW_DEBUG_ROUTES === 'true' ? LOCAL_DAILY_IMAGE_LIMIT : DEFAULT_DAILY_IMAGE_LIMIT
}

/** UTC day, `YYYY-MM-DD`. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

async function readCount(tools: ActionTools, collection: string, id: string): Promise<number | null> {
  const r = await tools.get<{ count?: number }>(collection, id)
  if (!r.success) return null
  return Number(r.data.record.data.count ?? 0)
}

async function bump(
  tools: ActionTools,
  collection: string,
  id: string,
  fresh: Record<string, unknown>,
): Promise<void> {
  // Best-effort read-modify-write: two concurrent generations by one user can
  // both pass the cap check. Acceptable for a spend guard at this scale.
  const current = await readCount(tools, collection, id)
  const r =
    current === null
      ? await tools.create(collection, { ...fresh, count: 1 }, id)
      : await tools.update(collection, id, { count: current + 1 })
  if (!r.success) console.warn(`[usage] could not bump ${collection}/${id}: ${r.error}`)
}

function usageStore(tools: ActionTools): UsageStore {
  return {
    getCount: async (provider, period) =>
      (await readCount(tools, 'provider_usage', `${provider}:${period}`)) ?? 0,
    increment: (provider, period) =>
      bump(tools, 'provider_usage', `${provider}:${period}`, { provider, period }),
  }
}

export function normalizeTranscript(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || text.length > PROMPT_MAX_LENGTH) return null
  return text
}

export type GenerationOutcome =
  | { ok: true; image: GeneratedImage; provider: ProviderName }
  | { ok: false; code: 'daily_limit' | 'generation_failed'; error: string }

export async function generateForUser(opts: {
  userId: string
  transcript: string
  tools: ActionTools
  env: Record<string, unknown>
}): Promise<GenerationOutcome> {
  const { userId, transcript, tools, env } = opts
  const day = utcDay()
  const limit = dailyLimit(env)
  const usedToday = (await readCount(tools, 'generation_usage', `${userId}:${day}`)) ?? 0
  if (usedToday >= limit) {
    return {
      ok: false,
      code: 'daily_limit',
      error: `You've used all ${limit} of today's moods. Come back tomorrow.`,
    }
  }

  try {
    const result = await routeImage(imagePrompt(transcript), {
      ctx: { env, integration: (endpoint, data) => tools.integration(endpoint, data) },
      usage: usageStore(tools),
    })
    console.info(`[generate] user=${userId} provider=${result.provider} attempts=${JSON.stringify(result.attempts)}`)
    await bump(tools, 'generation_usage', `${userId}:${day}`, { userId, day })
    return { ok: true, image: result.image, provider: result.provider }
  } catch (err) {
    console.error(`[generate] user=${userId} failed: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, code: 'generation_failed', error: 'Could not generate an image right now. Try again.' }
  }
}

export function extensionFor(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}
