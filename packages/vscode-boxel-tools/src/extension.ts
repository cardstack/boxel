'use strict';

import * as vscode from 'vscode';
import { RealmFS } from './file-system-provider';
import { SynapseAuthProvider } from './synapse-auth-provider';
import { updateDiagnostics } from './diagnostics';
import { SkillsProvider } from './skills';
import { RealmAuth } from './realm-auth';
import { LocalFileSystem } from './local-file-system';
import * as fs from 'fs';
import * as path from 'path';
import { RealmProvider, RealmItem } from './realms';

export async function activate(context: vscode.ExtensionContext) {
  const realmAuth = new RealmAuth();
  const localFileSystem = new LocalFileSystem(context, realmAuth);

  // Create and register the skills provider
  const skillsProvider = new SkillsProvider(realmAuth);
  vscode.window.createTreeView('codingSkillList', {
    treeDataProvider: skillsProvider,
  });
  vscode.commands.registerCommand('boxel-tools.reloadSkills', () => {
    skillsProvider.refresh();
  });

  // Create and register the realm provider
  const realmProvider = new RealmProvider(realmAuth, localFileSystem);
  vscode.window.createTreeView('boxelRealmList', {
    treeDataProvider: realmProvider,
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

  // Register command to open extension settings
  vscode.commands.registerCommand('boxel-tools.openSettings', async () => {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'boxel-tools',
    );
  });

  // Helper function to extract a realm name from a URL
  function extractRealmNameFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);

      // Get all path segments that aren't empty
      const pathSegments = parsedUrl.pathname.split('/').filter((p) => p);

      // For boxel.ai URLs, we need to get the realm name which is typically the last segment
      // after the account name
      if (parsedUrl.hostname.includes('boxel.ai') && pathSegments.length >= 1) {
        // Get the last segment as the realm name
        return pathSegments[pathSegments.length - 1] || 'unknown-realm';
      }

      // For other URLs, use the previous approach as fallback
      // Try to get a meaningful name from the hostname
      let hostname = parsedUrl.hostname;
      hostname = hostname.replace(/^www\.|^api\.|^realm-/, '');

      // If there's a path, use the last segment as part of the name
      const lastPathSegment = pathSegments[pathSegments.length - 1];

      return lastPathSegment ? `${hostname}-${lastPathSegment}` : hostname;
    } catch (e) {
      // If URL parsing fails, just return a sanitized version of the URL
      return url.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
  }

  // Register a command to manually sync a realm from remote to local
  vscode.commands.registerCommand('boxel-tools.syncFromRemote', async () => {
    const realmUrls = await realmAuth.getRealmUrls();
    const selectedRealm = await vscode.window.showQuickPick(realmUrls, {
      canPickMany: false,
      placeHolder: 'Select a realm to sync',
    });

    if (!selectedRealm) {
      return;
    }

    // Get realm name
    try {
      let realmName: string;

      try {
        // First try the API endpoint
        const realmNameResponse = await fetch(
          `${selectedRealm}/api/realm-info`,
          {
            headers: {
              Accept: 'application/json',
              Authorization: `${await realmAuth.getJWT(selectedRealm)}`,
            },
          },
        );

        if (realmNameResponse.ok) {
          const realmInfo = await realmNameResponse.json();
          realmName =
            realmInfo.data?.attributes?.name ||
            extractRealmNameFromUrl(selectedRealm);
        } else {
          // Fallback to alternative endpoints
          try {
            // Try another common endpoint
            const altResponse = await fetch(`${selectedRealm}/api/realm`, {
              headers: {
                Accept: 'application/json',
                Authorization: `${await realmAuth.getJWT(selectedRealm)}`,
              },
            });

            if (altResponse.ok) {
              const altInfo = await altResponse.json();
              realmName =
                altInfo.data?.attributes?.name ||
                extractRealmNameFromUrl(selectedRealm);
            } else {
              // Resort to extracting from URL
              realmName = extractRealmNameFromUrl(selectedRealm);
            }
          } catch {
            // If all API attempts fail, use URL extraction
            realmName = extractRealmNameFromUrl(selectedRealm);
          }
        }
      } catch {
        // If API fetch fails completely, use URL extraction
        realmName = extractRealmNameFromUrl(selectedRealm);
      }

      // Show progress indicator while syncing
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Syncing realm ${realmName}...`,
          cancellable: false,
        },
        async () => {
          await localFileSystem.syncFromRemote(selectedRealm, realmName);

          // Open the local folder in VSCode
          const localPath = localFileSystem.getLocalPathForRealm(
            selectedRealm,
            realmName,
          );

          // Refresh the realm list view
          realmProvider.refresh();

          const openFolder = await vscode.window.showInformationMessage(
            `Realm "${realmName}" synced to ${localPath}. Do you want to open this folder?`,
            'Open Folder',
            'Cancel',
          );

          if (openFolder === 'Open Folder') {
            const uri = vscode.Uri.file(localPath);
            await vscode.commands.executeCommand('vscode.openFolder', uri, {
              forceNewWindow: false,
            });
          }
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error syncing realm: ${errorMessage}`);
    }
  });

  // Register command to enable file watching for a realm
  vscode.commands.registerCommand(
    'boxel-tools.enableFileWatching',
    async (item: RealmItem) => {
      if (item && item.localPath) {
        localFileSystem.enableFileWatching(item.localPath);
        realmProvider.refresh();
      }
    },
  );

  // Register command to disable file watching for a realm
  vscode.commands.registerCommand(
    'boxel-tools.disableFileWatching',
    async (item: RealmItem) => {
      if (item && item.localPath) {
        localFileSystem.disableFileWatching(item.localPath);
        realmProvider.refresh();
      }
    },
  );

  // Register command to sync a specific realm
  vscode.commands.registerCommand(
    'boxel-tools.syncRealm',
    async (item: RealmItem) => {
      if (item && item.localPath) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Syncing realm ${item.realmName}...`,
            cancellable: false,
          },
          async () => {
            await localFileSystem.syncRealmFromPath(item.localPath);
            realmProvider.refresh();
          },
        );
      }
    },
  );

  // Register command to attachToBoxelWorkspaces (redirecting to syncFromRemote)
  vscode.commands.registerCommand(
    'boxel-tools.attachToBoxelWorkspaces',
    async () => {
      await vscode.commands.executeCommand('boxel-tools.syncFromRemote');
    },
  );

  // Make sure we clean up the file watchers when the extension is deactivated
  context.subscriptions.push({
    dispose: () => {
      localFileSystem.dispose();
    },
  });
}
