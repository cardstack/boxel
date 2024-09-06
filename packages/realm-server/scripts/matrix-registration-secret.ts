/* eslint-env node */

import { getLocalConfig } from '../synapse';

let registrationSecret = getLocalConfig().registration_shared_secret;
if (!registrationSecret) {
  console.error(
    `there is no 'registration_shared_secret' value in matrix homeserver.yaml`,
  );
  process.exit(-1);
}

console.log(registrationSecret);
