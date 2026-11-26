/**
 * Spend controls — written only by server actions, readable only by admins.
 *
 * provider_usage:   one row per provider per month (id `provider:YYYY-MM`).
 *                   Keying by period means counters "reset" on their own — no cron.
 * generation_usage: one row per user per UTC day (id `userId:YYYY-MM-DD`),
 *                   counting public AND private-chat generations.
 */

import type { CollectionSchema } from 'deepspace/schema'

const adminOnly = {
  '*': { read: false, create: false, update: false, delete: false },
  viewer: { read: false, create: false, update: false, delete: false },
  member: { read: false, create: false, update: false, delete: false },
  admin: { read: true, create: false, update: false, delete: false },
} as const

export const providerUsageSchema: CollectionSchema = {
  name: 'provider_usage',
  columns: [
    { name: 'provider', storage: 'text', interpretation: 'plain', required: true },
    { name: 'period', storage: 'text', interpretation: 'plain', required: true },
    { name: 'count', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  permissions: { ...adminOnly },
}

export const generationUsageSchema: CollectionSchema = {
  name: 'generation_usage',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'day', storage: 'text', interpretation: 'plain', required: true },
    { name: 'count', storage: 'number', interpretation: 'plain', default: 0 },
  ],
  permissions: { ...adminOnly },
}
