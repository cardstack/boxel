import { registerRealmUser } from './register-realm-user-using-api';

const realmServerURL = process.env.REALM_SERVER_URL || 'http://localhost:4201';

const commandURL = 'https://example.com/bot/command/default';
const commandFilter = {
  type: 'matrix-event',
  event_type: 'app.boxel.bot-trigger',
  content_type: 'create-listing-pr',
};

async function fetchBotRegistrations(jwt: string) {
  const response = await fetch(`${realmServerURL}/_bot-registrations`, {
    method: 'GET',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to list bot registrations: ${response.status} ${text}`,
    );
  }

  const json = await response.json();
  return json?.data ?? [];
}

async function createBotRegistration(jwt: string, matrixUserId: string) {
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

  const json = await response.json();
  return json?.data?.id;
}

async function ensureBotRegistration(jwt: string, matrixUserId: string) {
  const registrations = await fetchBotRegistrations(jwt);
  const existing = registrations.find(
    (entry: any) => entry?.attributes?.username === matrixUserId,
  );
  if (existing?.id) {
    return existing.id as string;
  }
  return createBotRegistration(jwt, matrixUserId);
}

async function addBotCommand(jwt: string, botId: string) {
  const response = await fetch(`${realmServerURL}/_bot-commands`, {
    method: 'POST',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'bot-command',
        attributes: {
          botId,
          command: commandURL,
          filter: commandFilter,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to add bot command: ${response.status} ${text}`);
  }
}

async function fetchBotCommands(jwt: string, botId?: string) {
  const url = new URL(`${realmServerURL}/_bot-commands`);
  if (botId) {
    url.searchParams.set('botId', botId);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list bot commands: ${response.status} ${text}`);
  }

  const json = await response.json();
  return json?.data ?? [];
}

async function ensureBotCommandId(jwt: string, botId: string) {
  const commands = await fetchBotCommands(jwt, botId);
  const existing = commands.find(
    (entry: any) =>
      entry?.attributes?.command === commandURL &&
      JSON.stringify(entry?.attributes?.filter) === JSON.stringify(commandFilter),
  );
  if (existing?.id) {
    return existing.id as string;
  }
  await addBotCommand(jwt, botId);
  return undefined;
}

// registerRealmUser is idempotent: it logs in and ensures the realm user exists.
(async () => {
  const { jwt, userId } = await registerRealmUser();
  const botRegistrationId = await ensureBotRegistration(jwt, userId);
  if (!botRegistrationId) {
    throw new Error('Bot registration did not return an id');
  }
  await ensureBotCommandId(jwt, botRegistrationId);
  console.log(`Submission bot setup complete for ${userId}`);
})().catch((error) => {
  console.error('setup-submission-bot failed', error);
  process.exit(1);
});
