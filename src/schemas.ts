/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { publicImagesSchema } from './schemas/images-schema'
import { generationUsageSchema, providerUsageSchema } from './schemas/usage-schema'
import { imageReactionsSchema } from './schemas/reactions-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  publicImagesSchema,
  providerUsageSchema,
  generationUsageSchema,
  imageReactionsSchema,
]
