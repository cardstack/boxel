'use strict';

import * as vscode from 'vscode';
import { RealmFS } from './file-system-provider';
import { SynapseAuthProvider } from './synapse-auth-provider';
import { updateDiagnostics } from './diagnostics';
import { SkillsProvider } from './skills';
import { RealmAuth } from './realm-auth';

export async function activate(context: vscode.ExtensionContext) {
  const realmAuth = new RealmAuth();

  const skillsProvider = new SkillsProvider(realmAuth);
  vscode.window.createTreeView('codingSkillList', {
    treeDataProvider: skillsProvider,
  });
  vscode.commands.registerCommand('boxel-tools.reloadSkills', () => {
    skillsProvider.refresh();
  });

  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection('boxel-tools');

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

  vscode.commands.registerCommand('boxel-tools.logout', async (_) => {
    await authProvider.clearAllSessions();
    vscode.workspace.updateWorkspaceFolders(
      0,
      vscode.workspace.workspaceFolders?.length ?? 0,
    );
    vscode.window.showInformationMessage('Logged out of synapse');
  });

  const realmFs = new RealmFS(context, realmAuth, skillsProvider);

  console.log('Registering file system providers now');
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('boxel-tools', realmFs, {
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

  // In the current implementation, we need to store the selected realms in global state
  // because adding the root folder "Boxel Workspaces"
  // will reactivate the extension, causing realmFs to be reinitialized.
  // If we don't make the state persistent, no realms will open after the user selects them.
  // An alternative approach is to add the root folder first
  // and retrigger the attachToBoxelWorkspaces command upon the second reactivation,
  // allowing the user to select realms after the root folder exists. However, this approach may be more confusing.
  vscode.commands.registerCommand(
    'boxel-tools.attachToBoxelWorkspaces',
    async (_) => {
      const realmUrls = await realmAuth.getRealmUrls();
      if (
        !vscode.workspace.workspaceFolders ||
        vscode.workspace.workspaceFolders?.length == 0
      ) {
        realmFs.resetSelectedRealms();
      }

      const selectedRealm = await vscode.window.showQuickPick(realmUrls, {
        canPickMany: false,
        placeHolder: 'Select a realm to open',
      });
      if (!selectedRealm) {
        return;
      }
      realmFs.addSelectedRealms(selectedRealm);
      console.log('Selected realm', selectedRealm);
      vscode.workspace.updateWorkspaceFolders(
        0,
        vscode.workspace.workspaceFolders
          ? vscode.workspace.workspaceFolders.length
          : 0,
        {
          uri: vscode.Uri.parse(`boxel-tools://boxel-workspaces`),
          name: `Boxel Workspaces`,
        },
      );
      await vscode.commands.executeCommand(
        'workbench.files.action.refreshFilesExplorer',
      );
    },
  );
}
