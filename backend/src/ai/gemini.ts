import { setTimeout as wait } from 'node:timers/promises';
import { config } from '../config.js';
import { AiError, ASK, parseReading, post, PROMPT, TIMEOUT, type ImageReader } from './reading.js';

// Free of charge within quotas of their own, best first: when one is used up,
// the next one answers.
const MODELS = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash'];

// Overloaded models are asked again, all of them, after a while.
export const patience = { rounds: 3, pause: 5000 };

interface GeminiBody {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { status?: string; message?: string };
}

export const geminiReader: ImageReader = async (images) => {
  const signal = AbortSignal.timeout(TIMEOUT);
  const parts = images.map((url) => {
    const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/s.exec(url) ?? [];
    return { inlineData: { mimeType, data } };
  });
  // Dropped once their quota is used up or they are not offered.
  let models = config.geminiModel ? [config.geminiModel] : MODELS;
  let busy = false;
  for (let round = 0; round < patience.rounds && models.length; round++) {
    if (round > 0) await wait(patience.pause);
    const overloaded: string[] = [];
    for (const model of models) {
      const { status, body } = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { 'x-goog-api-key': config.geminiApiKey },
        {
          systemInstruction: { parts: [{ text: PROMPT }] },
          contents: [{ role: 'user', parts: [...parts, { text: ASK }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        signal,
      );
      const { candidates, promptFeedback, error } = (body ?? {}) as GeminiBody;
      if (status === 200) {
        if (promptFeedback?.blockReason) throw new AiError('image refusée');
        const text = candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
        console.log('Gemini', model, 'a répondu');
        return parseReading(text);
      }
      console.error('Gemini', model, status, JSON.stringify(error ?? body).slice(0, 300));
      if (status === 401 || status === 403 || /api key/i.test(error?.message ?? '')) throw new AiError('clé refusée');
      // Used up, overloaded, or not offered here.
      if (status >= 500) overloaded.push(model);
      if (status === 429 || status >= 500) busy = true;
      else if (status !== 404) throw new AiError(`demande refusée (${status})`);
    }
    models = overloaded;
  }
  throw new AiError(busy ? 'quota atteint ou service surchargé, réessaie plus tard' : 'aucun modèle disponible');
};
