// Seals every incoming webhook signing secret still held only in plain text,
// then logs the plaintext census: the same pass the realm server runs at
// startup, on demand. `runSealingPass` says where the data key comes from,
// which databases the local development key is accepted for, and what
// `--reseal-tampered` does.

import '../setup-logger.ts';
import { runSealingPass } from './lib/sealing-pass.ts';
import { sealIncomingWebhookSecrets } from '../lib/incoming-webhook-secrets.ts';

runSealingPass('incoming webhook signing secrets', (dbAdapter, options) =>
  sealIncomingWebhookSecrets(dbAdapter, undefined, options),
);
