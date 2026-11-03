import * as childProcess from 'child_process';

// The realm server creates the `users` table when it migrates the database at
// startup, and the dev and test stacks start it alongside the user
// registration that calls this. The realm server builds the secure origin's
// pages before it migrates, so on a runner where Synapse is up quickly a
// registration can reach here before the table exists. An insert that finds no
// table waits for the migration, up to this budget, instead of failing the
// stack it runs in.
const USERS_TABLE_WAIT_MS = 5 * 60 * 1000;
const USERS_TABLE_POLL_MS = 2000;

export async function ensureUserRecord(matrixUserId: string): Promise<void> {
  const database = process.env.PGDATABASE || 'boxel';
  const escaped = matrixUserId.replace(/'/g, "''");
  const sql = `INSERT INTO users (matrix_user_id) VALUES ('${escaped}') ON CONFLICT (matrix_user_id) DO NOTHING;`;

  const deadline = Date.now() + USERS_TABLE_WAIT_MS;
  let waiting = false;
  for (;;) {
    const { code, stdout, stderr } = await runPsql(database, sql);
    if (code === 0) {
      const inserted = stdout
        .split('\n')
        .some((line) => line.includes('INSERT 0 1'));
      if (inserted) {
        console.log(`Added an entry to the users table: ${matrixUserId}`);
      } else {
        console.log(
          `Skipped adding entry to the users table because it already exists: ${matrixUserId}`,
        );
      }
      return;
    }
    if (!/relation "users" does not exist/.test(stderr)) {
      throw new Error(
        `Failed to ensure user ${matrixUserId} in users table: ${stderr.trim()}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Failed to ensure user ${matrixUserId} in users table: the database ${database} still has no users table after ${
          USERS_TABLE_WAIT_MS / 1000
        }s. The realm server creates it when it migrates the database at startup.`,
      );
    }
    if (!waiting) {
      console.log(
        `Waiting for the realm server to create the users table in ${database} before adding ${matrixUserId}`,
      );
      waiting = true;
    }
    await new Promise((r) => setTimeout(r, USERS_TABLE_POLL_MS));
  }
}

function runPsql(
  database: string,
  sql: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn('docker', [
      'exec',
      'boxel-pg',
      'psql',
      // The postgres image does not always create the unix socket, so force
      // TCP; it listens on *:5432 with trust auth.
      '-h',
      '127.0.0.1',
      '-p',
      '5432',
      '-U',
      'postgres',
      '-w',
      '-d',
      database,
      '-c',
      sql,
    ]);

    let stderr = '';
    let stdout = '';

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
