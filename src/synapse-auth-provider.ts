import * as vscode from "vscode";
import { createClient } from "matrix-js-sdk";

interface AuthEntry {
  access_token: string;
  user_id: string;
  device_id: string;
}
async function loginWithEmail(
  email: string,
  password: string,
  matrixURL: string
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

async function login(username: string, password: string, matrixUrl: string) {
  console.log("Login with password", matrixUrl, username, password);
  try {
    let client = createClient({
      baseUrl: matrixUrl,
    });
    let login = await client.loginWithPassword(username, password);
    return login;
  } catch (error) {
    console.log("Login with password failed, trying login with email", error);
    let login = await loginWithEmail(matrixUrl, username, password);
    return login;
  }
}

export class SynapseAuthProvider implements vscode.AuthenticationProvider {
  static id = "synapse";
  label = "Synapse";

  private _sessions: vscode.AuthenticationSession[] = [];
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  onDidChangeSessions = this._onDidChangeSessions.event;
  private sessionsLoaded = false;
  private secretsStorage: vscode.SecretStorage;

  constructor(private context: vscode.ExtensionContext) {
    this.secretsStorage = context.secrets;
  }

  async clearAllSessions() {
    await this.secretsStorage.store("synapse-sessions", "[]");
    this._sessions = [];
    this._onDidChangeSessions.fire({
      added: [],
      removed: this._sessions,
      changed: [],
    });
  }

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    if (!this.sessionsLoaded) {
      this.sessionsLoaded = true;
      const existingSessions = await this.secretsStorage.get(
        "synapse-sessions"
      );
      if (existingSessions) {
        this._sessions = JSON.parse(existingSessions);
      }
    }
    return this._sessions;
  }

  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    const { username, password } = await promptForCredentials();
    const homeserverUrl = vscode.workspace
      .getConfiguration("boxelrealm")
      .get("matrixServer") as string;
    if (!homeserverUrl) {
      throw new Error("No matrix server url found, please check your settings");
    }

    const { access_token, user_id, device_id } = await login(
      username,
      password,
      homeserverUrl
    );

    const authToken = JSON.stringify({
      access_token,
      user_id,
      device_id,
    });

    const session: vscode.AuthenticationSession = {
      id: access_token,
      accessToken: authToken,
      account: { id: user_id, label: username },
      scopes,
    };

    // Only support one right now. TODO: Support multiple or handle the events properly
    // The setup elsewhere forbids this anyway
    this._sessions = [session];

    await this.secretsStorage.store(
      "synapse-sessions",
      JSON.stringify(this._sessions)
    );

    this._onDidChangeSessions.fire({
      added: [session],
      removed: [],
      changed: [],
    });

    return session;
  }

  async removeSession(sessionId: string): Promise<void> {
    const sessionsToRemove = this._sessions.filter(
      (session) => session.id === sessionId
    );
    if (sessionsToRemove.length === 0) {
      return;
    }
    this._sessions = this._sessions.filter(
      (session) => session.id !== sessionId
    );

    await this.secretsStorage.store(
      "synapse-sessions",
      JSON.stringify(this._sessions)
    );

    this._onDidChangeSessions.fire({
      added: [],
      removed: sessionsToRemove,
      changed: [],
    });
  }
}

async function promptForCredentials() {
  const username = await vscode.window.showInputBox({
    prompt: "Enter Matrix username",
  });
  if (!username) {
    throw new Error("Username is required.");
  }

  const password = await vscode.window.showInputBox({
    prompt: "Enter Matrix password",
    password: true,
  });
  if (!password) {
    throw new Error("Password is required.");
  }

  return { username, password };
}
