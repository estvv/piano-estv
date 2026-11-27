import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import { config } from '../config.js';
import { AiError, post } from './reading.js';

// A piano teacher, asked by the player: what went wrong in a take, which fingers,
// or anything else. Only what the player sends is passed on, when asked.

const GEMINI = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash'];
const MISTRAL = ['mistral-large-4-0', 'mistral-large-2512', 'mistral-small-2506', 'mistral-small-latest', 'ministral-14b-latest'];
const TIMEOUT = 60_000;
const pace = { pause: 1500 };

export const coachBody = z.object({
  // What the piece is and what was played, written by the app.
  context: z.string().max(20_000),
  messages: z.array(z.object({ role: z.enum(['user', 'coach']), text: z.string().trim().min(1).max(4000) })).min(1).max(30)
    .refine((m) => m[m.length - 1]?.role === 'user', { message: 'La dernière question manque' }),
});
export type CoachRequest = z.infer<typeof coachBody>;
export type Coach = (request: CoachRequest) => Promise<string>;

export const COACH_PROMPT = `Tu es un professeur de piano bienveillant et concret, qui parle à un élève autodidacte qui apprend surtout des morceaux de rap et de pop, souvent en chiffres (chaque touche a un numéro).
Réponds en français, tutoie, va droit au but : quelques phrases ou une courte liste, pas de longue introduction.
- Pour une prise : dis ce qui coince le plus (où, quelle main, quelles notes), pourquoi c'est probablement difficile, et un exercice précis pour le travailler (tempo, boucle, main seule…).
- Pour un doigté : donne les doigts (1 = pouce … 5 = auriculaire) note par note pour chaque main, et explique les passages de pouce ou les changements de position.
- Pour le reste : réponds à la question en restant concret.
Les noms de notes sont en français avec l'octave (Do4 = do central). Ne t'appuie que sur les informations données ; si une chose manque, dis-le en une phrase.`;

type Turn = CoachRequest['messages'][number];

async function gemini(context: string, messages: Turn[]): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT);
  let busy = false;
  for (const model of config.geminiModel ? [config.geminiModel] : GEMINI) {
    const { status, body } = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': config.geminiApiKey },
      {
        systemInstruction: { parts: [{ text: `${COACH_PROMPT}\n\n${context}` }] },
        contents: messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
      },
      signal,
    );
    const b = (body ?? {}) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; error?: { message?: string } };
    if (status === 200) {
      const text = b.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
      if (text) return text;
      throw new AiError('réponse vide');
    }
    if (status === 401 || status === 403 || /api key/i.test(b.error?.message ?? '')) throw new AiError('clé refusée');
    if (status === 429 || status >= 500) busy = true;
    else if (status !== 404) throw new AiError(`demande refusée (${status})`);
  }
  throw new AiError(busy ? 'quota atteint ou service surchargé, réessaie plus tard' : 'aucun modèle disponible');
}

async function mistral(context: string, messages: Turn[]): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT);
  let busy = false;
  for (const [i, model] of (config.mistralVisionModel ? [config.mistralVisionModel] : MISTRAL).entries()) {
    if (i > 0) await wait(pace.pause);
    const { status, body } = await post('https://api.mistral.ai/v1/chat/completions', { Authorization: `Bearer ${config.mistralApiKey}` }, {
      model,
      messages: [{ role: 'system', content: `${COACH_PROMPT}\n\n${context}` }, ...messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))],
    }, signal);
    const b = (body ?? {}) as { choices?: { message?: { content?: unknown } }[]; type?: string };
    if (status === 200) {
      const content = b.choices?.[0]?.message?.content;
      const text = (Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? '').join('') : String(content ?? '')).trim();
      if (text) return text;
      throw new AiError('réponse vide');
    }
    if (status === 401) throw new AiError('clé refusée');
    if (status === 429 || status >= 500) busy = true;
    else if (!(status === 403 || status === 400 || status === 404)) throw new AiError(`demande refusée (${status})`);
  }
  throw new AiError(busy ? 'trop de demandes, réessaie dans une minute' : 'aucun modèle disponible avec cet abonnement');
}

export const askCoach: Coach = async ({ context, messages }) => {
  const askers: [string, typeof gemini][] = [];
  if (config.geminiApiKey) askers.push(['Gemini', gemini]);
  if (config.mistralApiKey) askers.push(['Mistral', mistral]);
  if (!askers.length) throw new AiError('L’IA n’est pas configurée sur ce serveur');
  const why: string[] = [];
  for (const [name, ask] of askers) {
    try {
      return await ask(context, messages);
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      why.push(`${name} : ${e.message}`);
    }
  }
  throw new AiError(`Le coach ne répond pas. ${why.join('. ')}.`);
};

export { pace as coachPace };
