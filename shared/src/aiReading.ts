import { z } from 'zod';

// What the AI reads on images: numbers written down to learn a loop, or a
// score. Models fill it more or less well: what can be put right is, the rest
// is refused.

const text = z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined ? '' : String(v).trim()));
const list = z.array(text).nullish().transform((v) => v ?? []);

const numbersPart = z.object({
  label: text,
  // One entry per moment, both hands in step when `aligned` ('' : nothing then).
  aligned: z.boolean().nullish().transform((v) => !!v),
  left: list,
  right: list,
});

const scoreEvent = z.object({ notes: list, beats: z.coerce.number().positive().max(64) });
const events = z.array(scoreEvent).nullish().transform((v) => v ?? []);

export const aiReadingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('numbers'), title: text, parts: z.array(numbersPart).min(1).max(50) }),
  z.object({
    kind: z.literal('score'),
    title: text,
    bpm: z.coerce.number().min(20).max(400).nullish().catch(null),
    measures: z.array(z.object({ right: events, left: events })).min(1).max(400),
  }),
  z.object({ kind: z.literal('nothing'), reason: text }),
]);
export type AiReading = z.infer<typeof aiReadingSchema>;

// Images sent in one go, as JPEG data URLs.
export const AI_MAX_IMAGES = 4;
export const aiReadBody = z.object({
  images: z.array(z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).max(1_800_000)).min(1).max(AI_MAX_IMAGES),
});
