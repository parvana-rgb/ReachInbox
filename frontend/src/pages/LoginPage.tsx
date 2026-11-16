import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { AlertCircle, CalendarClock, Gauge, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { urls } from '../services/api';
import { Logo } from '../layouts/AppLayout';
import { Spinner } from '../components/ui';

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.5 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

export default function LoginPage() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const [redirecting, setRedirecting] = useState(false);
  const error = params.get('error') ?? (location.state as { error?: string } | null)?.error ?? null;

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col justify-between bg-ink px-8 py-10 text-white sm:px-14">
        <Logo light />
        <div className="my-12 max-w-lg">
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">Send outreach on your schedule, not your server’s.</h1>
          <p className="mt-5 text-lg text-ink-300">Queue thousands of emails, space them out, cap them per hour, and get a Slack message the moment a sender hits its limit.</p>
          <ul className="mt-10 space-y-4 text-sm">
            <li className="flex gap-3"><CalendarClock className="mt-0.5 shrink-0 text-ink-300" size={18} />Scheduled jobs survive restarts and never send twice.</li>
            <li className="flex gap-3"><Gauge className="mt-0.5 shrink-0 text-ink-300" size={18} />Hourly limits per sender. Extra emails wait for the next hour instead of being dropped.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-ink-300" size={18} />Your emails and Slack connection are visible only to you.</li>
          </ul>
        </div>
        <p className="text-xs text-ink-300">ReachInbox email scheduler</p>
      </section>

      <section className="grid place-items-center px-6 py-12">
        <div className="card w-full max-w-md overflow-hidden">
          <div className="airmail h-2" aria-hidden />
          <div className="p-8">
            <h2 className="text-2xl font-bold">Sign in</h2>
            <p className="mt-1 text-sm text-ink-500">Use your Google account to continue.</p>
            {error && (
              <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-stamp/30 bg-stamp-50 p-3 text-sm text-stamp"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>
            )}
            <a href={urls.googleLogin} onClick={() => setRedirecting(true)} aria-disabled={redirecting}
              className="btn-secondary mt-6 w-full gap-3 py-3 text-base">
              {redirecting ? <Spinner /> : <GoogleG />}{redirecting ? 'Redirecting to Google…' : 'Continue with Google'}
            </a>
            <p className="mt-6 text-xs text-ink-500">We only read your name, email address and profile photo.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
