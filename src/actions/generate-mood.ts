/**
 * generateMood — POST /api/actions/generateMood
 *
 * params: { transcript: string, inputMode: 'voice' | 'typed' }
 * Generates an image for the caller's mood, stores it in the app's public file
 * scope, and creates the `public_images` row. The transcript is used exactly
 * as captured (not editable before generation, by product decision).
 */

import { appFiles } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { PublicImage } from '../schemas/images-schema'
import { extensionFor, generateForUser, normalizeTranscript } from './generation'

export const generateMood: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const transcript = normalizeTranscript(params.transcript)
  if (!transcript) return { success: false, error: 'Say or type a mood first (up to 500 characters).' }
  const inputMode: PublicImage['inputMode'] = params.inputMode === 'voice' ? 'voice' : 'typed'

  const generated = await generateForUser({
    userId,
    transcript,
    tools,
    env: env as unknown as Record<string, unknown>,
  })
  if (!generated.ok) return { success: false, code: generated.code, error: generated.error }

  const imageId = crypto.randomUUID()
  const { image, provider } = generated
  let stored
  try {
    stored = await appFiles(env, { scope: 'app', userId }).upload(
      new Blob([image.bytes as BlobPart], { type: image.mimeType }),
      { key: `moods/${imageId}.${extensionFor(image.mimeType)}`, name: `mood-${imageId}` },
    )
  } catch (err) {
    console.error(`[generateMood] upload failed: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, code: 'storage_failed', error: 'Could not save the image. Try again later.' }
  }

  const record: PublicImage = {
    ownerId: userId,
    r2Key: stored.key,
    imageUrl: stored.path,
    promptTranscript: transcript,
    inputMode,
    providerUsed: provider,
    likeCount: 0,
    dislikeCount: 0,
    status: 'live',
  }
  const created = await tools.create('public_images', { ...record }, imageId)
  if (!created.success) {
    console.error(`[generateMood] record create failed: ${created.error}`)
    return { success: false, error: 'Could not publish the image. Try again.' }
  }
  return { success: true, data: { imageId, provider, imageUrl: stored.path } }
}
