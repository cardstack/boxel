#!/usr/bin/env node
/**
 * Send one POST /_mutate against the local Tessar admin realm.
 *
 *   mise exec -- node scripts/tessar-mutate.ts /Staff/ms-green 'Name = "Ms. Greene";'
 *   mise exec -- node scripts/tessar-mutate.ts /Classroom/classroom-2a '.classroomName = "Classroom 2A — Lab";' --syntax solidified
 */
import jwt from 'jsonwebtoken';

const realmURL = (
  process.env.TESSAR_REALM_URL ?? 'https://localhost:4251/tessar-admin/'
).replace(/\/?$/, '/');
const realmServerURL = new URL(realmURL).origin + '/';
const seed = process.env.REALM_SECRET_SEED ?? "shhh! it's a secret";
const user = process.env.TESSAR_USER ?? '@tessar_admin_realm:localhost';

const args = process.argv.slice(2);
const syntaxFlag = args.indexOf('--syntax');
const syntax =
  syntaxFlag >= 0
    ? args[syntaxFlag + 1]
    : (process.env.TESSAR_SYNTAX ?? 'readable');
const positional = args.filter(
  (_, i) => syntaxFlag < 0 || (i !== syntaxFlag && i !== syntaxFlag + 1),
);
const href = positional[0];
const source = positional.slice(1).join(' ');

if (!href || !source) {
  console.error(
    'usage: mise exec -- node scripts/tessar-mutate.ts <href> <source> [--syntax readable|solidified]',
  );
  process.exit(1);
}

const token = jwt.sign(
  {
    user,
    realm: realmURL,
    permissions: ['read', 'write', 'realm-owner'],
    sessionRoom: `tessar-mutate-${user}`,
    realmServerURL,
  },
  seed,
  { expiresIn: '7d' },
);

const body = {
  href,
  source,
  syntax,
  programId: `tessar:${Date.now()}`,
};

const response = await fetch(new URL('_mutate', realmURL), {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.card+json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(body),
});

const text = await response.text();
let parsed: unknown = text;
try {
  parsed = JSON.parse(text);
} catch {
  // keep raw text
}

console.log(
  JSON.stringify(
    { status: response.status, request: body, response: parsed },
    null,
    2,
  ),
);
process.exit(response.ok ? 0 : 1);
