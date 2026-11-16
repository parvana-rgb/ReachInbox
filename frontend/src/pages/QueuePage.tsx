import { ExternalLink } from 'lucide-react';
import { api, urls } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { EmptyState, ErrorState, PageHeader } from '../components/ui';
import { formatDateTimeSec, formatNumber } from '../utils/format';

const LABELS: [keyof import('../types').QueueStats['counts'], string, string][] = [
  ['waiting', 'Waiting', 'Ready to run now'], ['delayed', 'Delayed', 'Waiting for their send time'], ['active', 'Active', 'Being sent right now'],
  ['completed', 'Completed', 'Finished (kept for 24h)'], ['failed', 'Failed', 'Gave up after retries'],
];

export default function QueuePage() {
  const q = useRemote(() => api.queueStats(), [], 3000);
  const ev = useRemote(() => api.rateLimitEvents(), [], 5000);
  return (
    <>
      <PageHeader title="Queue monitoring" subtitle="Live counts from the BullMQ email queue in Redis."
        action={<a className="btn-primary" href={urls.bullBoard} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open Bull Board</a>} />
      {q.error ? <div className="card"><ErrorState message={q.error} onRetry={() => void q.reload()} /></div> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {LABELS.map(([k, label, hint]) => (
            <div key={k} className="card p-4">
              <p className="text-sm text-ink-500">{label}</p>
              {q.loading || !q.data ? <div className="mt-2 h-9 w-16 animate-pulse rounded bg-ink-100" /> : <p className={`mt-1 font-display text-3xl font-bold tabular-nums ${k === 'failed' && q.data.counts[k] > 0 ? 'text-stamp' : ''}`}>{formatNumber(q.data.counts[k])}</p>}
              <p className="mt-1 text-xs text-ink-500">{hint}</p>
            </div>
          ))}
        </div>
      )}
      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4"><h2 className="text-lg font-semibold">Rate limit events</h2><p className="text-sm text-ink-500">Each time a sender reached its hourly limit.</p></div>
        {ev.error ? <ErrorState message={ev.error} onRetry={() => void ev.reload()} />
          : ev.loading ? <div className="h-24 animate-pulse bg-paper-50" aria-busy="true" />
          : ev.data?.length === 0 ? <EmptyState title="No limits reached" hint="When a sender hits its hourly limit, it is listed here and sent to Slack." />
          : (
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-paper-50 text-xs text-ink-500"><tr><th className="px-4 py-3 font-medium">Sender</th><th className="px-4 py-3 font-medium">Limit</th><th className="px-4 py-3 font-medium">Resumes</th><th className="px-4 py-3 font-medium">Slack</th></tr></thead>
              <tbody>{ev.data?.map((e) => (
                <tr key={e.id} className="border-t border-ink-100"><td className="px-4 py-3">{e.senderEmail}</td><td className="px-4 py-3">{e.limit}/hour</td><td className="px-4 py-3">{formatDateTimeSec(e.nextAvailableAt)}</td><td className="px-4 py-3 capitalize">{e.notificationStatus.replace(/_/g, ' ')}</td></tr>))}</tbody>
            </table></div>)}
      </section>
    </>
  );
}
