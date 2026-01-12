import { createClient, type MatrixClient } from 'matrix-js-sdk';
import { DebugLogger } from 'matrix-js-sdk/lib/logger';
import debug from 'debug';
import { logger } from '@cardstack/runtime-common';

let log = logger('bot-core:matrix-client');

export interface BotMatrixClientConfig {
  /** Matrix homeserver URL (e.g., 'http://localhost:8008') */
  matrixUrl: string;
  /** Bot username (without @ or :server) */
  username: string;
  /** Bot password */
  password: string;
  /** Whether to enable Matrix SDK debug logging */
  enableDebugLogging?: boolean;
}

export interface BotMatrixClientResult {
  client: MatrixClient;
  userId: string;
}

/**
 * Creates and authenticates a Matrix client for a bot.
 *
 * @example
 * ```ts
 * const { client, userId } = await createBotMatrixClient({
 *   matrixUrl: 'http://localhost:8008',
 *   username: 'mybot',
 *   password: 'secret',
 * });
 * ```
 */
export async function createBotMatrixClient(
  config: BotMatrixClientConfig,
): Promise<BotMatrixClientResult> {
  const { matrixUrl, username, password, enableDebugLogging = false } = config;

  let matrixDebugLogger = enableDebugLogging
    ? new DebugLogger(debug(`matrix-js-sdk:${username}`))
    : undefined;

  let client = createClient({
    baseUrl: matrixUrl,
    logger: matrixDebugLogger,
  });

  let auth = await client.loginWithPassword(username, password).catch((e) => {
    log.error(e);
    log.info(`The matrix bot could not login to the server.
Common issues are:
- The server is not running (configured to use ${matrixUrl})
   - Check it is reachable at ${matrixUrl}/_matrix/client/versions
   - If running in development, check the docker container is running (see the boxel README)
- The bot is not registered on the matrix server
  - The bot uses the username ${username}
- The bot is registered but the password is incorrect
    `);
    throw new Error(`Failed to login as ${username}`);
  });

  let { user_id: userId } = auth;

  log.info(`Logged in as ${userId}`);

  return { client, userId };
}
