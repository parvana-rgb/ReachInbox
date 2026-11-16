import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { EmptyState, ErrorState, PageHeader } from '../components/ui';
import { StatusBadge } from '../components/ui';
import { formatDateTime, formatNumber } from '../utils/format';
import type { Stats } from '../types';

function Ledger({ s }: { s: Stats }) {
  const cells = [
    { label: 'Total scheduled', value: s.total, hint: 'All emails you have queued', color: 'text-ink' },
    { label: 'Pending', value: s.pending, hint: 'Waiting for their send time', color: 'text-wait' },
    { label: 'Sent', value: s.sent, hint: 'Accepted by the mail server', color: 'text-sent' },
    { label: 'Failed', value: s.failed, hint: 'Rejected after retries', color: 'text-stamp' },
  ];
  const pct = (n: number) => (s.total ? (n / s.total) * 100 : 0);
  return (
    <div className="card overflow-hidden">
      <dl className="grid grid-cols-2 lg:grid-cols-4">
        {cells.map((c, i) => (
          <div key={c.label} className={`p-5 ${i > 0 ? 'lg:border-l' : ''} ${i % 2 === 1 ? 'border-l lg:border-l' : ''} ${i >= 2 ? 'border-t lg:border-t-0' : ''} border-ink-100`}>
            <dt className="text-sm text-ink-500">{c.label}</dt>
            <dd className={`mt-1 font-display text-4xl font-bold tabular-nums ${c.color}`}>{formatNumber(c.value)}</dd>
            <p className="mt-1 text-xs text-ink-500">{c.hint}</p>
          </div>
        ))}
      </dl>
      <div className="flex h-1.5 bg-ink-100" role="img" aria-label={`${s.sent} sent, ${s.pending} pending, ${s.failed} failed`}>
        <div className="bg-sent" style={{ width: `${pct(s.sent)}%` }} />
        <div className="bg-wait" style={{ width: `${pct(s.pending)}%` }} />
        <div className="bg-stamp" style={{ width: `${pct(s.failed)}%` }} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const stats = useRemote(() => api.stats(), [], 5000);
  const next = useRemote(() => api.scheduled({ page: 1, pageSize: 5 }), [], 5000);
  const recent = useRemote(() => api.sent({ page: 1, pageSize: 5 }), [], 5000);
  const events = useRemote(() => api.rateLimitEvents(), [], 10000);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live numbers from your queue. They update every few seconds." />
      {stats.error ? <div className="card"><ErrorState message={stats.error} onRetry={() => void stats.reload()} /></div>
        : stats.loading || !stats.data ? <div className="card h-[132px] animate-pulse" aria-busy="true" /> : <Ledger s={stats.data} />}

      {events.data && events.data.length > 0 && (
        <div className="mt-6 rounded-xl border border-wait/30 bg-wait-50 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-wait"><AlertTriangle size={16} />Hourly limit reached</p>
          <ul className="mt-2 space-y-1 text-ink-700">
            {events.data.slice(0, 3).map((e) => (
              <li key={e.id}>{e.senderEmail} hit {e.limit}/hour. Remaining emails resume {formatDateTime(e.nextAvailableAt)}. Slack: {e.notificationStatus.replace(/_/g, ' ')}.</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {[{ title: 'Up next', r: next, to: '/scheduled', empty: 'Nothing is waiting to be sent.', time: 'sendAt' as const },
          { title: 'Recent activity', r: recent, to: '/sent', empty: 'Nothing has been sent yet.', time: 'sentAt' as const }].map(({ title, r, to, empty, time }) => (
          <section key={title} className="card">
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <h2 className="text-lg font-semibold">{title}</h2>
              <Link to={to} className="flex items-center gap-1 text-sm text-signal hover:underline">View all <ArrowRight size={14} /></Link>
            </div>
            {r.error ? <ErrorState message={r.error} onRetry={() => void r.reload()} />
              : r.loading ? <div className="space-y-3 p-5" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-ink-100" />)}</div>
              : r.data?.items.length === 0 ? <EmptyState title={empty} hint="Compose a new email to get started." action={<Link to="/compose" className="btn-primary">Compose New Email</Link>} />
              : <ul className="divide-y divide-ink-100">{r.data?.items.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{e.toEmail}</p><p className="truncate text-xs text-ink-500">{e.subject} · {formatDateTime(time === 'sendAt' ? e.sendAt : e.sentAt ?? e.sendAt)}</p></div>
                    <StatusBadge status={e.status} />
                  </li>))}</ul>}
          </section>
        ))}
      </div>
    </>
  );
}
