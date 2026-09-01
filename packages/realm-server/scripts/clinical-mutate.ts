#!/usr/bin/env node
/**
 * Send one POST /_mutate against the local BXL clinical mutation realm.
 *
 *   mise exec -- node scripts/clinical-mutate.ts /PatientDashboard/pt-1001 '.vitals.heartRate = 112;' --syntax solidified
 */
import jwt from 'jsonwebtoken';

const realmURL = (
  process.env.CLINICAL_REALM_URL ??
  'https://localhost:4251/bxl-clinical-mutation/'
).replace(/\/?$/, '/');
const realmServerURL = new URL(realmURL).origin + '/';
const seed = process.env.REALM_SECRET_SEED ?? "shhh! it's a secret";
const user =
  process.env.CLINICAL_USER ?? '@bxl_clinical_mutation_realm:localhost';

const args = process.argv.slice(2);
const syntaxFlag = args.indexOf('--syntax');
const syntax =
  syntaxFlag >= 0
    ? args[syntaxFlag + 1]
    : (process.env.CLINICAL_SYNTAX ?? 'readable');
const positional = args.filter(
  (_, i) => syntaxFlag < 0 || (i !== syntaxFlag && i !== syntaxFlag + 1),
);
const href = positional[0];
const source = positional.slice(1).join(' ');

if (!href || !source) {
  console.error(
    'usage: mise exec -- node scripts/clinical-mutate.ts <href> <source> [--syntax readable|solidified]',
  );
  process.exit(1);
}

const token = jwt.sign(
  {
    user,
    realm: realmURL,
    permissions: ['read', 'write', 'realm-owner'],
    sessionRoom: `clinical-mutate-${user}`,
    realmServerURL,
  },
  seed,
  { expiresIn: '7d' },
);

const body = {
  href,
  source,
  syntax,
  programId: `clinical:${Date.now()}`,
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
