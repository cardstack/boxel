import { Client } from 'pg';

// Native bootstrap for the bundled public code realms. User realms are not
// included: their permissions come from the authenticated principal.
export async function ensureLocalPublicRealmReads({
  host,
  port,
  database,
  password,
  realmURLs,
  realmOwners,
}: {
  host: string;
  port: number;
  database: string;
  password: string;
  realmURLs: string[];
  realmOwners: Record<string, string>;
}): Promise<void> {
  const db = new Client({ host, port, user: 'postgres', database, password });
  try {
    await db.connect();
    for (const realmURL of realmURLs) {
      let owner = realmOwners[realmURL];
      if (!owner || !owner.startsWith('@') || !owner.includes(':')) {
        throw new Error(
          'Every bundled realm must have a Matrix owner identity',
        );
      }
      await db.query(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ($1, '*', true, false, false) ON CONFLICT (realm_url, username) DO UPDATE SET read=true, write=false, realm_owner=false`,
        [realmURL],
      );
      await db.query(
        `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ($1, $2, true, true, true) ON CONFLICT (realm_url, username) DO UPDATE SET read=true, write=true, realm_owner=true`,
        [realmURL, owner],
      );
    }
  } finally {
    await db.end();
  }
}
