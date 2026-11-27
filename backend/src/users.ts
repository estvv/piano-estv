// SQL bits and helpers shared by auth, admin and profile routes.

// Needs `users` aliased `u`. Versioned so browsers can cache the image forever.
export const AVATAR_URL_SQL = `CASE WHEN u.avatar_updated_at IS NOT NULL
  THEN '/api/users/' || u.id || '/avatar?v=' || u.avatar_updated_at ELSE NULL END`;

export const USER_FIELDS_SQL = `u.id, u.username, COALESCE(u.display_name, u.username) AS display_name,
  u.is_admin, ${AVATAR_URL_SQL} AS avatar_url`;

export interface PublicUser {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  avatar_url: string | null;
}

export function toPublicUser(row: Record<string, unknown>): PublicUser {
  return {
    id: row.id as number,
    username: row.username as string,
    display_name: row.display_name as string,
    is_admin: !!row.is_admin,
    avatar_url: (row.avatar_url as string | null) ?? null,
  };
}

export const MAX_AVATAR_BYTES = 300 * 1024;

// The client sends a square WebP/JPEG thumbnail; the type is checked from the
// bytes, not trusted from the header.
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export const usernameRule = /^[a-zA-Z0-9_.-]{2,32}$/;
