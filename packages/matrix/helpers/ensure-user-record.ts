import * as childProcess from 'child_process';

export async function ensureUserRecord(matrixUserId: string): Promise<void> {
  const database = process.env.PGDATABASE || 'boxel';
  const escaped = matrixUserId.replace(/'/g, "''");
  const sql = `INSERT INTO users (matrix_user_id) VALUES ('${escaped}') ON CONFLICT (matrix_user_id) DO NOTHING;`;

  await new Promise<void>((resolve, reject) => {
    const proc = childProcess.spawn('docker', [
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

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Failed to ensure user ${matrixUserId} in users table: ${stderr.trim()}`,
          ),
        );
        return;
      }
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
      resolve();
    });
  });
}
