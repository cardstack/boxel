// The time the Connected apps page words its dates against. The page reads it
// here rather than from `new Date()`, so a test can pin it. The page counts
// calendar days in the browser's time zone, and against the real clock the
// same connection reads "2 hours ago" at noon and "yesterday" just after
// midnight.
export const clock = {
  now: (): Date => new Date(),
};
