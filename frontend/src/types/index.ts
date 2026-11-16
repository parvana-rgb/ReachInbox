export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface User { id: string; email: string; name: string; avatarUrl: string | null }

export interface EmailItem {
  id: string; toEmail: string; subject: string; status: EmailStatus; senderEmail: string;
  scheduledAt: string; sendAt: string; sentAt: string | null; attempts: number; rescheduleCount: number;
  lastError: string | null; messageId: string | null; previewUrl: string | null; createdAt: string;
}
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; source?: 'elasticsearch' | 'database' }

export interface Stats { total: number; pending: number; scheduled: number; processing: number; sent: number; failed: number }
export interface QueueStats { queue: string; counts: { waiting: number; delayed: number; active: number; completed: number; failed: number } }
export interface SlackStatus {
  configured: boolean; connected: boolean; workspace: { id: string; name: string } | null; channel: string | null; connectedAt: string | null;
}
export interface ParsedRecipients {
  fileName: string; valid: string[]; invalid: { value: string; line: number; reason: string }[]; duplicates: number; totalFound: number;
}
export interface ScheduleResult {
  batchId: string; total: number; duplicatesRemoved: number; firstSendAt: string; lastSendAt: string; senders: string[]; hourlyLimit: number; queued: boolean;
}
export interface RateLimitEventItem {
  id: string; senderEmail: string; limit: number; windowStart: string; nextAvailableAt: string; notificationStatus: string; createdAt: string;
}
export interface ScheduleInput {
  subject: string; body: string; recipients: string[]; startAt: string; delaySeconds: number; hourlyLimit: number;
}
