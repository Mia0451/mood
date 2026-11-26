/**
 * takedownImage — POST /api/actions/takedownImage (admins only)
 *
 * params: { imageId: string }
 * Marks the image 'removed' (it vanishes from the room for everyone but its
 * owner and admins) and deletes the stored file, because public-scope file
 * URLs are world-readable and would otherwise keep serving.
 */

import { appFiles, resolveAppRole } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { PublicImage } from '../schemas/images-schema'

export async function isAdmin(env: Env, userId: string): Promise<boolean> {
  if (env.OWNER_USER_ID && env.OWNER_USER_ID === userId) return true
  try {
    return (await resolveAppRole(env, userId)) === 'admin'
  } catch {
    return false
  }
}

export const takedownImage: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (!(await isAdmin(env, userId))) {
    return { success: false, code: 'forbidden', error: 'Only admins can take images down.' }
  }
  const imageId = typeof params.imageId === 'string' ? params.imageId : ''
  const image = await tools.get<PublicImage>('public_images', imageId)
  if (!image.success) return { success: false, code: 'not_found', error: 'Image not found.' }

  const updated = await tools.update('public_images', imageId, { status: 'removed' })
  if (!updated.success) return { success: false, error: 'Could not take the image down.' }

  try {
    await appFiles(env, { scope: 'app', userId }).delete(image.data.record.data.r2Key)
  } catch (err) {
    console.warn(`[takedown] file delete failed for ${imageId}: ${err instanceof Error ? err.message : String(err)}`)
  }
  console.info(`[takedown] image=${imageId} by=${userId}`)
  return { success: true, data: { imageId } }
}
