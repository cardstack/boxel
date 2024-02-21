import { RealmPermissions } from './realm';

export default class RealmPermissionChecker {
  private realmPermissions: RealmPermissions = {};

  constructor(realmPermissions: RealmPermissions) {
    this.realmPermissions = realmPermissions;
  }

  can(username: string, action: 'read' | 'write') {
    let userPermissions = [
      ...(this.realmPermissions['users'] || []),
      ...(this.realmPermissions['*'] || []),
      ...(this.realmPermissions[username] || []),
    ];

    return userPermissions.includes(action);
  }
}
