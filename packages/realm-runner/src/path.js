import { RealmRunnerError } from './errors.js';

export function realmPath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new RealmRunnerError(
      'INVALID_PATH',
      'Realm path must be a non-empty string',
    );
  }
  if (
    input.includes('\\') ||
    input.includes('\0') ||
    input.includes('?') ||
    input.includes('#')
  ) {
    throw new RealmRunnerError('INVALID_PATH', `Invalid Realm path: ${input}`);
  }
  if (input.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(input)) {
    throw new RealmRunnerError(
      'PATH_OUTSIDE_REALM',
      `Realm path must be relative: ${input}`,
    );
  }
  let segments = input.split('/');
  let decodedSegments;
  try {
    decodedSegments = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    throw new RealmRunnerError(
      'INVALID_PATH',
      `Realm path contains malformed percent encoding: ${input}`,
    );
  }
  if (
    decodedSegments.some(
      (segment) =>
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\\') ||
        segment.includes('\0'),
    )
  ) {
    throw new RealmRunnerError(
      'PATH_OUTSIDE_REALM',
      `Realm path escapes the Realm: ${input}`,
    );
  }
  let normalized = input
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
  if (
    normalized === '' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new RealmRunnerError(
      'PATH_OUTSIDE_REALM',
      `Realm path escapes the Realm: ${input}`,
    );
  }
  return normalized;
}

export function globPattern(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024) {
    throw new RealmRunnerError(
      'INVALID_GLOB',
      'Glob must be a non-empty string of at most 1024 characters',
    );
  }
  if (
    input.includes('\\') ||
    input.startsWith('/') ||
    input.split('/').includes('..')
  ) {
    throw new RealmRunnerError(
      'PATH_OUTSIDE_REALM',
      `Glob must stay inside the Realm: ${input}`,
    );
  }
  return input.replace(/^\.\//, '');
}
