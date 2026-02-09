import { registerRealmUser } from './register-realm-user-using-api';

const realmServerURL = process.env.REALM_SERVER_URL || 'http://localhost:4201';

async function addBotRegistration(jwt: string, matrixUserId: string) {
  const response = await fetch(`${realmServerURL}/_bot-registration`, {
    method: 'POST',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'bot-registration',
        attributes: {
          username: matrixUserId,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to register bot: ${response.status} ${text}`);
  }
}

(async () => {
  const { jwt, userId } = await registerRealmUser();
  await addBotRegistration(jwt, userId);
  console.log(`Added bot registration for ${userId}`);
})().catch((error) => {
  console.error('add-bot-registration failed', error);
  process.exit(1);
});
