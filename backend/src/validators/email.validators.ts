import { z } from 'zod';

const FIVE_MIN = 5 * 60 * 1000;
const ONE_YEAR = 365 * 24 * 3600 * 1000;

export const scheduleSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  body: z.string().trim().min(1, 'Body is required').max(100_000),
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).min(1, 'At least one recipient is required').max(5000, 'At most 5000 recipients per batch'),
  startAt: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Invalid start time')
    .refine((d) => d.getTime() >= Date.now() - FIVE_MIN, 'Start time must not be in the past')
    .refine((d) => d.getTime() <= Date.now() + ONE_YEAR, 'Start time must be within one year'),
  delaySeconds: z.coerce.number().int().min(0).max(86_400),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(200).optional(),
  status: z.enum(['scheduled', 'processing', 'sent', 'failed']).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
