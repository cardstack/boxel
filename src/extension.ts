"use strict";

import * as vscode from "vscode";
import { MemFS } from "./fileSystemProvider";
import { createClient } from "matrix-js-sdk";
import { RealmAuthClient } from "./auth";
import { SynapseAuthProvider } from "./synapse-auth-provider";

async function loginWithEmail(
  matrixURL: string,
  email: string,
  password: string
) {
  matrixURL = matrixURL.endsWith("/") ? matrixURL : matrixURL + "/";
  let response = await fetch(`${matrixURL}_matrix/client/v3/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifier: {
        type: "m.id.thirdparty",
        medium: "email",
        address: email,
      },
      password,
      type: "m.login.password",
    }),
  });
  if (response.ok) {
    return (await response.json()) as AuthEntry;
  } else {
    let data = (await response.json()) as { errcode: string; error: string };
    let error = new Error(data.error) as any;
    error.data = data;
    error.status = response.status;
    throw error;
  }
}

interface AuthEntry {
  access_token: string;
  user_id: string;
  device_id: string;
}

type AuthStore = {
  [matrixUrl: string]: {
    [username: string]: AuthEntry;
  };
};

async function getClient(
  context: vscode.ExtensionContext,
  matrixUrl: string,
  username: string,
  password: string
) {
  // Try and get a known access token for this user on this matrix instance
  let storedAuth = await context.secrets.get("auth");
  let auth: AuthStore = {};
  if (storedAuth) {
    try {
      auth = JSON.parse(storedAuth);
    } catch (error) {
      console.log("Failed to parse stored auth, logging in again");
    }
  }
  // If we've never signed into this matrix instance before, create an entry for it
  if (!auth[matrixUrl]) {
    auth[matrixUrl] = {};
  }
  // If we've already signed into this matrix instance before, try and use the stored credentials
  // this avoids creating lots of logins and devices, and hitting rate limits
  if (auth[matrixUrl][username]) {
    try {
      let { access_token, user_id, device_id } = auth[matrixUrl][username];
      return createClient({
        baseUrl: matrixUrl,
        accessToken: access_token,
        userId: user_id,
        deviceId: device_id,
      });
    } catch (error) {
      console.log(
        "Failed to create client with stored auth, logging in with password"
      );
    }
  }

  try {
    let client = createClient({
      baseUrl: matrixUrl,
    });
    auth[matrixUrl][username] = await client.loginWithPassword(
      username,
      password
    );
    // Update the auth store with the new login details
    context.secrets.store("auth", JSON.stringify(auth));
    return client;
  } catch (error) {
    console.log("Login with password failed, trying login with email");
    let login = await loginWithEmail(matrixUrl, username, password);
    auth[matrixUrl][username] = login;
    // Update the auth store with the new login details
    context.secrets.store("auth", JSON.stringify(auth));
    let {
      access_token: accessToken,
      user_id: userId,
      device_id: deviceId,
    } = auth[matrixUrl][username];
    return createClient({
      baseUrl: matrixUrl,
      accessToken,
      userId,
      deviceId,
    });
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const authProvider = new SynapseAuthProvider(context);
  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      SynapseAuthProvider.id,
      authProvider.label,
      authProvider,
      { supportsMultipleAccounts: false }
    )
  );

  vscode.commands.registerCommand("boxelrealm.logout", async (_) => {
    await authProvider.clearAllSessions();
    vscode.window.showInformationMessage("Logged out of synapse");
  });

  const memFs = new MemFS();

  console.log("Registering file system providers now");
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("boxelrealm+http", memFs, {
      isCaseSensitive: true,
    })
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("boxelrealm+https", memFs, {
      isCaseSensitive: true,
    })
  );

  vscode.commands.registerCommand("boxelrealm.createWorkspace", async (_) => {
    let realmList = (await memFs.getRealmUrls()).map((url) => ({
      uri: vscode.Uri.parse(`boxelrealm+${url}`),
      name: `realm-${url}`,
    }));
    console.log("Realm list", realmList);
    vscode.workspace.updateWorkspaceFolders(0, 0, ...realmList);
  });
  /*

  const matrixClient = await getClient(
    context,
    "http://localhost:8008/",
    username,
    password
  );
  vscode.window.showInformationMessage(`Boxel - logged in to matrix`);

  let realmsEventData =
    (await matrixClient.getAccountDataFromServer(
      "com.cardstack.boxel.realms"
    )) || {};
  console.log("Realms event data:", realmsEventData, typeof realmsEventData);
  let realms = realmsEventData.realms || [];
  vscode.window.showInformationMessage(`Boxel - found ${realms.length} realms`);
  if (realms.length === 0) {
    throw new Error("No realms found");
  }
  firstRealm = realms[0];
  vscode.window.showInformationMessage(`Boxel - using realm ${firstRealm}`);
  try {
    console.log("Secrets storage", context.secrets.get);
    const memFs = new MemFS(matrixClient, [firstRealm], context.secrets);
    vscode.window.showInformationMessage(
      `Boxel - logged in as ${username} on "${firstRealm}"`
    );
    console.log("Registering file system providers now");
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider("boxelrealm+http", memFs, {
        isCaseSensitive: true,
      })
    );
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider("boxelrealm+https", memFs, {
        isCaseSensitive: true,
      })
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Boxel - login failed: ${error}`);
    throw error;
  }

  */
}
