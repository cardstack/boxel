// Password Game regression test — 26 BXL rules covering the readable-syntax
// surface (present/words/implies helpers, Excel LEN/UPPER/LEFT/RIGHT/PROPER,
// infix CONTAINS/STARTSWITH/ENDSWITH/AND/IN, jq unique/split/tostring/etc.)
//
// Source of truth is docs/password-game-spec.md. Each rule must:
//   1. compile without throwing
//   2. evaluate to true against CANONICAL (the "A" solution)
//   3. evaluate to false when we break one specific field
//
// If you change a rule here, update the spec doc AND realms/.../password-game.gts
// at the same time. The headless test is the enforcement mechanism.

import { strictEqual } from 'node:assert';
import { evaluateBxl, compileReadableSyntax } from '../../src/index.js';

// ─────────────────────────────────────────────────────────────────────────
// The 26 rules — each is { id, label, expression, breakBy }.
// `breakBy` returns a shallow-modified fixture that breaks THIS rule but
// leaves the others plausible. Used to check negative evaluation.
// ─────────────────────────────────────────────────────────────────────────

type Fixture = typeof CANONICAL;

interface Rule {
  id: number;
  label: string;
  expression: string;
  breakBy: (f: Fixture) => Fixture;
}

const RULES: Rule[] = [
  {
    id: 1,
    label: 'Username is filled in',
    expression: 'present(.profile.username)',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, username: '' } }),
  },
  {
    id: 2,
    label: 'Username is at least 5 characters',
    expression: 'LEN(.profile.username) >= 5',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, username: 'ada' } }),
  },
  {
    id: 3,
    label: 'Username ends with your age as digits',
    expression: 'RIGHT(.profile.username, 2) == (.profile.age | tostring)',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, username: 'adaxy' } }),
  },
  {
    id: 4,
    label: 'Display name is exactly two words',
    expression: 'words(.profile.displayName) == 2',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, displayName: 'Ada' } }),
  },
  {
    id: 5,
    label: 'Display name is in Title Case',
    expression: 'PROPER(.profile.displayName) == .profile.displayName',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, displayName: 'ada lovelace' } }),
  },
  {
    id: 6,
    label: 'Age is between 18 and 120',
    expression: '.profile.age >= 18 AND .profile.age <= 120',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, age: 12 } }),
  },
  {
    id: 7,
    label: 'Email contains @',
    expression: '.profile.email CONTAINS "@"',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, email: 'ada-at-bxl.dev' } }),
  },
  {
    id: 8,
    label: 'Email starts with username',
    expression: '.profile.email STARTSWITH .profile.username',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, email: 'someone@else.org' } }),
  },
  {
    id: 9,
    label: 'Birth year + age equals 2026',
    expression: '.profile.birthYear + .profile.age == 2026',
    breakBy: (f) => ({ ...f, profile: { ...f.profile, birthYear: 1990 } }),
  },
  {
    id: 10,
    label: 'Favorite color uppercased is PURPLE',
    expression: 'UPPER(.preferences.favoriteColor) == "PURPLE"',
    breakBy: (f) => ({
      ...f,
      preferences: { ...f.preferences, favoriteColor: 'blue' },
    }),
  },
  {
    id: 11,
    label: 'Favorite number equals length of favorite color',
    expression: '.preferences.favoriteNumber == LEN(.preferences.favoriteColor)',
    breakBy: (f) => ({
      ...f,
      preferences: { ...f.preferences, favoriteNumber: 99 },
    }),
  },
  {
    id: 12,
    label: 'Theme is dark or light',
    expression:
      '.preferences.theme == "dark" OR .preferences.theme == "light"',
    breakBy: (f) => ({
      ...f,
      preferences: { ...f.preferences, theme: 'neon' },
    }),
  },
  {
    id: 13,
    label: 'If newsletter is on, bio mentions BXL',
    expression: 'implies(.preferences.newsletter; .bio | contains("BXL"))',
    breakBy: (f) => ({
      ...f,
      bio: 'Nothing here about that expression language.',
    }),
  },
  {
    id: 14,
    label: 'Secret phrase is exactly 5 words',
    expression: 'words(.security.secretPhrase) == 5',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, secretPhrase: 'too short' },
    }),
  },
  {
    id: 15,
    label: 'Secret phrase contains BXL (case-insensitive)',
    expression: 'UPPER(.security.secretPhrase) CONTAINS "BXL"',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, secretPhrase: 'I love coding in jq alone' },
    }),
  },
  {
    id: 16,
    label: 'Backup code starts with UPPER(first 3 of username)',
    expression: '.security.backupCode STARTSWITH UPPER(LEFT(.profile.username, 3))',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, backupCode: 'XYZPURPLE42' },
    }),
  },
  {
    id: 17,
    label: 'Backup code contains UPPER(favorite color)',
    expression: '.security.backupCode CONTAINS UPPER(.preferences.favoriteColor)',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, backupCode: 'ADAGREEN42' },
    }),
  },
  {
    id: 18,
    label: 'Backup code ends with your age',
    expression: '.security.backupCode ENDSWITH (.profile.age | tostring)',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, backupCode: 'ADAPURPLE99' },
    }),
  },
  {
    id: 19,
    label: 'PIN is exactly 4 digits',
    expression: 'LEN(.security.pin | tostring) == 4',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, pin: 7 },
    }),
  },
  {
    id: 20,
    label: 'Sum of PIN digits equals favoriteNumber × 2',
    expression:
      '([.security.pin | tostring | split("") | .[] | tonumber] | add) == .preferences.favoriteNumber * 2',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, pin: 9999 },
    }),
  },
  {
    id: 21,
    label: 'Tag count equals favoriteNumber minus 2',
    expression: '(.tags | length) == .preferences.favoriteNumber - 2',
    breakBy: (f) => ({ ...f, tags: ['only', 'two'] }),
  },
  {
    id: 22,
    label: 'First tag has length 3',
    expression: 'LEN(.tags[0]) == 3',
    breakBy: (f) => ({ ...f, tags: ['longer', 'cards', 'forms', 'code'] }),
  },
  {
    id: 23,
    label: 'All tags are unique',
    expression: '(.tags | unique | length) == (.tags | length)',
    breakBy: (f) => ({ ...f, tags: ['bxl', 'bxl', 'forms', 'code'] }),
  },
  {
    id: 24,
    label: 'Bio mentions the display name',
    expression: '.bio CONTAINS .profile.displayName',
    breakBy: (f) => ({
      ...f,
      bio: 'Just some text without the person name in it 2026 BXL',
    }),
  },
  {
    id: 25,
    label: 'Bio mentions the year 2026',
    expression: '.bio CONTAINS "2026"',
    breakBy: (f) => ({
      ...f,
      bio: 'Ada Lovelace joined last year to code with ada42 and love BXL',
    }),
  },
  {
    id: 26,
    label:
      'Backup code equals UPPER(first 3 of username) + UPPER(color) + age',
    expression:
      '.security.backupCode == UPPER(LEFT(.profile.username, 3)) + UPPER(.preferences.favoriteColor) + (.profile.age | tostring)',
    breakBy: (f) => ({
      ...f,
      security: { ...f.security, backupCode: 'ADAPURPLE43' },
    }),
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Canonical "A" solution — matches the spec doc and the realm JSON.
// Any change here MUST also update docs/password-game-spec.md and the
// realm's canonical-solution.json.
// ─────────────────────────────────────────────────────────────────────────

const CANONICAL = {
  profile: {
    username: 'ada42',
    displayName: 'Ada Lovelace',
    age: 42,
    email: 'ada42@bxl.dev',
    birthYear: 1984,
  },
  preferences: {
    favoriteColor: 'purple',
    favoriteNumber: 6,
    newsletter: true,
    theme: 'dark',
  },
  security: {
    secretPhrase: 'I love coding in BXL',
    backupCode: 'ADAPURPLE42',
    pin: 4242,
  },
  tags: ['bxl', 'cards', 'forms', 'code'],
  bio: 'Ada Lovelace joined in 2026 to code with ada42 and love BXL',
};

// ─────────────────────────────────────────────────────────────────────────
// Per-rule assertions: compile, pass on canonical, fail on broken.
// ─────────────────────────────────────────────────────────────────────────

let passedCount = 0;
const failures: string[] = [];

for (const rule of RULES) {
  const label = `R${rule.id} (${rule.label})`;

  // 1. Compiles without throwing
  let compiled: string;
  try {
    compiled = compileReadableSyntax(rule.expression).source;
  } catch (e) {
    failures.push(`${label}: compile threw — ${(e as Error).message}\n  expr: ${rule.expression}`);
    continue;
  }

  // 2. Evaluates true on canonical
  let canonicalValue: unknown;
  try {
    canonicalValue = evaluateBxl(rule.expression, CANONICAL).value;
  } catch (e) {
    failures.push(
      `${label}: canonical evaluation threw — ${(e as Error).message}\n  expr: ${rule.expression}\n  compiled: ${compiled}`,
    );
    continue;
  }
  if (canonicalValue !== true) {
    failures.push(
      `${label}: canonical should pass but got ${JSON.stringify(canonicalValue)}\n  expr: ${rule.expression}\n  compiled: ${compiled}`,
    );
    continue;
  }

  // 3. Evaluates false on broken-fixture
  const broken = rule.breakBy(CANONICAL);
  let brokenValue: unknown;
  try {
    brokenValue = evaluateBxl(rule.expression, broken).value;
  } catch (e) {
    failures.push(
      `${label}: broken-fixture evaluation threw — ${(e as Error).message}\n  expr: ${rule.expression}`,
    );
    continue;
  }
  if (brokenValue === true) {
    failures.push(
      `${label}: broken fixture should fail but passed\n  expr: ${rule.expression}\n  broken-diff: ${JSON.stringify(diffShallow(CANONICAL, broken))}`,
    );
    continue;
  }

  passedCount += 1;
}

function diffShallow(a: unknown, b: unknown): Record<string, [unknown, unknown]> {
  const diff: Record<string, [unknown, unknown]> = {};
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return { root: [a, b] };
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (JSON.stringify(av) !== JSON.stringify(bv)) diff[k] = [av, bv];
  }
  return diff;
}

// ─────────────────────────────────────────────────────────────────────────
// Meta check — allRulesPass must be true on canonical.
// ─────────────────────────────────────────────────────────────────────────

const allExpr = RULES.map((r) => `(${r.expression})`).join(' AND ');
const allValue = evaluateBxl(allExpr, CANONICAL).value;
strictEqual(
  allValue,
  true,
  `ALL 26 rules ANDed together should be true on canonical — got ${JSON.stringify(allValue)}`,
);

// Compile size check — the composed expression shouldn't be absurdly large.
const allCompiled = compileReadableSyntax(allExpr).source;
if (allCompiled.length < 100) {
  failures.push(
    `Composed compile suspiciously small (${allCompiled.length} chars) — probably wrong`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`Password game: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

console.log(
  `BXL password game: ${passedCount}/${RULES.length} rules pass (compile + canonical-true + broken-false), composed ALL passes`,
);
