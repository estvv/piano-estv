import { aiReadingSchema, type AiReading } from '@piano/shared';

// What every AI is asked, and what is made of its answer.

// Shown to the user as they are.
export class AiError extends Error {}

export type ImageReader = (images: string[]) => Promise<AiReading>;

export interface Answer {
  status: number;
  body: unknown;
}

// Of a whole reading, whatever the number of models tried.
export const TIMEOUT = 110_000;

export async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Answer> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    throw new AiError('l’IA n’a pas répondu');
  }
}

export const ASK = 'Lis ces images.';
export const PROMPT = `Tu lis des images liées au piano et tu réponds uniquement par un objet JSON.

Cas 1 — des NUMÉROS de touches, écrits pour apprendre un morceau (notes personnelles, capture de vidéo, « gauche 3-5-7 2-4-6 / droite 4-4 6-2-5-3 », lignes « G : » et « D : »).
{"kind":"numbers","title":"","parts":[{"label":"A","aligned":true,"left":["1","","3"],"right":["4","4","6"]}]}
- Une partie par bloc ou par section distincte, dans l'ordre. "label" : le nom écrit, sinon A, B, C…
- "left" : main gauche (G, gauche, LH). "right" : main droite (D, droite, RH). Une seule suite sans indication de main : "right".
- Chaque entrée est un moment : un numéro, ou plusieurs joués ensemble avec + ("1+3").
- Si les deux mains sont écrites l'une au-dessus de l'autre en colonnes : "aligned": true, les deux listes ont la même longueur, "" quand une main ne joue pas à ce moment. Des chiffres l'un au-dessus de l'autre sont le même moment.
- Sinon "aligned": false, chaque main avec sa propre suite, sans "".
- Recopie exactement les numéros, y compris 0. Les tirets et les espaces séparent.

Cas 2 — une PARTITION (portées).
{"kind":"score","title":"","bpm":120,"measures":[{"right":[{"notes":["D5","F5"],"beats":1}],"left":[{"notes":[],"beats":2}]}]}
- Une entrée par mesure, dans l'ordre, reprises non déroulées. "right" : portée du haut, "left" : portée du bas.
- "notes" : noms anglais avec octave (do central = C4), altérations de l'armure et de la mesure appliquées : "F#4", "Bb3". Liste vide = silence. Accord = plusieurs notes.
- "beats" : durée en noires (croche 0.5, noire pointée 1.5). La somme de chaque main fait la durée de la mesure.
- Une note liée à la précédente n'est pas répétée : allonge la première, et mets un silence à sa place.
- "bpm" : tempo à la noire s'il est écrit, sinon null.

Cas 3 — ni l'un ni l'autre, ou illisible : {"kind":"nothing","reason":"en une phrase, en français"}

Plusieurs images sont la suite l'une de l'autre. N'invente rien : en cas de doute sur un symbole, mets ce qui est le plus probable ; si tout est illisible, cas 3.`;

// The content is text, or pieces of text.
export function parseReading(content: unknown): AiReading {
  const text = Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? '').join('') : String(content ?? '');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new AiError('réponse incomplète, réessaie avec une image plus petite ou plus nette');
  }
  const parsed = aiReadingSchema.safeParse(value);
  if (!parsed.success) console.error('IA, réponse inutilisable :', parsed.error.issues.slice(0, 3));
  if (!parsed.success) throw new AiError('réponse inutilisable, réessaie avec une image plus nette');
  return parsed.data;
}
