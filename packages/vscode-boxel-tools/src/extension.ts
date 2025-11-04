'use strict';

import * as vscode from 'vscode';
import { SynapseAuthProvider } from './synapse-auth-provider';
import type { Skill } from './skills';
import { SkillsProvider } from './skills';
import { RealmAuth } from './realm-auth';
import { LocalFileSystem } from './local-file-system';
import * as fs from 'fs';
import * as path from 'path';
import type { RealmItem } from './realms';
import { RealmProvider } from './realms';

export async function activate(context: vscode.ExtensionContext) {
  const realmAuth = new RealmAuth();

  // Get stored user ID from global state if available
  let userId: string | null = context.globalState.get('boxelUserId') || null;
  console.log(
    `Boxel extension activating - using stored user ID: ${userId || 'none'}`,
  );

  // Create file system with potentially stored user ID
  const localFileSystem = new LocalFileSystem(context, realmAuth, userId);

  // Create and register the skills provider
  const skillsProvider = new SkillsProvider(
    realmAuth,
    context,
    localFileSystem,
  );
  const treeView = vscode.window.createTreeView('codingSkillList', {
    treeDataProvider: skillsProvider,
  });

  // Register event listener for checkbox state changes
  treeView.onDidChangeCheckboxState((e) => {
    // Handle checkbox state changes
    e.items.forEach((item) => {
      const treeItem = item[0];
      if ('instructions' in treeItem && 'id' in treeItem) {
        // It's a Skill
        skillsProvider.handleTreeItemCheckboxChange(treeItem as Skill);
      }
    });
  });

  // Register event listener for tree data changes
  skillsProvider.onDidChangeTreeData(() => {
    // When the tree data changes, update the .cursorrules file
    skillsProvider.updateCursorRules();
  });

  vscode.commands.registerCommand('boxel-tools.reloadSkills', () => {
    skillsProvider.refresh();
  });

  // Create and register the realm provider
  const realmProvider = new RealmProvider(realmAuth, localFileSystem, userId);
  vscode.window.createTreeView('boxelRealmList', {
    treeDataProvider: realmProvider,
  });

  // Register the SynapseAuthProvider but don't immediately trigger authentication
  const authProvider = new SynapseAuthProvider(context);
  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      SynapseAuthProvider.id,
      authProvider.label,
      authProvider,
      {
        supportsMultipleAccounts: false,
      },
    ),
  );

  // Add a status bar item to show login status and provide quick access to login
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = 'boxel-tools.login';
  statusBarItem.text = '$(account) Boxel: Sign In';
  statusBarItem.tooltip = 'Sign in to Boxel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Update status bar when we get a user ID
  function updateStatusBar() {
    if (userId) {
      statusBarItem.text = `$(account) Boxel: ${userId}`;
      statusBarItem.tooltip = `Signed in as ${userId}`;
    } else {
      statusBarItem.text = '$(account) Boxel: Sign In';
      statusBarItem.tooltip = 'Sign in to Boxel';
    }
  }

  vscode.commands.registerCommand('boxel-tools.logout', async (_) => {
    await authProvider.clearAllSessions();

    // Clear user ID
    userId = null;
    await context.globalState.update('boxelUserId', null);
    console.log('Cleared stored user ID from global state');

    localFileSystem.updateUserId(null);
    realmProvider.updateUserId(null);

    // Update status bar
    updateStatusBar();

    // Reset realms
    realmAuth.realmsInitialized = false;
    realmAuth.realmClients.clear();

    vscode.window.showInformationMessage('Logged out of Boxel');

    // Refresh views
    realmProvider.refresh();
  });

  // Register command to open extension settings
  vscode.commands.registerCommand('boxel-tools.openSettings', async () => {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'boxel-tools',
    );
  });

  // Register command to manually log in to Boxel
  vscode.commands.registerCommand('boxel-tools.login', async () => {
    try {
      // Show welcome message for new users
      vscode.window
        .showInformationMessage(
          'Welcome to Boxel Tools! This extension helps you work with Boxel workspaces. You will now be prompted to log in to your Boxel account.',
          'Continue',
        )
        .then(async (selection) => {
          if (selection === 'Continue') {
            await doLogin();
          }
        });
    } catch (error) {
      handleLoginError(error);
    }
  });

  // Helper function to perform login
  async function doLogin() {
    try {
      vscode.window.showInformationMessage('Logging in to Boxel...');
      const session = await vscode.authentication.getSession('synapse', [], {
        createIfNone: true,
        silent: false,
      });

      if (session) {
        const authData = JSON.parse(session.accessToken);
        userId = authData.user_id;
        console.log(`Authenticated as Boxel user: ${userId}`);
        vscode.window.showInformationMessage(`Logged in as ${userId}`);

        // Store the user ID in global state for persistence
        await context.globalState.update('boxelUserId', userId);
        console.log(`Saved user ID ${userId} to global state`);

        // Update the user ID in the LocalFileSystem and RealmProvider
        localFileSystem.updateUserId(userId);
        realmProvider.updateUserId(userId);

        // Update status bar with new user ID
        updateStatusBar();

        // Reset realm initialization and trigger a search for workspaces
        realmAuth.realmsInitialized = false;
        await vscode.commands.executeCommand('boxel-tools.pullFromRemote');
      }
    } catch (error) {
      handleLoginError(error);
    }
  }

  // Helper function to handle login errors
  function handleLoginError(error: unknown) {
    if (error instanceof Error && error.name === 'Canceled') {
      console.log('Authentication was canceled by the user');
      vscode.window.showInformationMessage(
        'Authentication canceled. You can try again later using the "Boxel: Log in" command.',
      );
    } else {
      console.error('Login error:', error);
      vscode.window
        .showErrorMessage(
          `Error logging in: ${
            error instanceof Error ? error.message : String(error)
          }. Try using the "Check Server Connection" command to troubleshoot.`,
          'Check Connection',
        )
        .then((selection) => {
          if (selection === 'Check Connection') {
            vscode.commands.executeCommand('boxel-tools.checkMatrixConnection');
          }
        });
    }
  }

  // Helper function to extract a workspace name from a URL
  function extractRealmNameFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);

      // Get all path segments that aren't empty
      const pathSegments = parsedUrl.pathname.split('/').filter((p) => p);

      // For boxel.ai URLs, we need to get the workspace name which is typically the last segment
      // after the account name
      if (parsedUrl.hostname.includes('boxel.ai') && pathSegments.length >= 1) {
        // Get the last segment as the workspace name
        return pathSegments[pathSegments.length - 1] || 'unknown-workspace';
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

  // Register a command to find all workspaces and create directories for them
  vscode.commands.registerCommand('boxel-tools.pullFromRemote', async () => {
    try {
      // Show progress indicator while finding workspaces
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Finding Boxel workspaces...',
          cancellable: false,
        },
        async (progress) => {
          // Get all available workspace URLs
          const realmUrls = await realmAuth.getRealmUrls();
          console.log('Found workspace URLs:', realmUrls);

          if (realmUrls.length === 0) {
            vscode.window.showInformationMessage(
              'No Boxel workspaces found for your account.',
            );
            return;
          }

          progress.report({ message: `Found ${realmUrls.length} workspaces` });

          // Process each workspace to create a folder without syncing files
          for (let i = 0; i < realmUrls.length; i++) {
            const realmUrl = realmUrls[i];
            progress.report({
              message: `Processing workspace ${i + 1} of ${realmUrls.length}`,
              increment: 100 / realmUrls.length,
            });

            // Get workspace name - try API endpoints first, then fallback to URL extraction
            let realmName: string;
            try {
              // First try the API endpoint
              const realmInfoUrl = new URL('api/realm-info', realmUrl);
              const realmNameResponse = await fetch(realmInfoUrl.toString(), {
                headers: {
                  Accept: 'application/json',
                  Authorization: `${await realmAuth.getJWT(realmUrl)}`,
                },
              });

              if (realmNameResponse.ok) {
                const realmInfo = await realmNameResponse.json();
                realmName =
                  realmInfo.data?.attributes?.name ||
                  extractRealmNameFromUrl(realmUrl);
              } else {
                // Fallback to alternative endpoints
                try {
                  const altRealmUrl = new URL('api/realm', realmUrl);
                  const altResponse = await fetch(altRealmUrl.toString(), {
                    headers: {
                      Accept: 'application/json',
                      Authorization: `${await realmAuth.getJWT(realmUrl)}`,
                    },
                  });

                  if (altResponse.ok) {
                    const altInfo = await altResponse.json();
                    realmName =
                      altInfo.data?.attributes?.name ||
                      extractRealmNameFromUrl(realmUrl);
                  } else {
                    realmName = extractRealmNameFromUrl(realmUrl);
                  }
                } catch (error) {
                  console.error(
                    'Error fetching workspace name from alt endpoint:',
                    error,
                  );
                  realmName = extractRealmNameFromUrl(realmUrl);
                }
              }
            } catch (error) {
              console.error('Error fetching workspace name:', error);
              realmName = extractRealmNameFromUrl(realmUrl);
            }

            // Create the local folder and metadata file without syncing files
            const localPath = localFileSystem.getLocalPathForRealm(
              realmUrl,
              realmName,
            );

            // Create metadata file
            createMetadataFile(localPath, realmUrl, realmName);

            console.log(
              `Created folder for workspace: ${realmName} at ${localPath}`,
            );
          }

          // Refresh realm mappings to ensure all new workspaces are tracked
          localFileSystem.refreshRealmMappings();

          // Refresh the workspace list view to show the new workspaces
          realmProvider.refresh();

          vscode.window
            .showInformationMessage(
              `Found ${realmUrls.length} Boxel workspaces. Select a workspace in the Boxel Workspaces panel and click the pull button to download files.`,
              'Add Workspaces to VS Code',
            )
            .then((selection) => {
              if (selection === 'Add Workspaces to VS Code') {
                vscode.commands.executeCommand(
                  'boxel-tools.addRealmsToWorkspace',
                );
              }
            });
        },
      );
    } catch (error) {
      console.error('Error in pullFromRemote:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Error finding workspaces: ${errorMessage}`,
      );
    }
  });

  // Helper function to create the workspace metadata file
  function createMetadataFile(
    localPath: string,
    realmUrl: string,
    realmName: string,
  ): void {
    const metadataPath = path.join(localPath, '.boxel-realm.json');
    const metadata = {
      realmUrl,
      realmName,
      lastSync: null, // No files synced yet
      fileWatchingEnabled: false,
      // Only include userId if it exists
      ...(userId ? { userId } : {}),
    };

    try {
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      console.log(`Created workspace metadata file at ${metadataPath}`);
    } catch (error) {
      console.error(`Error creating metadata file: ${error}`);
    }
  }

  // Register command to add workspaces folder to workspace
  vscode.commands.registerCommand(
    'boxel-tools.addRealmsToWorkspace',
    async () => {
      try {
        // Get the base storage path without user nesting
        const rootPath = localFileSystem.getLocalStoragePath();

        if (!fs.existsSync(rootPath)) {
          vscode.window.showErrorMessage(
            'No Boxel workspaces found. Please use "Boxel: Find Boxel Workspaces" first to discover your workspaces.',
          );
          return;
        }

        // Check if there are any workspace folders
        const workspaceFolders = fs.readdirSync(rootPath);
        if (workspaceFolders.length === 0) {
          vscode.window.showErrorMessage(
            'No Boxel workspaces found. Please use "Boxel: Find Boxel Workspaces" first to discover your workspaces.',
          );
          return;
        }

        // Create a workspace folder from the root path
        const rootUri = vscode.Uri.file(rootPath);

        // Check if this folder is already in the workspace
        const existingFolders = vscode.workspace.workspaceFolders || [];
        const alreadyExists = existingFolders.some(
          (folder) => folder.uri.fsPath === rootUri.fsPath,
        );

        if (alreadyExists) {
          vscode.window.showInformationMessage(
            'Boxel workspaces are already added to your VS Code workspace.',
          );
          return;
        }

        // Add folder to workspace
        const folderName = userId
          ? `Boxel Workspaces (${userId})`
          : 'Boxel Workspaces';
        const added = await vscode.workspace.updateWorkspaceFolders(
          existingFolders.length, // Add at the end
          0, // Don't remove any
          { uri: rootUri, name: folderName },
        );

        if (added) {
          vscode.window.showInformationMessage(
            'Added Boxel workspaces to your VS Code workspace. You can now access your workspaces in the Explorer.',
          );
        } else {
          vscode.window.showErrorMessage(
            'Failed to add Boxel workspaces to your VS Code workspace. Please try again.',
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Error adding workspaces to VS Code: ${errorMessage}`,
        );
      }
    },
  );

  // Register command to enable file watching for a workspace
  vscode.commands.registerCommand(
    'boxel-tools.enableFileWatching',
    async (item: RealmItem) => {
      if (item && item.localPath) {
        // Refresh realm mappings first to ensure we have all the latest data
        localFileSystem.refreshRealmMappings();
        // Then enable file watching
        localFileSystem.enableFileWatching(item.localPath);
        realmProvider.refresh();
      }
    },
  );

  // Register command to disable file watching for a workspace
  vscode.commands.registerCommand(
    'boxel-tools.disableFileWatching',
    async (item: RealmItem) => {
      if (item && item.localPath) {
        localFileSystem.disableFileWatching(item.localPath);
        realmProvider.refresh();
      }
    },
  );

  // Register command to pull changes for a specific workspace
  vscode.commands.registerCommand(
    'boxel-tools.pullBoxelWorkspace',
    async (item: RealmItem) => {
      if (item && item.localPath) {
        // We don't need an additional progress bar here because pullChangesFromPath
        // now implements its own progress reporting via pullFromRemote
        await localFileSystem.pullChangesFromPath(item.localPath);
        realmProvider.refresh();
      }
    },
  );

  // Register command to push changes for a specific workspace
  vscode.commands.registerCommand(
    'boxel-tools.pushBoxelWorkspace',
    async (item: RealmItem) => {
      if (item && item.localPath) {
        // Push all changes for this workspace
        await localFileSystem.pushChangesFromPath(item.localPath);
        realmProvider.refresh();
      }
    },
  );

  // Register command to attachToBoxelWorkspaces (redirecting to pullFromRemote)
  vscode.commands.registerCommand(
    'boxel-tools.attachToBoxelWorkspaces',
    async () => {
      await vscode.commands.executeCommand('boxel-tools.pullFromRemote');
    },
  );

  // Register command to check Matrix server configuration
  vscode.commands.registerCommand(
    'boxel-tools.checkMatrixConnection',
    async () => {
      try {
        vscode.window.showInformationMessage(
          'Checking Boxel server connection...',
        );

        // Get server URL from configuration
        const serverUrl = vscode.workspace
          .getConfiguration('boxel-tools')
          .get('matrixServer') as string;

        if (!serverUrl) {
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
          return;
        }

        // Test server connection
        try {
          const url = new URL('_matrix/client/versions', serverUrl);
          const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
          });

          if (!response.ok) {
            vscode.window
              .showErrorMessage(
                `Cannot connect to Matrix server: ${response.status} ${response.statusText}`,
                'Check Settings',
              )
              .then((selection) => {
                if (selection === 'Check Settings') {
                  vscode.commands.executeCommand('boxel-tools.openSettings');
                }
              });
            return;
          }

          const data = await response.json();
          vscode.window
            .showInformationMessage(
              `Connected to Boxel auth server (${
                data.versions?.length || 0
              } versions supported)`,
              'Try Login',
            )
            .then((selection) => {
              if (selection === 'Try Login') {
                vscode.commands.executeCommand('boxel-tools.login');
              }
            });
        } catch (error) {
          console.error('Matrix server connection test failed:', error);
          vscode.window
            .showErrorMessage(
              `Failed to connect to Boxel auth server: ${
                error instanceof Error ? error.message : String(error)
              }`,
              'Check Settings',
            )
            .then((selection) => {
              if (selection === 'Check Settings') {
                vscode.commands.executeCommand('boxel-tools.openSettings');
              }
            });
        }
      } catch (error) {
        console.error('Error checking Matrix server:', error);
        vscode.window.showErrorMessage(
          `Error checking Boxel auth server: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );

  // Try to silently retrieve the current session (after we already have the stored ID)
  async function trySilentSessionRefresh() {
    try {
      // Only try this if we already have a stored user ID
      if (userId) {
        console.log('Attempting to silently refresh Matrix session...');
        const session = await vscode.authentication.getSession('synapse', [], {
          createIfNone: false,
          silent: true,
        });

        if (session) {
          const authData = JSON.parse(session.accessToken);
          console.log(`Silently refreshed session for ${authData.user_id}`);

          // If the session has a different user than our stored one, update it
          if (authData.user_id !== userId) {
            console.log(
              `User ID from session (${authData.user_id}) differs from stored ID (${userId}), updating...`,
            );
            userId = authData.user_id;
            await context.globalState.update('boxelUserId', userId);
            localFileSystem.updateUserId(userId);
            realmProvider.updateUserId(userId);
            updateStatusBar();
          }
        } else {
          console.log('No active session found during silent refresh');
        }
      }
    } catch (error) {
      // Don't show UI for this silent operation
      console.log('Silent session refresh failed:', error);
    }
  }

  // Try to refresh the session silently during activation
  trySilentSessionRefresh();

  // Initial status bar update
  updateStatusBar();

  // Make sure we clean up the file watchers when the extension is deactivated
  context.subscriptions.push({
    dispose: () => {
      localFileSystem.dispose();
    },
  });
}
