// What the secure window says when a sign-in fails, worded as the app's own
// sign-in page words it, so signing in reads the same in either place.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// A Gregorian month and year, in days.
const DAYS_PER_MONTH = 146097 / 4800;
const DAYS_PER_YEAR = 146097 / 400;

// A future duration as the app shows one: moment's `humanize`, with its
// default thresholds and its rounding set to round up, as the app sets it.
export function relativeTime(ms) {
  let seconds = Math.ceil(ms / SECOND);
  let minutes = Math.ceil(ms / MINUTE);
  let hours = Math.ceil(ms / HOUR);
  let days = Math.ceil(ms / DAY);
  let months = Math.ceil(ms / DAY / DAYS_PER_MONTH);
  let years = Math.ceil(ms / DAY / DAYS_PER_YEAR);
  let text;
  if (seconds < 45) {
    text = 'a few seconds';
  } else if (minutes <= 1) {
    text = 'a minute';
  } else if (minutes < 45) {
    text = `${minutes} minutes`;
  } else if (hours <= 1) {
    text = 'an hour';
  } else if (hours < 22) {
    text = `${hours} hours`;
  } else if (days <= 1) {
    text = 'a day';
  } else if (days < 26) {
    text = `${days} days`;
  } else if (months <= 1) {
    text = 'a month';
  } else if (months < 11) {
    text = `${months} months`;
  } else if (years <= 1) {
    text = 'a year';
  } else {
    text = `${years} years`;
  }
  return `in ${text}`;
}

// A sign-in refused for too many failed attempts, with how long until the next
// one may be tried when the server says.
export function tooManyFailedAttempts(retryAfterMs) {
  return retryAfterMs > 0
    ? `Sign-in failed. Too many failed attempts, try again ${relativeTime(retryAfterMs)}.`
    : 'Sign-in failed. Too many failed attempts, try again later.';
}

// A failed password sign-in, in the app's words: a refused password or
// account as the app reports a refused Matrix login, and too many failed
// attempts with how long to wait.
export function signInFailed(error) {
  if (error?.code === 'invalid-credentials') {
    return 'Sign-in failed. Please check your credentials and try again.';
  }
  if (error?.code === 'rate-limited') {
    return tooManyFailedAttempts(error.retryAfterMs);
  }
  let message = asSentence(error?.message);
  return message ? `Sign-in failed. ${message}` : 'Sign-in failed.';
}

// The server words its errors for an API; shown here, each reads as a
// sentence.
export function asSentence(message) {
  let text = String(message ?? '').trim();
  if (!text) {
    return '';
  }
  text = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
