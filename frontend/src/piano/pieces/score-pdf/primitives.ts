import type * as Pdfjs from 'pdfjs-dist';

// What a PDF page draws, as plain shapes in page points, y going down.

export interface Glyph {
  // Character drawn; music fonts use the SMuFL private codes.
  code: number;
  x: number;
  y: number; // baseline
  size: number; // font size, points
  width: number;
}

export interface Shape {
  // Corners, in drawing order; curves become their end points.
  points: { x: number; y: number }[];
  filled: boolean;
  curved: boolean;
  line: number; // stroke width, points
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface PageContent {
  width: number;
  height: number;
  glyphs: Glyph[];
  shapes: Shape[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
// `b` first, then `a`.
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

// Path commands of pdf.js: move, line, cubic, quadratic, close.
const ARGS = [2, 2, 6, 4, 0];
const isGlyph = (g: unknown): g is { unicode: string; width: number } => typeof g === 'object' && g !== null && 'unicode' in g;

export async function pageContent(pdfjs: typeof Pdfjs, page: Pdfjs.PDFPageProxy): Promise<PageContent> {
  const { OPS } = pdfjs;
  const [, , width, height] = page.view;
  const ops = await page.getOperatorList();
  const glyphs: Glyph[] = [];
  const shapes: Shape[] = [];

  // To points, y down, from the top left corner.
  let ctm: Matrix = [1, 0, 0, -1, -page.view[0], height];
  let line = 1;
  const stack: { ctm: Matrix; line: number }[] = [];
  let text: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  let size = 1;
  let leading = 0;
  let spacing = 0;
  let wordSpacing = 0;
  let stretch = 1;

  const fills = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokes = new Set<number>([OPS.stroke, OPS.closeStroke]);

  ops.fnArray.forEach((fn, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args: any = ops.argsArray[i];
    switch (fn) {
      case OPS.save: stack.push({ ctm, line }); break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) ({ ctm, line } = s);
        break;
      }
      case OPS.transform: ctm = multiply(ctm, Array.from(args) as Matrix); break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ctm, line });
        if (args[0]) ctm = multiply(ctm, Array.from(args[0]) as Matrix);
        break;
      case OPS.paintFormXObjectEnd: {
        const s = stack.pop();
        if (s) ({ ctm, line } = s);
        break;
      }
      case OPS.setLineWidth: line = args[0]; break;
      case OPS.beginText: text = lineMatrix = IDENTITY; break;
      case OPS.setFont: size = args[1]; break;
      case OPS.setLeading: leading = -args[0]; break;
      case OPS.setCharSpacing: spacing = args[0]; break;
      case OPS.setWordSpacing: wordSpacing = args[0]; break;
      case OPS.setHScale: stretch = args[0] / 100; break;
      case OPS.setTextMatrix: text = lineMatrix = Array.from(args[0] ?? args) as Matrix; break;
      case OPS.moveText: text = lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, args[0], args[1]]); break;
      case OPS.setLeadingMoveText:
        leading = args[1];
        text = lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, args[0], args[1]]);
        break;
      case OPS.nextLine: text = lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, 0, leading]); break;
      case OPS.showText: {
        for (const g of args[0]) {
          if (typeof g === 'number') {
            text = multiply(text, [1, 0, 0, 1, (-g / 1000) * size * stretch, 0]);
            continue;
          }
          if (!isGlyph(g)) continue;
          const full = multiply(ctm, text);
          const at = apply(full, 0, 0);
          const advance = (g.width / 1000) * size;
          const scale = Math.hypot(full[0], full[1]);
          const code = g.unicode.codePointAt(0);
          if (code !== undefined && !/\s/.test(g.unicode)) {
            glyphs.push({ code, x: at.x, y: at.y, size: size * Math.hypot(full[2], full[3]), width: advance * stretch * scale });
          }
          text = multiply(text, [1, 0, 0, 1, (advance + spacing + (g.unicode === ' ' ? wordSpacing : 0)) * stretch, 0]);
        }
        break;
      }
      case OPS.constructPath: {
        const [op, [data]] = args as [number, [ArrayLike<number> | null]];
        if (!data || (!fills.has(op) && !strokes.has(op))) break;
        shapes.push(...subpaths(data, ctm, fills.has(op), line * Math.hypot(ctm[0], ctm[1])));
        break;
      }
    }
  });
  return { width, height, glyphs, shapes };
}

function subpaths(data: ArrayLike<number>, ctm: Matrix, filled: boolean, line: number): Shape[] {
  const out: Shape[] = [];
  let points: { x: number; y: number }[] = [];
  let curved = false;
  const flush = () => {
    if (points.length > 1) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      out.push({ points, filled, curved, line, box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } });
    }
    points = [];
    curved = false;
  };
  for (let i = 0; i < data.length;) {
    const cmd = data[i++];
    const n = ARGS[cmd] ?? 0;
    if (cmd === 0) flush();
    if (n) points.push(apply(ctm, data[i + n - 2], data[i + n - 1]));
    if (cmd === 2 || cmd === 3) curved = true;
    if (cmd === 4 && points.length) points.push(points[0]);
    i += n;
  }
  flush();
  return out;
}
