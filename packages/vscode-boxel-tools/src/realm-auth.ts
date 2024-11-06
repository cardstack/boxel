/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
  RealmAuthClient,
  RealmAuthMatrixClientInterface,
} from '@cardstack/runtime-common/realm-auth-client';
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
    if (!this.realmsInitialized) {
      console.log('No realm clients, setting up realms');
      await this.setupRealms();
    }
    console.log('Realm clients', this.realmClients, this.realmClients.keys());
    return Array.from(this.realmClients.keys());
  }

  async setupRealms() {
    const session = await vscode.authentication.getSession('synapse', [], {
      createIfNone: true,
    });
    const serverUrl = vscode.workspace
      .getConfiguration('boxel-tools')
      .get('matrixServer') as string;
    if (!serverUrl) {
      throw new Error('No matrix server url found, please check your settings');
    }
    console.log('Session:', session);
    const decodedAuth = JSON.parse(session.accessToken);
    const matrixClient = createClient({
      baseUrl: serverUrl,
      accessToken: decodedAuth.access_token,
      userId: decodedAuth.user_id,
      deviceId: decodedAuth.device_id,
    });
    let realmsEventData =
      (await matrixClient.getAccountDataFromServer(
        'com.cardstack.boxel.realms',
      )) || {};
    console.log('Realms event data:', realmsEventData, typeof realmsEventData);
    let realms = realmsEventData.realms || [];
    console.log('Realms:', realms);
    vscode.window.showInformationMessage(
      `Boxel - found ${realms.length} realms`,
    );
    for (const realm of realms) {
      console.log('new realm:', realm);
      let newRealmClient = new RealmAuthClient(
        new URL(realm),
        matrixClient as unknown as RealmAuthMatrixClientInterface,
        globalThis.fetch,
      );
      console.log('newRealmClient', newRealmClient);
      this.realmClients.set(realm, newRealmClient);
      console.log('Realm client set', realm);
    }
    console.log('Realm clients setup', this.realmClients);
    this.realmsInitialized = true;
  }

  async getJWT(url: string) {
    console.log('Getting JWT for ', url);
    if (!this.realmsInitialized) {
      await this.setupRealms();
    }
    // Find the realm client that prefixes the url
    for (const [realmUrl, realmClient] of this.realmClients.entries()) {
      if (url.startsWith(realmUrl.toString())) {
        console.log(
          'Found realm client for',
          url,
          "it's the one for",
          realmUrl,
        );
        console.log("Checking if we're currently loading one");

        if (this.jwtPromises.has(realmUrl.toString())) {
          console.log("We're already loading one, waiting");
          return this.getJwtAndDeletePromise(realmUrl.toString());
        } else {
          console.log("We're not currently loading one, creating");
          const promise = realmClient.getJWT();
          this.jwtPromises.set(realmUrl.toString(), promise);
          return promise;
        }
      }
    }
    throw new Error('No realm client found for ' + url);
  }
}
