import type { MatrixClient } from './matrix-client';
import type { RealmPermissions, RealmAction } from './index';

export default class RealmPermissionChecker {
  private realmPermissions: RealmPermissions = {};
  private matrixClient: MatrixClient;

  constructor(realmPermissions: RealmPermissions, matrixClient: MatrixClient) {
    this.realmPermissions = realmPermissions;
    this.matrixClient = matrixClient;
  }

  async for(username: string) {
    let doesMatrixUserProfileExist = false;
    if (this.realmPermissions['users']) {
      doesMatrixUserProfileExist =
        !!(await this.matrixClient.getProfile(username));
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

  async can(username: string, action: RealmAction) {
    let userPermissions = await this.for(username);
    return userPermissions.includes(action);
  }
}
