'use strict';

import * as vscode from 'vscode';
import { RealmFS } from './file-system-provider';
import { SynapseAuthProvider } from './synapse-auth-provider';
import { updateDiagnostics } from './diagnostics';

export async function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection('boxelrealm');

  context.subscriptions.push(diagnosticCollection);

  const authProvider = new SynapseAuthProvider(context);
  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      SynapseAuthProvider.id,
      authProvider.label,
      authProvider,
      { supportsMultipleAccounts: false },
    ),
  );

  vscode.commands.registerCommand('boxelrealm.logout', async (_) => {
    await authProvider.clearAllSessions();
    vscode.window.showInformationMessage('Logged out of synapse');
  });

  const realmFs = new RealmFS(context);

  console.log('Registering file system providers now');
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('boxelrealm', realmFs, {
      isCaseSensitive: true,
    }),
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('boxelrealm+https', realmFs, {
      isCaseSensitive: true,
    }),
  );

  // Update diagnostics when the active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        updateDiagnostics(editor.document, diagnosticCollection, realmFs);
      }
    }),
  );

  // Update diagnostics when a document is saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      updateDiagnostics(document, diagnosticCollection, realmFs);
    }),
  );

  // Clear diagnostics when a document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.delete(document.uri);
    }),
  );

  vscode.commands.registerCommand(
    'boxelrealm.attachToBoxelWorkspaces',
    async (_) => {
      if (
        !vscode.workspace.workspaceFolders ||
        vscode.workspace.workspaceFolders?.length == 0
      ) {
        realmFs.resetSelectedRealms();
      }

      const realmUrls = await realmFs.getRealmUrls();
      const selectedRealm = await vscode.window.showQuickPick(realmUrls, {
        canPickMany: false,
        placeHolder: 'Select a realm to open',
      });
      realmFs.addSelectedRealms(selectedRealm!);
      console.log('Selected realm', selectedRealm);
      vscode.workspace.updateWorkspaceFolders(
        0,
        vscode.workspace.workspaceFolders
          ? vscode.workspace.workspaceFolders.length
          : 0,
        {
          uri: vscode.Uri.parse(`boxelrealm://boxel-workspaces`),
          name: `Boxel Workspaces`,
        },
      );
      await vscode.commands.executeCommand(
        'workbench.files.action.refreshFilesExplorer',
      );
    },
  );
}
