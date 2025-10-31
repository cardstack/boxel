/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { RealmAuthMatrixClientInterface } from '@cardstack/runtime-common/realm-auth-client';
import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { createClient } from 'matrix-js-sdk';

export class RealmAuth {
  realmClients: Map<string, RealmAuthClient> = new Map();
  realmsInitialized = false;
  jwtPromises: Map<string, Promise<string>> = new Map();

  async getJwtAndDeletePromise(url: string) {
    let jwt = await this.jwtPromises.get(url);
    this.jwtPromises.delete(url);
    return jwt;
  }

  async getRealmUrls() {
    try {
      if (!this.realmsInitialized) {
        console.log('No realm clients, setting up realms');
        await this.setupRealms();
      }
      console.log('Realm clients', this.realmClients, this.realmClients.keys());
      return Array.from(this.realmClients.keys());
    } catch (error) {
      console.error('Error getting realm URLs:', error);
      // Return empty array instead of hanging on error
      return [];
    }
  }

  async setupRealms() {
    try {
      // Check if we're already initialized to avoid repeated attempts
      if (this.realmsInitialized) {
        console.log('[RealmAuth] Realms already initialized, skipping setup');
        return;
      }

      console.log('[RealmAuth] Setting up realms - checking configuration');
      const serverUrl = vscode.workspace
        .getConfiguration('boxel-tools')
        .get('matrixServer') as string;

      if (!serverUrl) {
        console.error('[RealmAuth] No Matrix server URL configured');
        vscode.window
          .showErrorMessage(
            'No Matrix server URL configured. Please check your settings.',
            'Open Settings',
          )
          .then((selection) => {
            if (selection === 'Open Settings') {
              vscode.commands.executeCommand('boxel-tools.openSettings');
            }
          });

        // Mark as initialized to prevent repeated failures
        this.realmsInitialized = true;
        return;
      }

      // Get session without automatically creating one
      console.log('[RealmAuth] Checking for existing session without UI');
      let checkSessionPromise = vscode.authentication
        .getSession('synapse', [], {
          createIfNone: false,
          silent: true,
        })
        .then(
          (session) => session,
          (error) => {
            console.error('[RealmAuth] Error checking for session:', error);
            return null; // Return null on error
          },
        );

      // Use Promise.race with a timeout to avoid hanging
      let timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          console.log('[RealmAuth] Session check timed out');
          resolve(null);
        }, 5000); // 5 second timeout
      });

      let session = await Promise.race([checkSessionPromise, timeoutPromise]);

      // If no session, just mark as initialized and return gracefully
      if (!session) {
        console.log('[RealmAuth] No active session found');
        // Don't show UI here, let the user explicitly log in when needed
        this.realmsInitialized = true;
        return;
      }

      console.log('[RealmAuth] Session found, setting up clients');
      try {
        const decodedAuth = JSON.parse(session.accessToken);
        const matrixClient = createClient({
          baseUrl: serverUrl,
          accessToken: decodedAuth.access_token,
          userId: decodedAuth.user_id,
          deviceId: decodedAuth.device_id,
        });

        // Use a timeout for getting account data to avoid hanging
        const accountDataPromise = Promise.resolve().then(async () => {
          try {
            return await matrixClient.getAccountDataFromServer(
              APP_BOXEL_REALMS_EVENT_TYPE,
            );
          } catch (error: unknown) {
            console.error('[RealmAuth] Error getting account data:', error);
            return null; // Return null on error
          }
        });

        const dataTimeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => {
            console.log('[RealmAuth] Account data fetch timed out');
            resolve(null);
          }, 10000); // 10 second timeout
        });

        // Use race to implement timeout
        const realmsEventData = (await Promise.race([
          accountDataPromise,
          dataTimeoutPromise,
        ])) || { realms: undefined };

        console.log('[RealmAuth] Processing realm data:', realmsEventData);
        let realms = realmsEventData.realms || [];
        console.log('[RealmAuth] Found realms:', realms.length);

        if (realms.length === 0) {
          console.log('[RealmAuth] No realms found for user');
          // Don't show UI notification here
        }

        // Set up realm clients
        for (const realm of realms) {
          try {
            console.log(`[RealmAuth] Setting up client for realm: ${realm}`);
            let newRealmClient = new RealmAuthClient(
              new URL(realm),
              matrixClient as unknown as RealmAuthMatrixClientInterface,
              globalThis.fetch,
            );
            this.realmClients.set(realm, newRealmClient);
          } catch (error) {
            console.error(
              `[RealmAuth] Error setting up client for realm ${realm}:`,
              error,
            );
            // Continue with other realms
          }
        }
      } catch (error) {
        console.error('[RealmAuth] Error setting up Matrix client:', error);
        // Don't show UI notification here
      }

      // Always mark as initialized, even if we encountered errors
      this.realmsInitialized = true;
    } catch (error) {
      console.error('[RealmAuth] Error in setupRealms:', error);
      // Don't show UI notification here

      // Mark as initialized to prevent repeated attempts
      this.realmsInitialized = true;
    }
  }

  async getJWT(url: string) {
    console.log(`[RealmAuth] Getting JWT for URL: ${url}`);
    try {
      if (!this.realmsInitialized) {
        console.log('[RealmAuth] Realms not initialized, setting up realms');
        await this.setupRealms();
      }

      // Check if we have a client for this URL
      const client = this.realmClients.get(url);
      if (!client) {
        // Try to find a client for the base URL
        const urlObj = new URL(url);
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        console.log(
          `[RealmAuth] No client for exact URL, trying base URL: ${baseUrl}`,
        );

        const possibleBaseClient = this.realmClients.get(baseUrl);
        if (possibleBaseClient) {
          console.log(`[RealmAuth] Found client for base URL: ${baseUrl}`);
          return possibleBaseClient.getJWT();
        }

        // Check if any realm URL contains this URL as a substring
        for (const [realmUrl, realmClient] of this.realmClients.entries()) {
          if (url.startsWith(realmUrl)) {
            console.log(`[RealmAuth] Found client for parent URL: ${realmUrl}`);
            return realmClient.getJWT();
          }
        }

        console.error(`[RealmAuth] No client found for URL: ${url}`);
        throw new Error(
          `No client found for URL: ${url}. You may need to authenticate first.`,
        );
      }

      console.log(`[RealmAuth] Found client for URL: ${url}, requesting JWT`);
      if (!this.jwtPromises.has(url)) {
        console.log(`[RealmAuth] Creating new JWT promise for URL: ${url}`);
        const promise = client.getJWT();
        this.jwtPromises.set(url, promise);

        // Cleanup promise after completion
        promise
          .then((jwt) => {
            console.log(
              `[RealmAuth] JWT obtained successfully for URL: ${url}`,
            );
            this.jwtPromises.delete(url);
            return jwt;
          })
          .catch((error) => {
            console.error(
              `[RealmAuth] Error getting JWT for URL: ${url}:`,
              error,
            );
            this.jwtPromises.delete(url);
            throw error;
          });
      } else {
        console.log(`[RealmAuth] Using existing JWT promise for URL: ${url}`);
      }

      return this.jwtPromises.get(url) as Promise<string>;
    } catch (error) {
      console.error(`[RealmAuth] Error in getJWT for URL: ${url}:`, error);

      // Try auto-refreshing the session if this looks like an auth error
      if (
        error instanceof Error &&
        (error.message.includes('authentication') ||
          error.message.includes('auth') ||
          error.message.includes('login'))
      ) {
        console.log(
          '[RealmAuth] Potential authentication issue, trying to refresh session',
        );

        // Show a notification with an option to log in
        vscode.window
          .showErrorMessage(
            'Authentication required to access Boxel realms.',
            'Log in',
          )
          .then((selection) => {
            if (selection === 'Log in') {
              vscode.commands.executeCommand('boxel-tools.login');
            }
          });
      }

      throw error;
    }
  }
}
