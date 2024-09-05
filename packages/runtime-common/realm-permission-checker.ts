import { MatrixClient } from './matrix-client';
import { RealmPermissions } from './realm';

export interface RealmPermissionChecker {
  for(username: string): Promise<('read' | 'write')[]>;
  can(username: string, action: 'read' | 'write'): Promise<boolean>;
}

export interface RealmPermissionCheckerFactory {
  create(
    realmPermissions: RealmPermissions,
    matrixClient: MatrixClient,
  ): RealmPermissionChecker;
}

export class MatrixRealmPermissionCheckerFactory {
  static create(
    realmPermissions: RealmPermissions,
    matrixClient: MatrixClient,
  ): RealmPermissionChecker {
    return new MatrixRealmPermissionChecker(realmPermissions, matrixClient);
  }
}

export class MatrixRealmPermissionChecker {
  private realmPermissions: RealmPermissions = {};
  private matrixClient: MatrixClient;

  constructor(realmPermissions: RealmPermissions, matrixClient: MatrixClient) {
    this.realmPermissions = realmPermissions;
    this.matrixClient = matrixClient;
  }

  async for(username: string) {
    let doesMatrixUserProfileExist = false;
    if (this.realmPermissions['users']) {
      doesMatrixUserProfileExist = !!(await this.matrixClient.getProfile(
        username,
      ));
    }
    return Array.from(
      new Set([
        ...(doesMatrixUserProfileExist
          ? this.realmPermissions['users'] || []
          : []),
        ...(this.realmPermissions['*'] || []),
        ...(this.realmPermissions[username] || []),
      ]),
    );
  }

  async can(username: string, action: 'read' | 'write') {
    let userPermissions = await this.for(username);
    return userPermissions.includes(action);
  }
}
