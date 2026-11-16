import { useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { Activity, Clock, LayoutDashboard, LogOut, Menu, MessageSquare, PenLine, Search, Send, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { initials } from '../utils/format';
import { Spinner } from '../components/ui';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/scheduled', label: 'Scheduled Emails', icon: Clock },
  { to: '/sent', label: 'Sent Emails', icon: Send },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/slack', label: 'Slack Integration', icon: MessageSquare },
  { to: '/queue', label: 'Queue Monitoring', icon: Activity },
];

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-signal text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M3 7l9 6 9-6M3 7v11h18V7z" /></svg>
      </span>
      <span className={`font-display text-lg font-bold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>ReachInbox</span>
    </div>
  );
}

export default function AppLayout() {
  const { user, loading, serverError, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (loading) return <div className="grid min-h-screen place-items-center text-ink-500"><Spinner className="mr-2" />Loading your workspace…</div>;
  if (!user) return <Navigate to="/login" replace state={serverError ? { error: serverError } : undefined} />;

  const Sidebar = (
    <nav className="flex h-full flex-col bg-ink px-3 py-5 text-white" aria-label="Main">
      <div className="px-2"><Logo light /></div>
      <NavLink to="/compose" onClick={() => setOpen(false)} className="btn-primary mt-6 w-full"><PenLine size={16} />Compose New Email</NavLink>
      <ul className="mt-6 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-white/12 font-medium text-white' : 'text-ink-300 hover:bg-white/8 hover:text-white'}`}>
              <Icon size={17} />{label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden lg:block"><div className="sticky top-0 h-screen">{Sidebar}</div></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">{Sidebar}</div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-100 bg-white/90 px-4 py-3 backdrop-blur sm:px-8">
          <button className="btn-secondary px-2.5 py-2 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle navigation">{open ? <X size={18} /> : <Menu size={18} />}</button>
          <div className="lg:hidden"><Logo /></div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{user.name}</p>
              <p className="text-xs text-ink-500">{user.email}</p>
            </div>
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full border border-ink-100 object-cover" />
              : <span className="grid h-9 w-9 place-items-center rounded-full bg-signal-50 text-sm font-semibold text-signal">{initials(user.name)}</span>}
            <button className="btn-secondary" onClick={async () => { await logout(); navigate('/login'); }}><LogOut size={15} /><span className="hidden sm:inline">Log out</span></button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><Outlet /></main>
      </div>
    </div>
  );
}
