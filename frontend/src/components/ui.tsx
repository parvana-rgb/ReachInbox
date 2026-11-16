import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EmailStatus } from '../types';

const STATUS: Record<EmailStatus, { label: string; cls: string; dot: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-wait-50 text-wait', dot: 'bg-wait' },
  processing: { label: 'Sending', cls: 'bg-signal-50 text-signal', dot: 'bg-signal animate-pulse' },
  sent: { label: 'Sent', cls: 'bg-sent-50 text-sent', dot: 'bg-sent' },
  failed: { label: 'Failed', cls: 'bg-stamp-50 text-stamp', dot: 'bg-stamp' },
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 max-w-xl text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <tbody aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-t border-ink-100">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-3.5"><div className="h-4 animate-pulse rounded bg-ink-100" style={{ width: `${55 + ((r * 7 + c * 13) % 35)}%` }} /></td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-paper p-3 text-ink-300"><Inbox size={22} /></div>
      <p className="font-display text-lg font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-stamp-50 p-3 text-stamp"><AlertTriangle size={22} /></div>
      <p className="font-display text-lg font-semibold">Could not load this data</p>
      <p className="mt-1 max-w-md text-sm text-ink-500">{message}</p>
      {onRetry && <button className="btn-secondary mt-4" onClick={onRetry}><RotateCw size={15} />Try again</button>}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={16} aria-hidden />;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-sm text-ink-500">
      <span>{total === 0 ? 'No results' : `${from}–${to} of ${total.toLocaleString()}`}</span>
      <div className="flex items-center gap-1">
        <button className="btn-secondary px-2.5 py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
        <span className="px-2 tabular-nums">Page {page} of {pages}</span>
        <button className="btn-secondary px-2.5 py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
