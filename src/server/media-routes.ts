/**
 * GET /api/media/dm/:messageId — private chat media (voice notes, private images).
 *
 * The bytes live in the SENDER's private file scope, which the platform only
 * serves to the sender. This route lets the other participant see them too:
 * it identifies the caller (Bearer, else the same-origin session cookie so
 * <img>/<audio> work), loads the message, checks the caller is one of its
 * participants, then streams the file using the app's identity.
 */

import type { Hono } from 'hono'
import { AppFileError, appFiles, resolveSessionReadAuth } from 'deepspace/worker'
import type { AppContext } from '../../worker.js'
import type { PrivateMessage } from '../schemas/chat-schema.js'
import { createActionTools } from './action-routes.js'
import { resolveAuth } from './http-routes.js'

export function registerMediaRoutes(app: Hono<AppContext>): void {
  app.get('/api/media/dm/:messageId', async (c) => {
    const auth =
      (await resolveAuth(c.req.raw, c.env)) ?? (await resolveSessionReadAuth(c.req.raw, c.env))
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)

    // RBAC-off read; the participant check below is the authorization.
    const tools = createActionTools(c.env, auth.userId, '')
    const r = await tools.get<PrivateMessage>('private_messages', c.req.param('messageId'))
    const msg = r.success ? r.data.record.data : null
    if (!msg || !msg.participants?.includes(auth.userId) || (msg.type !== 'voice' && msg.type !== 'image')) {
      return c.json({ error: 'Not found' }, 404)
    }

    try {
      const file = await appFiles(c.env, { scope: 'self', userId: msg.senderId }).download(msg.content)
      const headers = new Headers()
      headers.set('Content-Type', file.headers.get('Content-Type') ?? 'application/octet-stream')
      const len = file.headers.get('Content-Length')
      if (len) headers.set('Content-Length', len)
      headers.set('Cache-Control', 'private, max-age=3600')
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(file.body, { status: 200, headers })
    } catch (err) {
      if (err instanceof AppFileError && err.status === 404) return c.json({ error: 'Not found' }, 404)
      console.error(`[media] download failed: ${err instanceof Error ? err.message : String(err)}`)
      return c.json({ error: 'Media unavailable' }, 502)
    }
  })
}
