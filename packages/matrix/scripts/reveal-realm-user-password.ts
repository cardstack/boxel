import { realmPassword } from '../helpers/realm-credentials';

let realmSecretSeed = process.env.REALM_SECRET_SEED;

if (!realmSecretSeed) {
  console.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

const [realmUsername] = process.argv.slice(2);
if (!realmUsername) {
  console.error(`please specify the realm username`);
  process.exit(-1);
}

(async () => {
  let password = await realmPassword(realmUsername, realmSecretSeed);
  console.log(password);
})().catch((e) => {
  console.error(`unexpected error`, e);
  process.exit(1);
});
