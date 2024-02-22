import { RealmPermissions } from './realm';

export default class RealmPermissionChecker {
  private realmPermissions: RealmPermissions = {};

  constructor(realmPermissions: RealmPermissions) {
    this.realmPermissions = realmPermissions;
  }

  for(username: string) {
    return Array.from(
      new Set([
        ...(this.realmPermissions['users'] || []),
        ...(this.realmPermissions['*'] || []),
        ...(this.realmPermissions[username] || []),
      ]),
    );
  }

  can(username: string, action: 'read' | 'write') {
    let userPermissions = this.for(username);
    return userPermissions.includes(action);
  }
}
