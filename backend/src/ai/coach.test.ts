import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { askCoach, coachBody, coachPace } from './coach.js';

const before = { ...config };
let calls: { url: string; body: Record<string, unknown> }[];
const answers = (reply: (url: string) => { status: number; body: unknown }) => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const { status, body } = reply(url);
    return { status, json: async () => body };
  });
};
beforeEach(() => {
  Object.assign(config, { geminiApiKey: 'g', geminiModel: '', mistralApiKey: 'm', mistralVisionModel: '' });
  coachPace.pause = 0;
});
afterEach(() => {
  Object.assign(config, before);
  vi.unstubAllGlobals();
});

const request = { context: 'Morceau : Amnésie', messages: [{ role: 'user' as const, text: 'Quel doigté ?' }, { role: 'coach' as const, text: '1 2 3' }, { role: 'user' as const, text: 'Et à gauche ?' }] };

describe('the coach', () => {
  it('asks Gemini with what it was told, the conversation in order', async () => {
    answers(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'pense…', thought: true }, { text: ' Pouce sur Do. ' }] } }] } }));
    expect(await askCoach(request)).toBe('Pouce sur Do.');
    const body = calls[0].body as { systemInstruction: { parts: { text: string }[] }; contents: { role: string }[] };
    expect(body.systemInstruction.parts[0].text).toContain('Morceau : Amnésie');
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('turns to Mistral when Gemini cannot', async () => {
    answers((url) => (url.includes('google') ? { status: 429, body: null } : { status: 200, body: { choices: [{ message: { content: 'Main gauche : 5 3 1.' } }] } }));
    expect(await askCoach(request)).toBe('Main gauche : 5 3 1.');
    const last = calls[calls.length - 1].body as { messages: { role: string }[] };
    expect(last.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('says why when nobody answers', async () => {
    answers(() => ({ status: 503, body: null }));
    await expect(askCoach(request)).rejects.toThrow('Le coach ne répond pas');
    Object.assign(config, { geminiApiKey: '', mistralApiKey: '' });
    await expect(askCoach(request)).rejects.toThrow('pas configurée');
  });

  it('only takes a conversation that ends with a question', () => {
    expect(coachBody.safeParse(request).success).toBe(true);
    expect(coachBody.safeParse({ ...request, messages: request.messages.slice(0, 2) }).success).toBe(false);
    expect(coachBody.safeParse({ ...request, messages: [] }).success).toBe(false);
  });
});
