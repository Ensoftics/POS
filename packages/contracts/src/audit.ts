import { z } from 'zod';
import { isoDateTimeSchema, pageSchema, paginationQuerySchema, uuidSchema } from './common';

export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  action: z.string(),
  actorUserId: uuidSchema.nullable(),
  actorName: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const listAuditLogsQuerySchema = paginationQuerySchema;
export const auditLogPageSchema = pageSchema(auditLogEntrySchema);
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;
