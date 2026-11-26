/**
 * Image providers for the router in ./image-router.ts.
 *
 * - deepspace: the platform integration proxy (`gemini/generate-image`). No
 *   provider key; billed to the app owner's DeepSpace credits.
 * - google / openai / meta: direct provider calls, active only when their key
 *   is set with `npx deepspace secrets set <VAR>=…`. They are written against
 *   the providers' public REST APIs but have not been exercised against live
 *   keys yet.
 * - mock: a deterministic abstract PNG drawn from the prompt. Free, always
 *   available, and the last resort when everything else is unset or exhausted.
 */

import { encodePng } from './png'

export type ProviderName = 'deepspace' | 'google' | 'openai' | 'meta' | 'mock'

export interface GeneratedImage {
  bytes: Uint8Array
  mimeType: string
}

/** What a provider may use: env keys, and the integration proxy (server actions only). */
export interface ProviderContext {
  env: Record<string, unknown>
  integration?: <T = unknown>(
    endpoint: string,
    data?: unknown,
  ) => Promise<{ success: true; data: T } | { success: false; error: string }>
  fetch?: typeof fetch
}

export interface ImageProvider {
  name: ProviderName
  /** Monthly cap the router enforces; Infinity for the mock. */
  monthlyFreeLimit: number
  apiKeyEnvVar?: string
  isConfigured(ctx: ProviderContext): boolean
  generate(prompt: string, ctx: ProviderContext): Promise<GeneratedImage>
}

/** Image models otherwise draw gibberish lettering. */
export const NO_TEXT_SUFFIX = 'no text, no words, no letters, no writing, no logos'

export function imagePrompt(transcript: string): string {
  return `An evocative, painterly image expressing this mood: "${transcript}". ${NO_TEXT_SUFFIX}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Accepts `data:image/png;base64,…` or bare base64 (assumed PNG). */
export function decodeImageData(value: string): GeneratedImage {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(value)
  if (m) return { mimeType: m[1], bytes: base64ToBytes(m[2]) }
  return { mimeType: 'image/png', bytes: base64ToBytes(value) }
}

function keyOf(ctx: ProviderContext, name: string): string | undefined {
  const v = ctx.env[name]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

async function postJson(ctx: ProviderContext, url: string, headers: Record<string, string>, body: unknown) {
  const res = await (ctx.fetch ?? fetch)(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const deepspaceProvider: ImageProvider = {
  name: 'deepspace',
  monthlyFreeLimit: 300,
  isConfigured: (ctx) => typeof ctx.integration === 'function',
  async generate(prompt, ctx) {
    if (!ctx.integration) throw new Error('integration proxy unavailable')
    const r = await ctx.integration<{ base64Images?: string[] }>('gemini/generate-image', {
      prompt,
      aspectRatio: '1:1',
    })
    if (!r.success) throw new Error(r.error)
    const first = r.data.base64Images?.[0]
    if (!first) throw new Error('gemini/generate-image returned no image')
    return decodeImageData(first)
  },
}

export const googleProvider: ImageProvider = {
  name: 'google',
  monthlyFreeLimit: 100,
  apiKeyEnvVar: 'GOOGLE_API_KEY',
  isConfigured: (ctx) => !!keyOf(ctx, 'GOOGLE_API_KEY'),
  async generate(prompt, ctx) {
    const json = await postJson(
      ctx,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      { 'x-goog-api-key': keyOf(ctx, 'GOOGLE_API_KEY')! },
      { contents: [{ parts: [{ text: prompt }] }] },
    )
    type Part = { inlineData?: { mimeType: string; data: string } }
    const parts = ((json.candidates as Array<{ content?: { parts?: Part[] } }>)?.[0]?.content?.parts ?? [])
    const img = parts.find((p) => p.inlineData)?.inlineData
    if (!img) throw new Error('Google returned no image')
    return { mimeType: img.mimeType, bytes: base64ToBytes(img.data) }
  },
}

export const openaiProvider: ImageProvider = {
  name: 'openai',
  monthlyFreeLimit: 50,
  apiKeyEnvVar: 'OPENAI_API_KEY',
  isConfigured: (ctx) => !!keyOf(ctx, 'OPENAI_API_KEY'),
  async generate(prompt, ctx) {
    const json = await postJson(
      ctx,
      'https://api.openai.com/v1/images/generations',
      { Authorization: `Bearer ${keyOf(ctx, 'OPENAI_API_KEY')}` },
      { model: 'gpt-image-1', prompt, size: '1024x1024', quality: 'low', n: 1 },
    )
    const b64 = (json.data as Array<{ b64_json?: string }>)?.[0]?.b64_json
    if (!b64) throw new Error('OpenAI returned no image')
    return { mimeType: 'image/png', bytes: base64ToBytes(b64) }
  },
}

/** The "meta" slot calls Together's OpenAI-compatible image API (free FLUX tier by default). */
export const metaProvider: ImageProvider = {
  name: 'meta',
  monthlyFreeLimit: 500,
  apiKeyEnvVar: 'META_API_KEY',
  isConfigured: (ctx) => !!keyOf(ctx, 'META_API_KEY'),
  async generate(prompt, ctx) {
    const json = await postJson(
      ctx,
      'https://api.together.xyz/v1/images/generations',
      { Authorization: `Bearer ${keyOf(ctx, 'META_API_KEY')}` },
      {
        model: keyOf(ctx, 'META_IMAGE_MODEL') ?? 'black-forest-labs/FLUX.1-schnell-Free',
        prompt,
        width: 768,
        height: 768,
        steps: 4,
        n: 1,
        response_format: 'b64_json',
      },
    )
    const b64 = (json.data as Array<{ b64_json?: string }>)?.[0]?.b64_json
    if (!b64) throw new Error('Together returned no image')
    return decodeImageData(b64)
  },
}

/** FNV-1a — stable across runtimes, so the same prompt always draws the same picture. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export const MOCK_SIZE = 256

export const mockProvider: ImageProvider = {
  name: 'mock',
  monthlyFreeLimit: Infinity,
  isConfigured: () => true,
  async generate(prompt) {
    const seed = hash(prompt)
    const hueA = seed % 360
    const hueB = (hueA + 40 + ((seed >>> 9) % 140)) % 360
    const a = hsl(hueA, 0.65, 0.32)
    const b = hsl(hueB, 0.75, 0.62)
    // A soft glowing orb whose position also comes from the prompt.
    const cx = 0.25 + ((seed >>> 3) % 50) / 100
    const cy = 0.25 + ((seed >>> 13) % 50) / 100
    const glow = hsl((hueB + 30) % 360, 0.9, 0.78)

    const n = MOCK_SIZE
    const rgb = new Uint8Array(n * n * 3)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const t = (x + y) / (2 * n)
        const dx = x / n - cx
        const dy = y / n - cy
        const orb = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 0.32) ** 2
        const i = (y * n + x) * 3
        for (let c = 0; c < 3; c++) {
          const base = a[c] + (b[c] - a[c]) * t
          rgb[i + c] = Math.round(base + (glow[c] - base) * orb)
        }
      }
    }
    return { mimeType: 'image/png', bytes: await encodePng(n, n, rgb) }
  },
}

export const ALL_PROVIDERS: Record<ProviderName, ImageProvider> = {
  deepspace: deepspaceProvider,
  google: googleProvider,
  openai: openaiProvider,
  meta: metaProvider,
  mock: mockProvider,
}
