// Pretui — demo-motion-pointer: the seeded lot fixtures the pointer-motion usage pages share.
import {
  PLACES,
  TEAS,
  pick,
  seedFrom,
} from './examples';

export function lots(seed: string): { tea: string; place: string; lot: string }[] {
  let s = seedFrom(seed);
  let out: { tea: string; place: string; lot: string }[] = [];
  for (let i = 0; i < 3; i++) {
    out.push({
      tea: pick(s, i, TEAS),
      place: pick(s, i + 7, PLACES),
      lot: `B-${1100 + i * 41}`,
    });
  }
  return out;
}

