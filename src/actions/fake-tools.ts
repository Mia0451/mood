/**
 * In-memory ActionTools for unit-testing server actions. Test-only.
 */

import type { ActionTools } from 'deepspace/worker'

type Row = { recordId: string; data: Record<string, unknown>; createdBy: string; createdAt: string; updatedAt: string }

export function fakeTools(actingAs: string, store: Map<string, Map<string, Row>> = new Map()) {
  const col = (name: string) => {
    if (!store.has(name)) store.set(name, new Map())
    return store.get(name)!
  }
  let seq = 0
  const now = () => new Date(Date.UTC(2026, 10, 25, 12, 0, seq++)).toISOString()
  const notFound = { success: false as const, error: 'Record not found' }

  const tools = {
    async create(collection: string, data: Record<string, unknown>, recordId?: string) {
      const id = recordId ?? `r${seq++}`
      if (col(collection).has(id)) return { success: false as const, error: 'Duplicate' }
      const t = now()
      col(collection).set(id, { recordId: id, data: { ...data }, createdBy: actingAs, createdAt: t, updatedAt: t })
      return { success: true as const, data: { recordId: id } }
    },
    async update(collection: string, recordId: string, data: Record<string, unknown>) {
      const row = col(collection).get(recordId)
      if (!row) return notFound
      row.data = { ...row.data, ...data }
      row.updatedAt = now()
      return { success: true as const, data: { recordId } }
    },
    async remove(collection: string, recordId: string) {
      return col(collection).delete(recordId) ? { success: true as const, data: { recordId } } : notFound
    },
    async get(collection: string, recordId: string) {
      const row = col(collection).get(recordId)
      return row ? { success: true as const, data: { record: structuredClone(row) } } : notFound
    },
    async query(collection: string, options: { where?: Record<string, unknown>; limit?: number } = {}) {
      const rows = [...col(collection).values()].filter((r) =>
        Object.entries(options.where ?? {}).every(([k, v]) => (k === 'createdBy' ? r.createdBy : r.data[k]) === v),
      )
      const limited = rows.slice(0, options.limit ?? 100)
      return { success: true as const, data: { records: structuredClone(limited), count: rows.length } }
    },
    async deleteWhere() {
      return { success: true as const, data: { deleted: 0 } }
    },
    async integration() {
      return { success: false as const, error: 'no integrations in unit tests' }
    },
    async registerUser() {
      return { success: true as const, data: {} }
    },
  }
  return { tools: tools as unknown as ActionTools, store, as: (user: string) => fakeTools(user, store) }
}
