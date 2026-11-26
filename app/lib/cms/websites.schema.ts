/**
 * Request schemas of the website API.
 *
 * The schemas live outside the route modules because both sides of the service
 * boundary use them: the Vercel proxy rejects obviously invalid payloads
 * before it calls the Worker, and the Worker validates the payload again
 * before it reaches the storage layer. One definition, one set of rules.
 *
 * The tenant is never part of a payload. The schemas are strict, so an unknown
 * field — a `userId` included — is rejected instead of being ignored.
 */

import { z } from 'zod';
import { isValidSlug } from '~/lib/cms/slug';

const slugSchema = z
  .string()
  .trim()
  .refine(isValidSlug, 'A slug must be lowercase characters, digits or single hyphens');

export const websitePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: slugSchema,
    templateId: z.string().trim().min(1).max(200).optional(),
    themeJson: z.string().optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    deployTarget: z.enum(['cloudflare', 'netlify', 'vercel', 'custom', 'zes-cms']).optional(),
    deployConfigJson: z.string().optional(),
  })
  .strict();

export const websitePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    templateId: z.string().trim().min(1).max(200).optional(),
    themeJson: z.string().optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    deployTarget: z.enum(['cloudflare', 'netlify', 'vercel', 'custom', 'zes-cms']).optional(),
    deployConfigJson: z.string().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();
