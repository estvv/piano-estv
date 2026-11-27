import { setTimeout as wait } from 'node:timers/promises';
import { config } from '../config.js';
import { AiError, ASK, parseReading, post, PROMPT, TIMEOUT, type ImageReader } from './reading.js';

// Models that take images, best first: which ones answer depends on the
// subscription. The first one that does is kept.
const MODELS = ['mistral-large-4-0', 'mistral-large-2512', 'mistral-small-2506', 'mistral-small-latest', 'ministral-14b-latest'];
let working: string | null = null;

// The free offer takes one request a second.
export const pace = { pause: 1500, retry: 4000 };

export const mistralReader: ImageReader = async (images) => {
  const signal = AbortSignal.timeout(TIMEOUT);
  const ask = (model: string) => post('https://api.mistral.ai/v1/chat/completions', { Authorization: `Bearer ${config.mistralApiKey}` }, {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: [{ type: 'text', text: ASK }, ...images.map((url) => ({ type: 'image_url', image_url: url }))] },
    ],
  }, signal);

  const models = config.mistralVisionModel ? [config.mistralVisionModel] : working ? [working] : MODELS;
  let busy = false;
  for (const [i, model] of models.entries()) {
    if (i > 0) await wait(pace.pause);
    let { status, body } = await ask(model);
    if (status === 429) {
      await wait(pace.retry);
      ({ status, body } = await ask(model));
    }
    if (status === 200) {
      working = model;
      console.log('Mistral', model, 'a répondu');
      return parseReading((body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content);
    }
    console.error('Mistral', model, status, JSON.stringify(body).slice(0, 300));
    if (status === 401) throw new AiError('clé refusée');
    if (status === 429) busy = true;
    else if (!unavailable(status, body)) throw new AiError(`demande refusée (${status})`);
  }
  working = null;
  throw new AiError(busy ? 'trop de demandes, réessaie dans une minute' : 'aucun modèle qui lit les images avec cet abonnement');
};

// Not in the subscription, retired or unknown: another model may do.
export function unavailable(status: number, body: unknown): boolean {
  const { type, message } = (body ?? {}) as { type?: unknown; message?: unknown };
  if (status === 403) return type === 'tier_not_allowed';
  return (status === 400 || status === 404) && (type === 'invalid_model' || /model.*(not found|retired|deprecated|does not exist)/i.test(String(message ?? '')));
}
