import * as childProcess from 'child_process';

import { loginUser } from '../docker/synapse';
export const adminUsername = 'admin';
export const adminPassword = 'password';

let username = process.env.MATRIX_USERNAME || adminUsername;
let password = process.env.MATRIX_PASSWORD || adminPassword;
let isAdmin = process.env.MATRIX_IS_ADMIN;

async function ensureUserRecord(matrixUserId: string) {
  const database = process.env.PGDATABASE || 'boxel';
  const escapedMatrixUserId = matrixUserId.replace(/'/g, "''");
  const sql = `INSERT INTO users (matrix_user_id) VALUES ('${escapedMatrixUserId}') ON CONFLICT (matrix_user_id) DO NOTHING;`;

  await new Promise<void>((resolve, reject) => {
    const dockerProcess = childProcess.spawn('docker', [
      'exec',
      'boxel-pg',
      'psql',
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

    dockerProcess.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    dockerProcess.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    dockerProcess.on('error', (error) => {
      reject(error);
    });

    dockerProcess.on('close', (code) => {
      if (code === 0) {
        const trimmedStdout = stdout.trim();
        const inserted = trimmedStdout
          .split('\n')
          .some((line) => line.includes('INSERT 0 1'));
        if (inserted) {
          console.log(`Added an entry to the users table: ${matrixUserId}`);
        } else {
          console.log(
            `Skipped adding entry to the users table because it already exists: ${matrixUserId}`,
          );
        }
        resolve();
      } else {
        reject(
          new Error(
            `Failed to ensure user ${matrixUserId} in users table: ${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

(async () => {
  return new Promise<string>((resolve, reject) => {
    const matrixUserId = username.startsWith('@')
      ? username
      : `@${username}:localhost`;
    const shouldEnsureUserRecord = isAdmin !== 'TRUE';
    const command = `docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${username} -p ${password} ${
      isAdmin === 'TRUE' ? `--admin` : `--no-admin`
    }`;
    childProcess.exec(command, async (err, stdout) => {
      if (err) {
        if (stdout.includes('User ID already taken')) {
          let cred = await loginUser(username, password);
          if (!cred.userId) {
            reject(
              `User ${username} already exists in matrix, but the password does not match`,
            );
            return;
          } else {
            if (shouldEnsureUserRecord) {
              await ensureUserRecord(matrixUserId);
            }
            console.log(
              `User ${username} already exists in matrix and the password matches`,
            );
            resolve(`User already exists as ${cred.userId}`);
            return;
          }
        }
        reject(err);
      }
      if (shouldEnsureUserRecord) {
        await ensureUserRecord(matrixUserId);
      }
      console.log(stdout.trim());
      resolve(stdout.trim());
    });
  });
})().catch((e) => console.error(`unexpected error`, e));
