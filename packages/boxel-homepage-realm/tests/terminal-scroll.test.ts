// Regression tests for the CLI terminal auto-scroll decision logic
// (contents/boxel-ai-website/lib/terminal-scroll.ts) and the visibility
// gating contract of the terminal animation in cli-section.gts.
//
// Run with: pnpm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  activeLineIndex,
  isSequenceSettled,
  scrollTargetFor,
} from '../contents/boxel-ai-website/lib/terminal-scroll.ts';

const DELAYS = [0, 0.5, 1.2, 2.0, 3.5]; // ascending, like authored lines

test('activeLineIndex tracks the last fired line', () => {
  assert.equal(activeLineIndex(DELAYS, -0.1), -1); // nothing fired yet
  assert.equal(activeLineIndex(DELAYS, 0), 0); // fires at its exact delay
  assert.equal(activeLineIndex(DELAYS, 0.6), 1);
  assert.equal(activeLineIndex(DELAYS, 2.0), 3);
  assert.equal(activeLineIndex(DELAYS, 999), 4); // all fired
  assert.equal(activeLineIndex([], 5), -1); // no lines
});

test('activeLineIndex stops scanning at the first future delay', () => {
  // Original DOM loop broke at the first delay > elapsed; an out-of-order
  // later line must not be picked even if its delay has fired.
  assert.equal(activeLineIndex([0, 5, 1], 2), 0);
});

test('isSequenceSettled fires only after the last delay plus settle time', () => {
  assert.equal(isSequenceSettled(DELAYS, 3.5), false); // last line just fired
  assert.equal(isSequenceSettled(DELAYS, 5.4), false); // still settling (3.5+2)
  assert.equal(isSequenceSettled(DELAYS, 5.6), true);
  assert.equal(isSequenceSettled(DELAYS, 4.1, 0.5), true); // custom settle
  assert.equal(isSequenceSettled([], 999), false); // no lines: never settles
});

test('scrollTargetFor scrolls forward only, and only when content overflows', () => {
  // line bottom 300px, viewport 200px -> target 300-200+16 = 116
  assert.equal(scrollTargetFor(300, 200, 0), 116);
  // never scrolls backwards
  assert.equal(scrollTargetFor(300, 200, 116), null);
  assert.equal(scrollTargetFor(300, 200, 150), null);
  // content still fits the viewport: no scroll
  assert.equal(scrollTargetFor(100, 200, 0), null);
  // custom bottom padding
  assert.equal(scrollTargetFor(300, 200, 0, 0), 100);
});

test('terminal animation stays visibility-gated in cli-section.gts', () => {
  // The cycle must be driven by the IntersectionObserver gate, not the
  // constructor — a constructor perform() runs the animation (and its
  // forced-reflow interval) for the life of the page even offscreen.
  const source = readFileSync(
    fileURLToPath(
      new URL(
        '../contents/boxel-ai-website/sections/cli-section.gts',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /constructor[^}]*cycleTerminal\.perform/s,
    'cycleTerminal must not be performed from the constructor',
  );
  assert.match(
    source,
    /gateTerminal = modifier[\s\S]*?IntersectionObserver/,
    'gateTerminal must gate the cycle behind an IntersectionObserver',
  );
  assert.match(
    source,
    /activeLineIndex\(|isSequenceSettled\(/,
    'AutoScroll must delegate decisions to the tested lib/terminal-scroll module',
  );
});
