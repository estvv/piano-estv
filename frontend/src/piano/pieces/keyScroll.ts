import { keyLayout } from '../keyGeometry';

// On a phone, a keyboard with keys wide enough for fingers is wider than the
// screen: it follows the notes to play.

export const FINGER_KEY = 40; // px, width of a white key

export interface View {
  scrollLeft: number;
  clientWidth: number; // what is seen
  scrollWidth: number; // the whole keyboard
}

// Where to scroll to show these keys, or null when they are already in view.
// Keys too far apart for the screen: the lowest one first.
export function scrollToKeys(midis: number[], from: number, to: number, view: View): number | null {
  const layout = keyLayout(from, to);
  const boxes = midis.flatMap((m) => layout.get(m) ?? []);
  if (!boxes.length || view.scrollWidth <= view.clientWidth) return null;
  const left = Math.min(...boxes.map((b) => b.x)) * view.scrollWidth;
  let right = Math.max(...boxes.map((b) => b.x + b.width)) * view.scrollWidth;
  if (right - left > view.clientWidth - FINGER_KEY) right = left + FINGER_KEY;
  const margin = FINGER_KEY / 2;
  if (left >= view.scrollLeft + Math.min(margin, left) && right <= view.scrollLeft + view.clientWidth - Math.min(margin, view.scrollWidth - right)) return null;
  const centred = (left + right - view.clientWidth) / 2;
  return Math.round(Math.max(0, Math.min(view.scrollWidth - view.clientWidth, centred)));
}
