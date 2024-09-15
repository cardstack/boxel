"use strict";

import * as vscode from "vscode";
import { MemFS } from "./fileSystemProvider";
import { createClient } from "matrix-js-sdk";
import { RealmAuthClient } from "./auth";

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

async function setup(
  context: vscode.ExtensionContext,
  username: string,
  password: string,
  matrixUrl: string,
  realmUrl: string
) {
  console.log(
    "Setting up file system provider",
    username,
    password,
    matrixUrl,
    realmUrl
  );
  let client = await getClient(context, matrixUrl, username, password);
  let realmClient = new RealmAuthClient(new URL(realmUrl), client, fetch);
  await realmClient.getJWT();
  return realmClient;
}

export async function activate(context: vscode.ExtensionContext) {
  vscode.commands.registerCommand("boxelrealm.login", async (_) => {});

  vscode.window.showInformationMessage(`Boxel - logging in`);
  let realmUri: string;

  try {
    const username = vscode.workspace
      .getConfiguration("boxelrealm")
      .get<string>("realmUsername");
    if (!username) {
      throw new Error("Realm username not set");
    }

    const password = vscode.workspace
      .getConfiguration("boxelrealm")
      .get<string>("realmPassword");
    if (!password) {
      throw new Error("Realm password not set");
    }

    const realmClient = await setup(
      context,
      username,
      password,
      "https://matrix.boxel.ai/",
      "https://app.boxel.ai/experiments/"
    );
    const memFs = new MemFS(realmClient);
    vscode.window.showInformationMessage(
      `Boxel - logged in as ${username} on "https://app.boxel.ai/experiments/"`
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

  vscode.commands.registerCommand("boxelrealm.createWorkspace", async (_) => {
    console.log(
      "Creating workspace",
      vscode.Uri.parse(`boxelrealm+https://app.boxel.ai/experiments/`)
    );
    vscode.workspace.updateWorkspaceFolders(0, 0, {
      uri: vscode.Uri.parse(`boxelrealm+https://app.boxel.ai/experiments/`),
      name: "Experiments",
    });
  });
}
