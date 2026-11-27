import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../app/auth';
import { Avatar } from '../components/Avatar';
import { Field, inputClass } from '../components/Field';
import { PencilIcon, PlusIcon } from '../components/icons';
import { ConfirmModal, Modal } from '../components/Modal';
import { Badge, ErrorText, ghostButton, LoadingState, Page, PageHeader, panel, primaryButton, secondaryButton } from '../components/ui';
import { api } from '../lib/api';

interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  avatar_url: string | null;
  disabled: boolean;
  created_at: number;
  last_activity: number | null;
}

type Patch = Partial<Pick<AdminUser, 'username' | 'display_name' | 'disabled' | 'is_admin'>>;

export function AdminPage() {
  const { user: me, refresh } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api<AdminUser[]>('/admin/users').then(setUsers, (e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  if (!me?.is_admin) return <Navigate to="/" replace />;

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const patch = (u: AdminUser, body: Patch) => act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', json: body }));
  const reset = (u: AdminUser) => act(async () => {
    const { password } = await api<{ password: string }>(`/admin/users/${u.id}/reset`, { method: 'POST' });
    setSecret({ username: u.username, password });
  });

  return (
    <Page width="lg">
      <PageHeader
        title="Comptes"
        subtitle="Chaque compte a ses morceaux, que personne d’autre ne voit."
        actions={<button type="button" onClick={() => setCreating(true)} className={primaryButton}><PlusIcon className="h-4 w-4" />Créer un compte</button>}
      />

      {!users ? <LoadingState /> : (
        <div className={`${panel} md:overflow-x-auto`}>
          {/* On a phone, one block per account instead of a row. */}
          <table className="block w-full text-sm md:table">
            <thead className="hidden md:table-header-group">
              <tr className="border-b border-neutral-100 bg-neutral-50/60 text-left text-neutral-500">
                <th className="px-4 py-2.5 font-medium">Compte</th>
                <th className="px-3 py-2.5 font-medium">Dernière activité</th>
                <th className="px-3 py-2.5 font-medium">État</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="block divide-y md:table-row-group divide-neutral-100">
              {users.map((u) => (
                <tr key={u.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-4 md:table-row ${u.disabled ? 'text-neutral-400' : ''}`}>
                  <td className="w-full md:w-auto md:px-4 md:py-3">
                    <div className="flex items-center gap-3">
                      <Avatar url={u.avatar_url} name={u.display_name} size="sm" />
                      <div>
                        <div className="flex items-center gap-2 font-medium text-neutral-900">
                          {u.display_name}{u.is_admin && <Badge>Admin</Badge>}
                        </div>
                        <div className="text-xs text-neutral-500">{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-neutral-500 md:px-3 md:py-3">{u.last_activity ? relativeDay(u.last_activity) : <span className="text-neutral-300">jamais</span>}</td>
                  <td className="md:px-3 md:py-3">{u.disabled ? <Badge>Désactivé</Badge> : <Badge tone="emerald">Actif</Badge>}</td>
                  <td className="w-full md:w-auto md:px-4 md:py-3">
                    <div className="-mx-3 flex flex-wrap gap-1 whitespace-nowrap md:mx-0 md:flex-nowrap md:justify-end">
                      <button type="button" onClick={() => setEditing(u)} className={ghostButton}>
                        <PencilIcon className="h-3.5 w-3.5" />Modifier
                      </button>
                      {u.id !== me.id && (
                        <>
                          <button type="button" onClick={() => void reset(u)} className={ghostButton}>Réinitialiser</button>
                          <button type="button" onClick={() => void patch(u, { is_admin: !u.is_admin })} className={ghostButton}>
                            {u.is_admin ? 'Retirer admin' : 'Rendre admin'}
                          </button>
                          <button type="button" onClick={() => void patch(u, { disabled: !u.disabled })} className={ghostButton}>
                            {u.disabled ? 'Réactiver' : 'Désactiver'}
                          </button>
                          <button type="button" onClick={() => setRemoving(u)} className={`${ghostButton} text-red-600 hover:text-red-700`}>Supprimer</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2"><ErrorText>{error}</ErrorText></div>

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            await api(`/admin/users/${editing.id}`, { method: 'PATCH', json: body });
            // Renaming oneself also changes the header.
            if (editing.id === me.id) await refresh();
            setEditing(null);
            await load();
          }}
        />
      )}
      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(username, password) => {
            setCreating(false);
            setSecret({ username, password });
            void load();
          }}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Supprimer ${removing.display_name} ?`}
          message="Le compte, ses morceaux et sa pratique seront supprimés définitivement."
          confirmLabel="Supprimer"
          danger
          onConfirm={() => act(() => api(`/admin/users/${removing.id}`, { method: 'DELETE' }))}
          onClose={() => setRemoving(null)}
        />
      )}
      {secret && (
        <Modal title="Identifiants du compte" onClose={() => setSecret(null)}>
          <p className="mb-4 text-sm text-neutral-600">
            Transmets ces identifiants à la personne, en privé. Le mot de passe ne sera plus affiché ; elle pourra le changer dans « Mon compte ».
          </p>
          <div className="select-all space-y-1 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
            <div>Identifiant : <span className="font-semibold">{secret.username}</span></div>
            <div>Mot de passe : <span className="font-mono font-semibold">{secret.password}</span></div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(`${window.location.origin}\nIdentifiant : ${secret.username}\nMot de passe : ${secret.password}`)}
              className={secondaryButton}
            >
              Copier
            </button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

// Login name and display name of any account, the admin's own included.
function EditUserModal({ user, onClose, onSave }: { user: AdminUser; onClose: () => void; onSave: (body: Patch) => Promise<void> }) {
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const changedLogin = username.trim().toLowerCase() !== user.username.toLowerCase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({ username: username.trim(), display_name: displayName.trim() });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal title={`Modifier ${user.display_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Identifiant de connexion" hint="Lettres, chiffres, _ . -">
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} autoFocus />
        </Field>
        <Field label="Nom affiché" hint="Affiché dans le menu.">
          <input value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
        </Field>
        {changedLogin && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            La personne devra se connecter avec « {username.trim()} ». Son mot de passe ne change pas.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
          <button type="submit" disabled={saving || username.trim().length < 2 || !displayName.trim()} className={primaryButton}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (username: string, password: string) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await api<{ username: string; password: string }>('/admin/users', {
        method: 'POST',
        json: { username: username.trim(), display_name: displayName.trim() || undefined, is_admin: isAdmin },
      });
      onCreated(res.username, res.password);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal title="Créer un compte" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Identifiant" hint="Lettres, chiffres, _ . -">
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} autoFocus />
        </Field>
        <Field label="Nom affiché">
          <input value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="accent-neutral-900" />
          Administrateur
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
          <button type="submit" disabled={saving || username.trim().length < 2} className={primaryButton}>Créer</button>
        </div>
      </form>
    </Modal>
  );
}

function relativeDay(ms: number): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(new Date(ms))) / 86_400_000);
  if (diff <= 0) return 'aujourd’hui';
  if (diff === 1) return 'hier';
  if (diff < 7) return `il y a ${diff} jours`;
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
