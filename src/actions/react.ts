/**
 * react — POST /api/actions/react
 *
 * params: { imageId: string, type: 'like' | 'dislike' }
 * Toggle semantics: the same type again clears the reaction; the other type
 * switches it. Refuses reactions to your own image and to taken-down images.
 * Returns the new counts and the caller's current reaction.
 */

import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { PublicImage } from '../schemas/images-schema'
import { reactionId, type ImageReaction, type ReactionType } from '../schemas/reactions-schema'

export function applyReaction(
  counts: { likeCount: number; dislikeCount: number },
  previous: ReactionType | null,
  requested: ReactionType,
): { likeCount: number; dislikeCount: number; next: ReactionType | null } {
  const next = previous === requested ? null : requested
  let { likeCount, dislikeCount } = counts
  if (previous === 'like') likeCount--
  if (previous === 'dislike') dislikeCount--
  if (next === 'like') likeCount++
  if (next === 'dislike') dislikeCount++
  return { likeCount: Math.max(0, likeCount), dislikeCount: Math.max(0, dislikeCount), next }
}

export const react: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const imageId = typeof params.imageId === 'string' ? params.imageId : ''
  const type = params.type
  if (!imageId || (type !== 'like' && type !== 'dislike')) {
    return { success: false, error: 'Invalid reaction.' }
  }

  const image = await tools.get<PublicImage>('public_images', imageId)
  if (!image.success || image.data.record.data.status === 'removed') {
    return { success: false, code: 'not_found', error: 'That image is no longer available.' }
  }
  const img = image.data.record.data
  if (img.ownerId === userId) {
    return { success: false, code: 'self_reaction', error: "You can't react to your own mood." }
  }

  const id = reactionId(imageId, userId)
  const existing = await tools.get<ImageReaction>('image_reactions', id)
  const previous = existing.success ? existing.data.record.data.type : null
  const result = applyReaction(
    { likeCount: Number(img.likeCount ?? 0), dislikeCount: Number(img.dislikeCount ?? 0) },
    previous,
    type,
  )

  const write =
    result.next === null
      ? await tools.remove('image_reactions', id)
      : previous === null
        ? await tools.create('image_reactions', { imageId, actorId: userId, type: result.next }, id)
        : await tools.update('image_reactions', id, { type: result.next })
  if (!write.success) return { success: false, error: 'Could not save your reaction. Try again.' }

  // Counts are a best-effort denormalisation (concurrent reactions can race).
  const counts = await tools.update('public_images', imageId, {
    likeCount: result.likeCount,
    dislikeCount: result.dislikeCount,
  })
  if (!counts.success) console.warn(`[react] count update failed for ${imageId}: ${counts.error}`)

  return {
    success: true,
    data: { reaction: result.next, likeCount: result.likeCount, dislikeCount: result.dislikeCount },
  }
}
