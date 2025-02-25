import * as vscode from 'vscode';
import { createClient } from 'matrix-js-sdk';

interface AuthEntry {
  access_token: string;
  user_id: string;
  device_id: string;
}

export class SynapseAuthProvider implements vscode.AuthenticationProvider {
  static id = 'synapse';
  public label = 'Synapse Matrix';
  private _sessions: vscode.AuthenticationSession[] = [];
  private _initialized = false;
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  public readonly onDidChangeSessions = this._onDidChangeSessions.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    console.log('[SynapseAuthProvider] Constructor called');
    // Don't initialize in constructor, defer until needed
  }

  private async initialize(): Promise<void> {
    try {
      console.log('[SynapseAuthProvider] Initializing...');
      if (this._initialized) {
        console.log('[SynapseAuthProvider] Already initialized, skipping');
        return;
      }

      try {
        const storedSessions = await this.context.secrets.get(
          SynapseAuthProvider.id,
        );

        if (storedSessions) {
          console.log('[SynapseAuthProvider] Found stored sessions');
          try {
            this._sessions = JSON.parse(storedSessions);
          } catch (e) {
            console.error(
              '[SynapseAuthProvider] Error parsing stored sessions:',
              e,
            );
            // If there's an error parsing the sessions, clear them
            try {
              await this.context.secrets.delete(SynapseAuthProvider.id);
            } catch (deleteError) {
              console.error(
                '[SynapseAuthProvider] Error deleting invalid sessions:',
                deleteError,
              );
            }
            this._sessions = [];
          }
        } else {
          console.log('[SynapseAuthProvider] No stored sessions found');
          this._sessions = [];
        }
      } catch (secretsError) {
        console.error(
          '[SynapseAuthProvider] Error accessing secrets storage:',
          secretsError,
        );
        this._sessions = [];
      }

      this._initialized = true;
    } catch (error) {
      console.error('[SynapseAuthProvider] Initialization error:', error);
      // Don't throw - just log and mark as initialized with empty sessions
      this._initialized = true;
      this._sessions = [];
    }
  }

  private async storeSessions(): Promise<void> {
    try {
      console.log('[SynapseAuthProvider] Storing sessions');
      await this.context.secrets.store(
        SynapseAuthProvider.id,
        JSON.stringify(this._sessions),
      );
    } catch (error) {
      console.error('[SynapseAuthProvider] Error storing sessions:', error);
      throw error;
    }
  }

  public async getSessions(
    scopes?: string[],
  ): Promise<vscode.AuthenticationSession[]> {
    try {
      console.log('[SynapseAuthProvider] Getting sessions...');
      await this.initialize();
      return this._sessions;
    } catch (error) {
      console.error('[SynapseAuthProvider] Error getting sessions:', error);
      // Don't throw - return empty array instead to avoid breaking caller
      return [];
    }
  }

  async clearAllSessions() {
    try {
      console.log('[SynapseAuthProvider] Clearing all sessions');
      await this.context.secrets.delete(SynapseAuthProvider.id);
      this._sessions = [];
      this._onDidChangeSessions.fire({
        added: [],
        removed: this._sessions,
        changed: [],
      });
    } catch (error) {
      console.error('[SynapseAuthProvider] Error clearing sessions:', error);
      // Still clear the in-memory sessions even if storage operation failed
      this._sessions = [];
    }
  }

  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    console.log('[SynapseAuthProvider] Creating new session...');
    try {
      // Make sure we're initialized
      if (!this._initialized) {
        await this.initialize();
      }

      const serverUrl = vscode.workspace
        .getConfiguration('boxel-tools')
        .get('matrixServer') as string;

      if (!serverUrl) {
        console.error('[SynapseAuthProvider] No Matrix server URL configured');
        throw new Error(
          'No Matrix server URL configured. Please check your settings.',
        );
      }

      console.log(`[SynapseAuthProvider] Using Matrix server: ${serverUrl}`);

      // Test the server connection
      try {
        console.log('[SynapseAuthProvider] Testing server connection...');
        const versionsUrl = new URL('_matrix/client/versions', serverUrl);
        const response = await fetch(versionsUrl.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          console.error(
            `[SynapseAuthProvider] Server connection test failed: ${response.status} ${response.statusText}`,
          );
          throw new Error(
            `Cannot connect to Matrix server: ${response.status} ${response.statusText}`,
          );
        }

        const data = await response.json();
        console.log(
          '[SynapseAuthProvider] Server connection successful:',
          data,
        );
      } catch (connectionError) {
        console.error(
          '[SynapseAuthProvider] Server connection error:',
          connectionError,
        );
        throw new Error(
          `Failed to connect to Matrix server: ${
            connectionError instanceof Error
              ? connectionError.message
              : String(connectionError)
          }`,
        );
      }

      const authUrl = new URL('_matrix/client/v3/login', serverUrl);
      console.log(
        `[SynapseAuthProvider] Opening auth URL: ${authUrl.toString()}`,
      );

      const result = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        placeHolder: 'Matrix Username',
        prompt: 'Enter your Matrix username',
        title: 'Matrix Authentication',
      });

      if (!result) {
        console.log('[SynapseAuthProvider] User canceled username input');
        throw new Error('Authentication was canceled by the user');
      }

      console.log(
        '[SynapseAuthProvider] Username provided, requesting password',
      );
      const username = result;

      const password = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        password: true,
        placeHolder: 'Matrix Password',
        prompt: 'Enter your Matrix password',
        title: 'Matrix Authentication',
      });

      if (!password) {
        console.log('[SynapseAuthProvider] User canceled password input');
        throw new Error('Authentication was canceled by the user');
      }

      console.log(
        '[SynapseAuthProvider] Credentials provided, attempting login...',
      );

      try {
        const response = await fetch(authUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'm.login.password',
            user: username,
            password: password,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[SynapseAuthProvider] Login failed:', {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
          });
          throw new Error(
            `Login failed: ${response.status} ${response.statusText}`,
          );
        }

        console.log('[SynapseAuthProvider] Login successful, parsing response');
        const data = await response.json();
        console.log(
          '[SynapseAuthProvider] Received auth data:',
          JSON.stringify(data, (key, value) =>
            key === 'access_token' ? '[REDACTED]' : value,
          ),
        );

        if (!data.access_token) {
          console.error(
            '[SynapseAuthProvider] Missing access token in response',
          );
          throw new Error('Invalid response from server: missing access token');
        }

        const session: vscode.AuthenticationSession = {
          id: data.user_id,
          accessToken: JSON.stringify(data),
          account: {
            label: data.user_id,
            id: data.user_id,
          },
          scopes: [],
        };

        // Store in memory
        this._sessions = [session];

        console.log(
          '[SynapseAuthProvider] Session created successfully, storing session',
        );
        // Store in secret storage
        await this.storeSessions();

        this._onDidChangeSessions.fire({
          added: [session],
          removed: [],
          changed: [],
        });

        return session;
      } catch (error) {
        console.error('[SynapseAuthProvider] Login process error:', error);
        throw new Error(
          `Authentication failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } catch (error) {
      console.error('[SynapseAuthProvider] Create session failed:', error);
      throw error;
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    const sessionsToRemove = this._sessions.filter(
      (session) => session.id === sessionId,
    );
    if (sessionsToRemove.length === 0) {
      return;
    }
    this._sessions = this._sessions.filter(
      (session) => session.id !== sessionId,
    );

    await this.storeSessions();

    this._onDidChangeSessions.fire({
      added: [],
      removed: sessionsToRemove,
      changed: [],
    });
  }
}
