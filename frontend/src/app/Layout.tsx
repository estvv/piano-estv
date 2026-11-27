import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from './auth';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-2 sm:px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
    isActive ? 'text-neutral-900 bg-neutral-100' : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
  }`;

// Pages around the piano: a way back to it, and to each other.
export function Layout() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <Link
            to="/"
            className="mr-1 inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50 sm:mr-3"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
            Piano
          </Link>
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <NavLink to="/reglages" className={navClass}>Réglages</NavLink>
            <NavLink to="/compte" className={navClass}>Mon compte</NavLink>
            {user?.is_admin && <NavLink to="/admin" className={navClass}>Comptes</NavLink>}
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
