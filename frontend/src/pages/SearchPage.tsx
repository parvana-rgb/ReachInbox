import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../services/api';
import { useDebounce } from '../hooks/useDebounce';
import { useRemote } from '../hooks/useRemote';
import { EmailTable } from '../components/EmailTable';
import { PageHeader } from '../components/ui';
import type { EmailStatus } from '../types';

const PAGE_SIZE = 10;

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<EmailStatus | ''>('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  useEffect(() => setPage(1), [dq, status]);

  const { data, loading, error, reload } = useRemote(
    () => api.search({ page, pageSize: PAGE_SIZE, q: dq || undefined, status: status || undefined }), [page, dq, status]);

  return (
    <>
      <PageHeader title="Search" subtitle="Find any email by recipient, subject, body text or status." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input autoFocus className="input pl-9" placeholder="e.g. john@, pricing, failed" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search emails" />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as EmailStatus | '')} aria-label="Filter by status">
          <option value="">Any status</option><option value="scheduled">Scheduled</option><option value="processing">Sending</option><option value="sent">Sent</option><option value="failed">Failed</option>
        </select>
      </div>
      <EmailTable kind="sent" items={data?.items} loading={loading} error={error} onRetry={() => void reload()}
        page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage}
        empty={{ title: dq || status ? 'No emails match' : 'No emails yet', hint: dq || status ? 'Try fewer words, or part of an address.' : 'Schedule an email and it will be searchable here.' }} />
      {data?.source && (
        <p className="mt-3 text-xs text-ink-500">Results from {data.source === 'elasticsearch' ? 'Elasticsearch' : 'the database (Elasticsearch is unavailable or disabled)'}.</p>
      )}
    </>
  );
}
