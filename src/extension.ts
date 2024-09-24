"use strict";

import * as vscode from "vscode";
import { MemFS } from "./fileSystemProvider";
import { SynapseAuthProvider } from "./synapse-auth-provider";

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
}
