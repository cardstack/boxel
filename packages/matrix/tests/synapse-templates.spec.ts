import * as os from 'os';
import * as path from 'path';
import fse from 'fs-extra';
import { expect, test } from '@playwright/test';
import { writeTemplates } from '../support/synapse/index.ts';

test.describe('Synapse templates', () => {
  let configDir: string;

  test.beforeEach(async () => {
    configDir = await fse.mkdtemp(path.join(os.tmpdir(), 'synapse-templates-'));
  });

  test.afterEach(async () => {
    await fse.remove(configDir);
  });

  test('every template is written, and none survives from an earlier launch', async () => {
    let stale = path.join(configDir, 'templates', 'removed_template.html');
    await fse.outputFile(stale, 'stale');

    await writeTemplates(configDir);

    expect(
      (await fse.readdir(path.join(configDir, 'templates'))).sort(),
    ).toEqual(
      (
        await fse.readdir(
          path.join(
            import.meta.dirname,
            '..',
            'support',
            'synapse',
            'templates',
          ),
        )
      ).sort(),
    );
    expect(await fse.pathExists(stale)).toBe(false);
  });
});
