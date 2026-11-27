import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../app/auth';
import { Avatar } from '../components/Avatar';
import { Field, inputClass } from '../components/Field';
import { ChevronDownIcon, LockIcon } from '../components/icons';
import { ErrorText, Page, panel, primaryButton } from '../components/ui';
import { api } from '../lib/api';

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/connexion" replace />;

  return (
    <Page>
      <div className="mb-8">
        <PhotoPicker />
      </div>

      <DisplayNameSection />

      {/* Rarely needed: folded away. */}
      <details className={`${panel} group mt-6`}>
        <summary className="flex cursor-pointer list-none select-none items-center gap-3 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600"><LockIcon className="h-4 w-4" /></span>
          <span className="flex-1">
            <span className="block font-semibold text-neutral-900">Mot de passe</span>
            <span className="block text-xs text-neutral-500">Changer le mot de passe de connexion</span>
          </span>
          <ChevronDownIcon className="h-5 w-5 text-neutral-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="max-w-md px-5 pb-5 pt-1">
          <PasswordForm />
        </div>
      </details>
    </Page>
  );
}

function DisplayNameSection() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user!.display_name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/auth/profile', { method: 'PATCH', json: { display_name: name.trim() } });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${panel} p-5`}>
      <h2 className="mb-4 font-semibold text-neutral-900">Présentation</h2>
      <form onSubmit={submit} className="max-w-md space-y-4">
        <Field label="Nom affiché" hint={`Affiché dans le menu. Identifiant de connexion : ${user!.username}`}>
          <input value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setSaved(false); }} className={inputClass} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || !name.trim() || name.trim() === user!.display_name} className={primaryButton}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {saved && <span className="text-sm text-emerald-700">Enregistré.</span>}
        </div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    if (next.length < 8) return setError('Le nouveau mot de passe doit faire au moins 8 caractères.');
    if (next !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setSaving(true);
    try {
      await api('/auth/password', { method: 'POST', json: { current, next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Mot de passe actuel">
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Nouveau mot de passe" hint="8 caractères minimum">
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Confirmation">
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <button type="submit" disabled={saving || !current || !next} className={primaryButton}>
        {saving ? 'Enregistrement…' : 'Changer le mot de passe'}
      </button>
      {done && <p className="text-sm text-emerald-700">Mot de passe changé. Tes autres sessions ont été déconnectées.</p>}
    </form>
  );
}

const THUMB = 256;

// Centre-crops the picked image to a square and shrinks it to 256 px, so the
// upload stays a few dozen KB whatever the original was.
async function squareThumbnail(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB;
  canvas.height = THUMB;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, THUMB, THUMB);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode('image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg');
  if (!blob) throw new Error('Impossible de lire l’image');
  return blob;
}

function PhotoPicker() {
  const { user, refresh } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Choisis une image (JPEG, PNG, WebP…).');
    void run(async () => {
      const blob = await squareThumbnail(file);
      await api('/auth/avatar', { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
    });
  };

  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => input.current?.click()} disabled={busy} title="Changer la photo" className="group relative rounded-full">
        <Avatar url={user.avatar_url} name={user.display_name} size="lg" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-[10px] font-semibold text-[#fff] opacity-0 transition-opacity group-hover:opacity-100">
          {busy ? '…' : 'Changer'}
        </span>
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold text-neutral-900 md:text-3xl">{user.display_name}</h1>
        <p className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="font-medium text-neutral-500">@{user.username}</span>
          {user.is_admin && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">Admin</span>}
        </p>
        {user.avatar_url && (
          <button type="button" onClick={() => void run(() => api('/auth/avatar', { method: 'DELETE' }))} disabled={busy} className="mt-1 text-xs font-medium text-neutral-500 hover:text-red-600">
            Retirer la photo
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <input ref={input} type="file" accept="image/*" onChange={onFile} className="hidden" />
    </div>
  );
}
