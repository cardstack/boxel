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
  [username: string]: AuthEntry;
};

async function getClient(
  context: vscode.ExtensionContext,
  matrixUrl: string,
  username: string,
  password: string
) {
  let storedAuth = await context.secrets.get("auth");
  let auth: AuthStore = {};
  if (storedAuth) {
    try {
      auth = JSON.parse(storedAuth);
    } catch (error) {
      console.log("Failed to parse stored auth, logging in again");
    }
  }
  if (auth[username]) {
    try {
      let { access_token, user_id, device_id } = auth[username];
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
    auth[username] = await client.loginWithPassword(username, password);
    // Update the auth store with the new login details
    context.secrets.store("auth", JSON.stringify(auth));
    return client;
  } catch (error) {
    console.log("Login with password failed, trying login with email");
    auth[username] = await loginWithEmail(matrixUrl, username, password);
    // Update the auth store with the new login details
    context.secrets.store("auth", JSON.stringify(auth));
    let {
      access_token: accessToken,
      user_id: userId,
      device_id: deviceId,
    } = auth[username];
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
  vscode.window.showInformationMessage(`Boxel - logging in`);
  let realmUri: string;

  try {
    let realmUrl = vscode.workspace
      .getConfiguration("boxelrealm")
      .get<string>("realmUrl");
    if (!realmUrl) {
      throw new Error("Realm URL not set");
    }
    realmUri = "boxelrealm+" + realmUrl;

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

    const matrixUrl = vscode.workspace
      .getConfiguration("boxelrealm")
      .get<string>("matrixUrl");
    if (!matrixUrl) {
      throw new Error("Matrix URL not set");
    }

    const realmClient = await setup(
      context,
      username,
      password,
      matrixUrl,
      realmUrl
    );
    const memFs = new MemFS(realmClient);
    vscode.window.showInformationMessage(
      `Boxel - logged in as ${username} on ${realmUrl}`
    );
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

  context.subscriptions.push(
    vscode.commands.registerCommand("boxelrealm.workspaceInit", async (_) => {
      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse(realmUri),
        name: "Realm",
      });
    })
  );
}
