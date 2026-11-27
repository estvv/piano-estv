import { config } from '../config.js';
import { geminiReader } from './gemini.js';
import { mistralReader } from './mistral.js';
import { AiError, type ImageReader } from './reading.js';

// Reads images with the AIs set up on this server, one after the other until
// one answers. Images are sent to them, and nowhere else.
export const readImages: ImageReader = async (images) => {
  const readers: [name: string, read: ImageReader][] = [];
  if (config.geminiApiKey) readers.push(['Gemini', geminiReader]);
  if (config.mistralApiKey) readers.push(['Mistral', mistralReader]);
  if (!readers.length) throw new AiError('La lecture par l’IA n’est pas configurée sur ce serveur');
  const why: string[] = [];
  for (const [name, read] of readers) {
    try {
      return await read(images);
    } catch (e) {
      if (!(e instanceof AiError)) throw e;
      why.push(`${name} : ${e.message}`);
    }
  }
  throw new AiError(`Lecture impossible. ${why.join('. ')}.`);
};

export { AiError, type ImageReader };
