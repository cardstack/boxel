import { RealmPermissions } from './realm';

export default class RealmPermissionChecker {
  private realmPermissions: RealmPermissions = {};

  constructor(realmPermissions: RealmPermissions) {
    this.realmPermissions = realmPermissions;
  }

  can(username: string, action: 'read' | 'write') {
    return this.getUserPermissions(username).includes(action);
  }

  getUserPermissions(username: string) {
    return [
      ...(this.realmPermissions['*'] || []),
      ...(this.realmPermissions[username] || []),
    ];
  }
}
