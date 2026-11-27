import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { patience } from './gemini.js';
import { readImages } from './index.js';
import { pace, unavailable } from './mistral.js';
import { AiError, parseReading } from './reading.js';

const IMAGE = 'data:image/jpeg;base64,QUJD';
const NOTHING = '{"kind":"nothing","reason":"test"}';
const gemini = (text: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'je réfléchis', thought: true }, { text }] } }] } });
const mistral = (text: string) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });

type Reply = { status: number; body: unknown };
let calls: { model: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }[];
// No network in tests: what each call answers.
function answers(reply: (model: string, n: number) => Reply) {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body);
    const model = body.model ?? /models\/([^:]+):/.exec(url)![1];
    calls.push({ model, url, headers: init.headers, body });
    const { status, body: out } = reply(model, calls.length);
    return { status, json: async () => out };
  });
}

const before = { ...config };
beforeEach(() => {
  Object.assign(config, { geminiApiKey: 'g-key', geminiModel: '', mistralApiKey: 'm-key', mistralVisionModel: '' });
  Object.assign(pace, { pause: 0, retry: 0 });
  Object.assign(patience, { pause: 0 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  Object.assign(config, before);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading images', () => {
  it('asks Gemini first, the key in a header only', async () => {
    answers(() => gemini(NOTHING));
    expect(await readImages([IMAGE])).toEqual({ kind: 'nothing', reason: 'test' });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['x-goog-api-key']).toBe('g-key');
    expect(calls[0].url).not.toContain('g-key');
    expect(calls[0].body.contents).toMatchObject([{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }, {}] }]);
  });

  it('goes down Gemini’s models when one is used up', async () => {
    answers((model) => (model === 'gemini-3.8-flash' ? gemini(NOTHING) : { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } }));
    await readImages([IMAGE]);
    expect(calls.map((c) => c.model)).toEqual(['gemini-4-hydrogen', 'gemini-3.8-flash']);
  });

  it('asks Gemini again when it is overloaded, not when it is used up', async () => {
    answers((model, n) => {
      if (model === 'gemini-4-hydrogen') return { status: 429, body: null };
      return n < 5 ? { status: 503, body: null } : gemini(NOTHING);
    });
    await readImages([IMAGE]);
    expect(calls.map((c) => c.model)).toEqual(['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.6-flash']);
  });

  it('turns to Mistral, waiting when it is asked too fast', async () => {
    let small = 0;
    answers((model) => {
      if (model.startsWith('gemini')) return { status: 400, body: { error: { message: 'API key not valid' } } };
      if (model.startsWith('mistral-large')) return { status: 403, body: { type: 'tier_not_allowed' } };
      return ++small === 1 ? { status: 429, body: { type: 'rate_limited' } } : mistral(NOTHING);
    });
    expect((await readImages([IMAGE])).kind).toBe('nothing');
    expect(calls.map((c) => c.model)).toEqual(['gemini-4-hydrogen', 'mistral-large-4-0', 'mistral-large-2512', 'mistral-small-2506', 'mistral-small-2506']);
    // The one that answered is asked directly the next time.
    answers((model) => (model.startsWith('gemini') ? { status: 403, body: null } : mistral(NOTHING)));
    await readImages([IMAGE]);
    expect(calls.map((c) => c.model)).toEqual(['gemini-4-hydrogen', 'mistral-small-2506']);
  });

  it('says what went wrong with each', async () => {
    answers((model) => (model.startsWith('gemini') ? { status: 503, body: null } : { status: 401, body: null }));
    await expect(readImages([IMAGE])).rejects.toThrow('Gemini : quota atteint ou service surchargé, réessaie plus tard. Mistral : clé refusée.');
    Object.assign(config, { geminiApiKey: '', mistralApiKey: '' });
    await expect(readImages([IMAGE])).rejects.toThrow('pas configurée');
  });

  it('makes sense of the answers', () => {
    const numbers = { kind: 'numbers', parts: [{ label: null, left: [1, null, '3'], right: ['4', '4', 6] }] };
    expect(parseReading(`\`\`\`json\n${JSON.stringify(numbers)}\n\`\`\``)).toEqual({
      kind: 'numbers', title: '', parts: [{ label: '', aligned: false, left: ['1', '', '3'], right: ['4', '4', '6'] }],
    });
    expect(parseReading([{ type: 'text', text: JSON.stringify({ kind: 'score', bpm: 'vif', measures: [{ right: [{ notes: ['C4'], beats: '1' }] }] }) }])).toMatchObject({
      kind: 'score', bpm: null, measures: [{ right: [{ notes: ['C4'], beats: 1 }], left: [] }],
    });
    expect(() => parseReading('{"kind":"numbers","parts":[')).toThrow(AiError);
    expect(() => parseReading('{"kind":"song"}')).toThrow(AiError);
    expect(() => parseReading(null)).toThrow(AiError);
  });

  it('tries another Mistral model only when that one cannot be used', () => {
    expect(unavailable(403, { type: 'tier_not_allowed' })).toBe(true);
    expect(unavailable(400, { type: 'invalid_model', message: 'Invalid model: x' })).toBe(true);
    expect(unavailable(403, { type: 'forbidden' })).toBe(false);
    expect(unavailable(400, { type: 'invalid_request_error', message: 'Image too large' })).toBe(false);
  });
});
