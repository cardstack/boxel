import { cfgDirFromTemplate, createRegistrationToken, loginUser } from '../docker/synapse';
import { adminUsername, adminPassword } from './register-test-user';

(async () => {
  return new Promise<void>(async (resolve, reject) => {
    try {
      let synapseCofig = await cfgDirFromTemplate('dev');
      let synapseInstance = { 
        mappedPort: 8008,
        synapseId: '', 
        ...synapseCofig,
      }
      let cred = await loginUser(synapseInstance, adminUsername, adminPassword);
      await createRegistrationToken(synapseInstance, cred.accessToken, 'dev-token');
      resolve();
    } catch(e: any) {
      if (!e.message.includes('Token already exists')) {
        reject(e);
      }
    }
  });
})().catch((e) => console.error(`unexpected error`, e));
