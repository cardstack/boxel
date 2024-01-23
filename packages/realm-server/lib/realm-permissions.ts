import { type RealmPermissions as RealmPermissionsInterface } from '@cardstack/runtime-common';

export default class RealmPermissions {
  private config: Record<string, RealmPermissionsInterface> = {};

  constructor() {
    let jsonContent = process.env.REALM_USER_PERMISSIONS;
    if (!jsonContent) {
      throw new Error(
        `REALM_USER_PERMISSIONS env var is blank. It should have a JSON string value that looks like this:
          {
            "https://realm-url-1/": {
              "users":{
                "*":["read"],
                "@hassan:boxel.ai":["read", "write"],
                ...
              }
            },
            "https://realm-url-2/": { ... }
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

  permissionsForRealm(realmURL: string) {
    let realmConfig = this.config[realmURL];

    // TODO until we get the infra setup for user permissions we default to wide open permissions
    if (!realmConfig) {
      return (
        {
          users: {
            '*': ['read', 'write'],
          },
        } as RealmPermissionsInterface
      ).users;
    }

    return realmConfig.users;
  }

  can(username: string, action: 'read' | 'write', realmURL: string) {
    let realmPermissions = this.permissionsForRealm(realmURL);

    let userPermissions = [
      ...(realmPermissions['*'] || []),
      ...(realmPermissions[username] || []),
    ];

    return userPermissions.includes(action);
  }
}
