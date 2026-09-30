/** the small arithmetic every film does: the same four lines, once */

export const RAD = Math.PI / 180;

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** smoothstep on [0,1] */
export const smooth = (t: number): number => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};

export const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];

/** relative luminance of a #rrggbb, 0..1 */
export const luminance = (h: string): number => {
  if (!/^#[0-9a-f]{6}$/i.test(h)) {
    return 1;
  }
  const [r, g, b] = hex(h);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** a #rrggbb at an alpha, as CSS */
export const rgba = (h: string, a: number): string => {
  if (!/^#[0-9a-f]{6}$/i.test(h)) {
    return h;
  }
  const [r, g, b] = hex(h);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
};

export const mmss = (s: number): string => {
  const m = Math.floor(Math.max(0, s) / 60);
  return `${m}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
};

/** the shortest way round a circle, radians */
export const wrapAngle = (d: number): number => {
  let k = d;
  while (k > Math.PI) {
    k -= Math.PI * 2;
  }
  while (k < -Math.PI) {
    k += Math.PI * 2;
  }
  return k;
};
