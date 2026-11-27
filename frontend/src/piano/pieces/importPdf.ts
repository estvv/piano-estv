import { guessNames } from './names';
import { pageContent, type PageContent } from './score-pdf/primitives';
import { NotAScore, readScore } from './score-pdf/readScore';
import type { ImportResult } from './types';

// A score in PDF made by a music program: its symbols are read one by one.
// Nothing is sent to the server.

const MAX_PAGES = 40;

async function open(file: File) {
  // Only loaded for a PDF.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    const { default: PdfWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker');
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  }
  try {
    return { pdfjs, doc: await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 }).promise };
  } catch {
    throw new Error('Impossible d’ouvrir ce PDF');
  }
}

// NotAScore: a scan, or a music font not known. Pictures of its pages may do.
export async function importPdf(file: File): Promise<ImportResult> {
  const { pdfjs, doc } = await open(file);
  const pages: PageContent[] = [];
  for (let i = 1; i <= Math.min(MAX_PAGES, doc.numPages); i++) pages.push(await pageContent(pdfjs, await doc.getPage(i)));
  await doc.loadingTask.destroy();
  const { notes, bpm, warnings } = readScore(pages);
  return { ...guessNames(file.name), source: 'musicxml', bpm, notes, warnings };
}

export { NotAScore };

// Its first pages as pictures.
export async function pdfPictures(file: File, max: number): Promise<Blob[]> {
  const { doc } = await open(file);
  const out: Blob[] = [];
  for (let i = 1; i <= Math.min(max, doc.numPages); i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1800 / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) out.push(blob);
  }
  await doc.loadingTask.destroy();
  return out;
}
