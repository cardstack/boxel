/* eslint-env node */

import { getLocalConfig } from '../synapse.ts';

let registrationSecret = getLocalConfig()?.registration_shared_secret ?? '';
console.log(registrationSecret);
