import * as os from 'os';
import * as path from 'path';
import fse from 'fs-extra';
import { expect, test } from '@playwright/test';
import {
  TEMPLATE_LOGIN_URL,
  writeTemplates,
} from '../support/synapse/index.ts';

test.describe('Synapse templates', () => {
  let configDir: string;

  test.beforeEach(async () => {
    configDir = await fse.mkdtemp(path.join(os.tmpdir(), 'synapse-templates-'));
  });

  test.afterEach(async () => {
    await fse.remove(configDir);
  });

  test('the SSO error page sends the browser to the login URL it is given', async () => {
    await writeTemplates(configDir, 'https://boxel.example/');

    let ssoError = await fse.readFile(
      path.join(configDir, 'templates', 'sso_error.html'),
      'utf8',
    );
    expect(ssoError).toContain('"https://boxel.example/"');
    expect(ssoError).not.toContain(TEMPLATE_LOGIN_URL);
  });

  test('every template is written, and none survives from an earlier launch', async () => {
    let stale = path.join(configDir, 'templates', 'removed_template.html');
    await fse.outputFile(stale, 'stale');

    await writeTemplates(configDir, TEMPLATE_LOGIN_URL);

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
