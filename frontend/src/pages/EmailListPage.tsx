import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PenLine, Search } from 'lucide-react';
import { api } from '../services/api';
import { useDebounce } from '../hooks/useDebounce';
import { useRemote } from '../hooks/useRemote';
import { EmailTable } from '../components/EmailTable';
import { PageHeader } from '../components/ui';
import type { EmailStatus } from '../types';

const PAGE_SIZE = 10;

export default function EmailListPage({ kind }: { kind: 'scheduled' | 'sent' }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<EmailStatus | ''>('');
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, status]);

  const { data, loading, error, reload } = useRemote(
    () => (kind === 'scheduled' ? api.scheduled : api.sent)({ page, pageSize: PAGE_SIZE, q: dq || undefined, status: status || undefined }),
    [kind, page, dq, status], 8000);

  const sent = kind === 'sent';
  return (
    <>
      <PageHeader
        title={sent ? 'Sent emails' : 'Scheduled emails'}
        subtitle={sent ? 'Everything that has been delivered to the mail server, and anything that failed.' : 'Emails waiting for their send time. This list refreshes automatically.'}
        action={<Link to="/compose" className="btn-primary"><PenLine size={16} />Compose New Email</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input className="input pl-9" placeholder="Search recipient or subject" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        {sent && (
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as EmailStatus | '')} aria-label="Filter by status">
            <option value="">All results</option><option value="sent">Sent</option><option value="failed">Failed</option>
          </select>
        )}
      </div>
      <EmailTable kind={kind} items={data?.items} loading={loading} error={error} onRetry={() => void reload()}
        page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage}
        empty={dq || status
          ? { title: 'No emails match', hint: 'Try a different search term or clear the filter.' }
          : sent
            ? { title: 'Nothing sent yet', hint: 'Emails appear here once their scheduled time arrives.', action: <Link to="/scheduled" className="btn-secondary">View scheduled emails</Link> }
            : { title: 'No scheduled emails', hint: 'Upload a list of leads and pick a start time to schedule your first campaign.', action: <Link to="/compose" className="btn-primary">Compose New Email</Link> }} />
    </>
  );
}
