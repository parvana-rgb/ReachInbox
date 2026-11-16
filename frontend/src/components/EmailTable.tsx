import { ExternalLink, Shuffle } from 'lucide-react';
import type { EmailItem } from '../types';
import { formatDateTime } from '../utils/format';
import { EmptyState, ErrorState, Pagination, SkeletonRows, StatusBadge } from './ui';
import type { ReactNode } from 'react';

interface Props {
  kind: 'scheduled' | 'sent';
  items: EmailItem[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  page: number; pageSize: number; total: number; onPage: (p: number) => void;
  empty: { title: string; hint: string; action?: ReactNode };
}

export function EmailTable({ kind, items, loading, error, onRetry, page, pageSize, total, onPage, empty }: Props) {
  const timeLabel = kind === 'scheduled' ? 'Scheduled time' : 'Sent time';
  return (
    <div className="card overflow-hidden">
      {error ? <ErrorState message={error} onRetry={onRetry} /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper-50 text-xs font-medium text-ink-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">{timeLabel}</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              {loading ? <SkeletonRows /> : (
                <tbody>
                  {items?.map((e) => (
                    <tr key={e.id} className="border-t border-ink-100 align-top hover:bg-paper-50">
                      <td className="px-4 py-3.5 font-medium">{e.toEmail}<div className="text-xs font-normal text-ink-500">from {e.senderEmail}</div></td>
                      <td className="max-w-[260px] truncate px-4 py-3.5 text-ink-700" title={e.subject}>{e.subject}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-ink-700">
                        {formatDateTime(kind === 'scheduled' ? e.sendAt : e.sentAt ?? e.sendAt)}
                        {kind === 'scheduled' && e.rescheduleCount > 0 && (
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-wait" title="Moved to the next hour because the hourly limit was reached"><Shuffle size={12} />Moved by rate limit</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={e.status} />
                        {e.status === 'failed' && e.lastError && <div className="mt-1 max-w-[220px] text-xs text-stamp">{e.lastError}</div>}
                        {e.status === 'sent' && e.previewUrl && (
                          <a href={e.previewUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs text-signal hover:underline">Preview on Ethereal <ExternalLink size={11} /></a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {!loading && items?.length === 0 && <EmptyState {...empty} />}
          <Pagination page={page} pageSize={pageSize} total={total} onPage={onPage} />
        </>
      )}
    </div>
  );
}
