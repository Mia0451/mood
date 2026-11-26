/**
 * TEMPORARY — one-off production data reset. Remove after use.
 *
 * Admin-only agent tool that deletes every record in mood's collections and
 * the stored files they reference (public images, private chat media).
 * Requires the exact confirmation phrase.
 */

import { jsonSchema, tool } from 'ai'
import { appFiles } from 'deepspace/worker'
import type { AgentToolContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { isAdmin } from '../actions/takedown'
import { createActionTools } from '../server/action-routes'

export const PURGE_PHRASE = 'PURGE ALL MOOD DATA'

const COLLECTIONS = [
  'private_messages',
  'private_rooms',
  'image_reactions',
  'public_images',
  'generation_usage',
  'provider_usage',
] as const

export function purgeTool(context: AgentToolContext<Env>) {
  return tool({
    description: `TEMPORARY admin-only reset: deletes ALL mood records and their files. Requires confirm="${PURGE_PHRASE}".`,
    inputSchema: jsonSchema<{ confirm: string }>({
      type: 'object',
      properties: { confirm: { type: 'string' } },
      required: ['confirm'],
    }),
    execute: async ({ confirm }) => {
      const { env, userId } = context
      if (!(await isAdmin(env, userId))) return { ok: false, error: 'admin only' }
      if (confirm !== PURGE_PHRASE) return { ok: false, error: 'confirmation phrase mismatch' }

      const tools = createActionTools(env, userId, '')
      const report: Record<string, { records: number; files: number; errors: string[] }> = {}

      for (const collection of COLLECTIONS) {
        const r = { records: 0, files: 0, errors: [] as string[] }
        report[collection] = r
        for (;;) {
          const q = await tools.query<Record<string, unknown>>(collection, { limit: 200 })
          if (!q.success) {
            r.errors.push(q.error)
            break
          }
          if (q.data.records.length === 0) break
          for (const rec of q.data.records) {
            const d = rec.data
            try {
              if (collection === 'public_images' && typeof d.r2Key === 'string') {
                if ((await appFiles(env, { scope: 'app', userId }).delete(d.r2Key)).existed) r.files++
              }
              if (collection === 'private_messages' && (d.type === 'voice' || d.type === 'image')) {
                const sender = String(d.senderId)
                if ((await appFiles(env, { scope: 'self', userId: sender }).delete(String(d.content))).existed) r.files++
              }
            } catch (err) {
              r.errors.push(`file ${rec.recordId}: ${err instanceof Error ? err.message : String(err)}`)
            }
            const del = await tools.remove(collection, rec.recordId)
            if (del.success) r.records++
            else r.errors.push(`record ${rec.recordId}: ${del.error}`)
          }
          if (r.errors.length > 20) break
        }
      }
      console.info(`[purge] by=${userId} ${JSON.stringify(report)}`)
      return { ok: true, report }
    },
  })
}
