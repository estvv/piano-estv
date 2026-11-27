import { Link } from 'react-router';
import { Avatar } from '../components/Avatar';
import { GearIcon, LogoutIcon, UserIcon } from '../components/icons';
import { Popover } from '../components/Popover';
import { useAuth } from './auth';

const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900';

// Top left of the piano: the account, and the pages around the piano.
export function PianoMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="absolute left-4 top-4 z-10 phone:left-2.5 phone:top-2.5">
      <Popover
        title="Menu"
        align="left"
        width="w-60"
        className="flex items-center rounded-lg border border-neutral-200 bg-white p-1 text-neutral-500 shadow-sm transition-colors hover:text-neutral-900"
        label={<Avatar url={user.avatar_url} name={user.display_name} size="xs" />}
      >
        {(close) => (
          <div className="-m-2">
            <div className="flex items-center gap-2.5 px-2.5 pb-3 pt-1">
              <Avatar url={user.avatar_url} name={user.display_name} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-neutral-900">{user.display_name}</div>
                <div className="truncate text-xs text-neutral-500">@{user.username}</div>
              </div>
            </div>
            <div className="border-t border-neutral-100 pt-1.5">
              <Link to="/reglages" onClick={close} className={item}><GearIcon className="h-4 w-4 text-neutral-400" />Réglages</Link>
              <Link to="/compte" onClick={close} className={item}><UserIcon className="h-4 w-4 text-neutral-400" />Mon compte</Link>
              {user.is_admin && (
                <Link to="/admin" onClick={close} className={item}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-neutral-400" aria-hidden>
                    <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20" />
                  </svg>
                  Comptes
                </Link>
              )}
              <button type="button" onClick={() => void logout()} className={item}><LogoutIcon className="h-4 w-4 text-neutral-400" />Déconnexion</button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
