export default class RealmPermissions {
  private config: Record<string, any> = {};

  constructor() {
    let jsonContent = process.env.REALM_USER_PERMISSIONS;
    if (!jsonContent) {
      throw new Error(
        `REALM_USER_PERMISSIONS env var is blank. It should have a JSON string value that looks like this:
          {
            "my-realm-name-1": {
              "users":{
                "*":["read"],
                "@hassan:boxel.ai":["read", "write"],
                ...
              }
            },
            "my-realm-name-2": { ... }
          }
        `,
      );
    }

    try {
      this.config = JSON.parse(jsonContent);
    } catch (error: any) {
      throw new Error(
        `Error while JSON parsing env var REALM_USER_PERMISSIONS: ${jsonContent}`,
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
