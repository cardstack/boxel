'use strict';

// `no-restricted-syntax` selectors that flag a direct clock read — `Date.now()`
// or a zero-argument `new Date()` — so card code reads the clock through a
// seam a test can pin.
//
// Anything that renders an elapsed time ("3d ago", a countdown, an age, an
// "expires soon" warning) produces different output depending on when it runs,
// so a visual comparison of it differs between two runs over identical data.
// The usual way to quiet that is to stop comparing the element, which trades
// the regression coverage away. Reading through the seam lets a test pin the
// instant instead, and the value stays visible.
//
// The seam falls back to the real clock when nothing has pinned it, so routing
// a call through it changes nothing outside a test.
//
// `new Date(value)` is untouched: parsing or copying a known instant is not a
// clock read. Only the zero-argument form asks "what time is it now".
const AMBIENT_CLOCK_MESSAGE =
  'Read the clock through `helpers/clock` (`now()` / `nowDate()`) instead of calling it directly, so a test can pin the instant and a rendered elapsed time stays comparable between runs.';

const AMBIENT_CLOCK_SELECTORS = [
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='Date'][callee.property.name='now']",
    message: AMBIENT_CLOCK_MESSAGE,
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: AMBIENT_CLOCK_MESSAGE,
  },
];

module.exports = { AMBIENT_CLOCK_SELECTORS, AMBIENT_CLOCK_MESSAGE };
