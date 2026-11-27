import { frenchName, noteName, type LyricLine, type PieceNote } from '@piano/shared';
import type { Look } from '../../../lib/appearance';
import { stage } from '../../stage/settings';
import type { NoteSource } from '../FallingNotes';
import { NotesPainter } from '../FallingNotes';
import { filled, sungAt, sungLines, type SungLine } from '../lyrics';
import type { VideoOptions } from './settings';

// One picture of a video: the notes falling, the keyboard, and over them the
// lyrics, the title and the logo. The same painter as on the screen.

type Ctx = CanvasRenderingContext2D;
const FONT = (weight: number, size: number) => `${weight} ${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
// Seconds the title stays, then fades.
const TITLE = 3.5;
const FADE = 0.8;

export interface Film {
  player: NoteSource;
  from: number;
  to: number;
  title: string;
  artist: string | null;
  lyrics: LyricLine[] | null;
  numbers?: ReadonlyMap<PieceNote, number>;
  // From when the video starts (seconds in the piece).
  start: number;
  // Loaded beforehand (loadCover); null: none, or it would not come.
  cover?: CanvasImageSource | null;
}

export class FrameMaker {
  private painter: NotesPainter;
  private keys: HTMLCanvasElement;
  private sung: SungLine[];
  private logo: HTMLImageElement | null = null;

  constructor(private film: Film, private options: VideoOptions, private look: Look, private w: number, private h: number) {
    this.painter = new NotesPainter(film.from, film.to);
    this.keys = document.createElement('canvas');
    this.sung = film.lyrics ? sungLines(film.lyrics) : [];
    if (options.logoImage) {
      const img = new Image();
      img.src = options.logoImage;
      this.logo = img;
    }
  }

  // Where things go.
  private get layout() {
    const { w, h } = this;
    const portrait = this.options.format === 'portrait';
    const keysH = Math.round(portrait ? h * 0.12 : h * 0.2);
    // Above the notes: the cover and the title (only standing up).
    // The lyrics go there too, under the title: off the notes.
    const top = portrait && this.options.cover ? Math.round(w * (this.sung.length && this.options.lyrics ? 0.76 : 0.6)) : 0;
    return { top, notesH: h - keysH - top, keysH, unit: Math.min(w, h) / 1080 };
  }

  draw(ctx: Ctx, at: number) {
    const { w, h, film, options, look } = this;
    const { top, notesH, keysH, unit } = this.layout;
    const styled = stage.get().style !== 'classic';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = styled ? '#000000' : look.theme === 'dark' ? '#121212' : '#fafafa';
    ctx.fillRect(0, 0, w, h);

    if (this.keys.width !== w || this.keys.height !== keysH) Object.assign(this.keys, { width: w, height: keysH });
    const keyCtx = this.keys.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, notesH);
    ctx.clip();
    ctx.translate(0, top);
    this.painter.paint(ctx, w, notesH, film.player, { numbers: options.numbers ? film.numbers : undefined, keys: styled && stage.get().keys !== 'off' ? keyCtx : null, keysSize: [w, keysH] }, at);
    ctx.restore();
    this.keyboard(ctx, top + notesH, keysH, styled, unit);

    const pos = film.player.position;
    if (options.cover) this.header(ctx, unit, styled);
    if (options.lyrics && this.sung.length) this.lyrics(ctx, pos, unit);
    // The title is already at the top.
    if (options.title && !options.cover) this.titleCard(ctx, pos - film.start, unit);
    if (options.logo || this.logo) this.watermark(ctx, unit);
  }

  private keyboard(ctx: Ctx, y: number, kh: number, styled: boolean, unit: number) {
    const { w, look } = this;
    const layout = this.painter.layout;
    const sounding = new Map<number, string>();
    for (const n of this.film.player.notes) {
      const pos = this.film.player.position;
      if (n.time > pos) break;
      if (n.time + n.duration > pos) sounding.set(n.midi, (n.hand === 'left' ? look.left : look.right).strong);
    }
    const blackH = kh * 0.62;
    for (const [m, b] of layout) {
      if (b.black) continue;
      ctx.fillStyle = !styled && sounding.has(m) ? sounding.get(m)! : '#f4f4f4';
      ctx.fillRect(b.x * w + 0.5, y, b.width * w - 1, kh);
    }
    if (styled && stage.get().keys !== 'off') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.keys, 0, y);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Names at the foot of the white keys.
    const names = this.options.keyNames;
    if (names !== 'none') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (const [m, b] of layout) {
        if (b.black) continue;
        const size = Math.min(b.width * w * (names === 'names' ? 0.42 : 0.62), 26 * unit);
        if (size < 6) continue;
        ctx.font = FONT(600, size);
        ctx.fillStyle = !styled && sounding.has(m) ? '#ffffff' : '#8a8a8a';
        ctx.fillText(names === 'names' ? frenchName(m) : noteName(m).replace(/\d+$/, ''), (b.x + b.width / 2) * w, y + kh - size * 0.5);
      }
    }
    for (const [m, b] of layout) {
      if (!b.black) continue;
      ctx.fillStyle = !styled && sounding.has(m) ? sounding.get(m)! : '#1a1a1a';
      ctx.beginPath();
      ctx.roundRect(b.x * w, y, b.width * w, blackH, [0, 0, 3, 3]);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, y, w, 2);
  }

  // The cover in the middle, the title and the artist under it, from its left edge.
  private header(ctx: Ctx, unit: number, styled: boolean) {
    const { w } = this;
    const portrait = this.options.format === 'portrait';
    const cover = this.film.cover;
    const size = portrait ? w * 0.36 : this.h * 0.15;
    const x = portrait ? (w - size) / 2 : 36 * unit;
    const y = portrait ? w * 0.06 : 36 * unit;
    if (cover) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, 10 * unit);
      ctx.clip();
      ctx.drawImage(cover, x, y, size, size);
      ctx.restore();
    }
    const light = styled || this.look.theme === 'dark';
    const [tx, ty] = portrait ? [x, y + size + 54 * unit] : [cover ? x + size + 24 * unit : x, y + size * 0.38];
    const room = portrait ? Math.max(size, w * 0.6) : w * 0.5;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = FONT(800, 40 * unit);
    ctx.fillStyle = light ? '#ffffff' : '#171717';
    ctx.fillText(this.film.title.toUpperCase(), tx, ty, room);
    if (this.film.artist) {
      ctx.font = FONT(500, 26 * unit);
      ctx.fillStyle = light ? 'rgba(255, 255, 255, 0.7)' : 'rgba(23, 23, 23, 0.65)';
      ctx.fillText(this.film.artist, tx, ty + 38 * unit, room);
    }
  }

  private lyrics(ctx: Ctx, pos: number, unit: number) {
    const now = sungAt(this.sung, pos);
    const line = this.sung[now];
    const next = this.sung[now + 1];
    const portrait = this.options.format === 'portrait';
    // Standing up with the cover: under the title, above the notes.
    const y = portrait && this.options.cover ? this.w * 0.6 : this.layout.top + this.layout.notesH * (portrait ? 0.1 : 0.14) + (portrait ? 0 : this.options.cover ? this.h * 0.12 : 0);
    const big = 54 * unit;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // Long lines get smaller rather than cut.
    const fit = (text: string, size: number, weight: number) => {
      ctx.font = FONT(weight, size);
      const width = ctx.measureText(text).width;
      const room = this.w * 0.9;
      if (width <= room) return { size, width };
      const smaller = (size * room) / width;
      ctx.font = FONT(weight, smaller);
      return { size: smaller, width: room };
    };
    if (line && line.words.length && pos < line.end + 1.5) {
      const text = line.words.map((x) => x.text).join(' ');
      const { width } = fit(text, big, 700);
      let x = (this.w - width) / 2;
      ctx.lineWidth = 8 * unit;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeText(text, x, y);
      for (const word of line.words) {
        const part = `${word.text} `;
        const ww = ctx.measureText(part).width;
        const share = filled(word, pos);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(word.text, x, y);
        if (share > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y - big, ctx.measureText(word.text).width * share, big * 2);
          ctx.clip();
          ctx.fillStyle = '#38bdf8';
          ctx.fillText(word.text, x, y);
          ctx.restore();
        }
        x += ww;
      }
    }
    if (next && next.words.length) {
      const text = next.words.map((x) => x.text).join(' ');
      const { width } = fit(text, big * 0.6, 600);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 6 * unit;
      ctx.strokeText(text, (this.w - width) / 2, y + big * 1.1);
      ctx.fillText(text, (this.w - width) / 2, y + big * 1.1);
    }
  }

  private titleCard(ctx: Ctx, since: number, unit: number) {
    if (since > TITLE + FADE) return;
    const a = since < TITLE ? 1 : 1 - (since - TITLE) / FADE;
    ctx.globalAlpha = Math.max(0, a);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = this.options.format === 'portrait' ? this.h * 0.2 : this.layout.notesH * 0.42;
    ctx.font = FONT(800, 88 * unit);
    ctx.lineWidth = 10 * unit;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeText(this.film.title, this.w / 2, y, this.w * 0.9);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.film.title, this.w / 2, y, this.w * 0.9);
    if (this.film.artist) {
      ctx.font = FONT(500, 44 * unit);
      ctx.strokeText(this.film.artist, this.w / 2, y + 80 * unit, this.w * 0.9);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillText(this.film.artist, this.w / 2, y + 80 * unit, this.w * 0.9);
    }
    ctx.globalAlpha = 1;
  }

  // A watermark: small, see-through, in a corner; there, not in the way.
  private watermark(ctx: Ctx, unit: number) {
    // At the top right: the cover may be at the left.
    const pad = 28 * unit;
    const size = 34 * unit;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.font = FONT(600, 24 * unit);
    const text = this.options.logo ? ctx.measureText(this.options.logo).width : 0;
    const picture = this.logo?.complete && this.logo.naturalWidth ? (this.logo.naturalWidth / this.logo.naturalHeight) * size : 0;
    const gap = picture && text ? 10 * unit : 0;
    let x = this.w - pad - text - gap - picture;
    // Seen on light notes as on the black.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 6 * unit;
    if (picture) {
      ctx.drawImage(this.logo!, x, pad, picture, size);
      x += picture + gap;
    }
    if (this.options.logo) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.options.logo, x, pad + size / 2);
    }
    ctx.restore();
  }
}

// Covers come from Deezer or Apple Music, which let them be drawn: a bigger one
// is asked for, the small one if not.
export async function loadCover(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return null;
  const big = url.replace(/\/\d+x\d+(-0{6}-80-0-0\.jpg)$/, '/1000x1000$1').replace(/\/\d+x\d+bb\./, '/1000x1000bb.');
  const load = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  return (await load(big)) ?? (big === url ? null : await load(url));
}
