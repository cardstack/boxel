// The usage pages this module used to hold now live in
// components/<slug>.usage.gts; what remains here is the fixtures they
// share. The header below describes those pages, not this file.
// Pretui — demo-motion-pointer: freestyle usage pages for the motion
// territory's pointer wave (CursorTrail, Magnetic, Spotlight, Tilt),
// rendered with the ported ember-freestyle machinery. No upstream usage
// pages exist for these (motion-primitives / react-bits / fancy ship docs
// sites, not knob rigs), so every knob set is derived from the Pretui
// signature in motion-pointer.gts.
//
// Each page's @description carries the Law 8 verdict for that component in
// plain words — what its resting state is, what it encodes, and, for Tilt,
// the fact that it encodes nothing at idle. The demo fields all contain
// REAL focusable controls, because focus-following is the keyboard path
// for three of the four and a demo that only works with a mouse would be
// demonstrating the upstream bug rather than the fix.
// Demo copy speaks the tea-trade fiction from examples.gts.
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

