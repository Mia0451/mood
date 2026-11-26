/**
 * Quota-aware image provider router.
 *
 * Walks the configured provider order and returns the first image produced by
 * a provider that (a) is configured (key set / proxy available) and (b) is
 * under its monthly cap. Failures fall through to the next provider. The mock
 * provider is always appended as the final fallback, so generation never
 * hard-fails for lack of keys or quota.
 *
 * Pure apart from the injected UsageStore and provider calls — unit-tested in
 * image-router.test.ts.
 */

import {
  ALL_PROVIDERS,
  type GeneratedImage,
  type ImageProvider,
  type ProviderContext,
  type ProviderName,
} from './providers'

export interface UsageStore {
  getCount(provider: ProviderName, period: string): Promise<number>
  increment(provider: ProviderName, period: string): Promise<void>
}

export interface RouteAttempt {
  provider: ProviderName
  outcome: 'used' | 'unconfigured' | 'quota_exhausted' | 'failed'
  error?: string
}

export interface RouteResult {
  image: GeneratedImage
  provider: ProviderName
  attempts: RouteAttempt[]
}

export const DEFAULT_ORDER: ProviderName[] = ['deepspace', 'google', 'openai', 'meta', 'mock']

/** `YYYY-MM` in UTC — the monthly quota period. */
export function monthPeriod(now: Date): string {
  return now.toISOString().slice(0, 7)
}

/**
 * Provider order from env:
 *  - local dev/test (ALLOW_DEBUG_ROUTES === 'true') uses IMAGE_PROVIDER_ORDER_DEV,
 *    defaulting to mock only, so local runs never spend credits by accident;
 *  - otherwise IMAGE_PROVIDER_ORDER, defaulting to DEFAULT_ORDER.
 * Unknown names are dropped; mock is always last.
 */
export function resolveOrder(env: Record<string, unknown>): ProviderName[] {
  const isLocal = env.ALLOW_DEBUG_ROUTES === 'true'
  const raw = isLocal ? env.IMAGE_PROVIDER_ORDER_DEV : env.IMAGE_PROVIDER_ORDER
  const fallback = isLocal ? ['mock'] : DEFAULT_ORDER
  const names =
    typeof raw === 'string' && raw.trim()
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : fallback
  const order = names.filter((n, i): n is ProviderName => n in ALL_PROVIDERS && names.indexOf(n) === i)
  return [...order.filter((n) => n !== 'mock'), 'mock']
}

export async function routeImage(
  prompt: string,
  opts: {
    ctx: ProviderContext
    usage: UsageStore
    order?: ProviderName[]
    providers?: Partial<Record<ProviderName, ImageProvider>>
    now?: Date
  },
): Promise<RouteResult> {
  const order = opts.order ?? resolveOrder(opts.ctx.env)
  const providers = { ...ALL_PROVIDERS, ...opts.providers }
  const period = monthPeriod(opts.now ?? new Date())
  const attempts: RouteAttempt[] = []

  for (const name of order) {
    const provider = providers[name]
    if (!provider.isConfigured(opts.ctx)) {
      attempts.push({ provider: name, outcome: 'unconfigured' })
      continue
    }
    if (Number.isFinite(provider.monthlyFreeLimit)) {
      const used = await opts.usage.getCount(name, period)
      if (used >= provider.monthlyFreeLimit) {
        attempts.push({ provider: name, outcome: 'quota_exhausted' })
        continue
      }
    }
    try {
      const image = await provider.generate(prompt, opts.ctx)
      await opts.usage.increment(name, period)
      attempts.push({ provider: name, outcome: 'used' })
      return { image, provider: name, attempts }
    } catch (err) {
      attempts.push({
        provider: name,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  throw new Error(`No image provider succeeded: ${JSON.stringify(attempts)}`)
}
