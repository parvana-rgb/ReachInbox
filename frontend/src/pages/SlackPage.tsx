import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, MessageSquare, PlugZap, RefreshCw, Send, Unplug } from 'lucide-react';
import { api, errorMessage, urls } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { ErrorState, PageHeader, Spinner } from '../components/ui';
import { formatDateTime } from '../utils/format';

export default function SlackPage() {
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useRemote(() => api.slackStatus(), []);
  const [busy, setBusy] = useState<'test' | 'disconnect' | null>(null);

  useEffect(() => {
    if (params.get('connected')) toast.success('Slack connected');
    const err = params.get('error');
    if (err) toast.error(err);
    if (params.get('connected') || err) setParams({}, { replace: true });
  }, [params, setParams]);

  async function run(kind: 'test' | 'disconnect') {
    if (kind === 'disconnect' && !window.confirm('Disconnect Slack? You will stop receiving rate-limit alerts.')) return;
    setBusy(kind);
    try {
      if (kind === 'test') { await api.slackTest(); toast.success('Test message sent. Check Slack.'); }
      else { await api.slackDisconnect(); toast.success('Slack disconnected'); await reload(); }
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Slack integration" subtitle="Get a Slack message when a sender reaches its hourly limit, with the time sending resumes." />
      <div className="card max-w-2xl p-6">
        {error ? <ErrorState message={error} onRetry={() => void reload()} />
          : loading || !data ? <div className="h-24 animate-pulse rounded bg-ink-100" aria-busy="true" />
          : (
            <>
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-paper text-ink-700"><MessageSquare size={22} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">Slack</h2>
                    {data.connected
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-sent-50 px-2.5 py-1 text-xs font-medium text-sent"><CheckCircle2 size={12} />Connected</span>
                      : <span className="rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink-500">Not connected</span>}
                  </div>
                  {data.connected && data.workspace ? (
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex gap-2"><dt className="w-24 text-ink-500">Workspace</dt><dd className="font-medium">{data.workspace.name}</dd></div>
                      <div className="flex gap-2"><dt className="w-24 text-ink-500">Delivers to</dt><dd>{data.channel}</dd></div>
                      <div className="flex gap-2"><dt className="w-24 text-ink-500">Connected</dt><dd>{formatDateTime(data.connectedAt)}</dd></div>
                    </dl>
                  ) : <p className="mt-2 text-sm text-ink-500">Connect your workspace to receive alerts. ReachInbox only asks for permission to post messages.</p>}
                </div>
              </div>

              {!data.configured && (
                <p role="alert" className="mt-5 rounded-lg bg-wait-50 p-3 text-sm text-wait">Slack is not set up on the server yet. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to the backend .env file (see the README), then restart the backend.</p>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                {!data.connected
                  ? <a href={urls.slackConnect} className={`btn-primary ${data.configured ? '' : 'pointer-events-none opacity-50'}`} aria-disabled={!data.configured}><PlugZap size={16} />Connect Slack</a>
                  : (<>
                      <button className="btn-secondary" onClick={() => void run('test')} disabled={busy !== null}>{busy === 'test' ? <Spinner /> : <Send size={15} />}Send test message</button>
                      <a href={urls.slackConnect} className="btn-secondary"><RefreshCw size={15} />Reconnect</a>
                      <button className="btn-danger" onClick={() => void run('disconnect')} disabled={busy !== null}>{busy === 'disconnect' ? <Spinner /> : <Unplug size={15} />}Disconnect</button>
                    </>)}
              </div>
            </>
          )}
      </div>
    </>
  );
}
