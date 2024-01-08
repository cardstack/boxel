import fs from 'fs';

export default class RealmPermissions {
  private config: Record<string, any> = {};

  constructor(filePath: string) {
    try {
      const jsonConfig = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      this.config = jsonConfig;
    } catch (error: any) {
      throw new Error(
        `Error reading or parsing the configuration file: ${filePath} `,
      );
    }
  }

  private realmPermissions(realmName: string) {
    let realmConfig = this.config[realmName];

    if (!realmConfig) {
      throw new Error(
        `Realm ${realmName} does not exist in the permissions config`,
      );
    }

    return realmConfig.users;
  }

  can(username: string, action: 'read' | 'write', realmName: string) {
    let realmPermissions = this.realmPermissions(realmName);

    let userPermissions = [
      ...(realmPermissions['*'] || []),
      ...(realmPermissions[username] || []),
    ];

    return userPermissions.includes(action);
  }
}
