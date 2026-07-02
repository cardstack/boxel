import * as path from 'path';
import fse from 'fs-extra';
import { expect, test } from '@playwright/test';
import { applyGoogleOidcGating } from '../support/synapse/index.ts';

// Read the real dev template so the test exercises the actual BEGIN/END
// markers and {{...}} placeholders, not a hand-rolled copy that could drift.
async function readDevHomeserverTemplate(): Promise<string> {
  return fse.readFile(
    path.join(
      import.meta.dirname,
      '..',
      'support',
      'synapse',
      'dev',
      'homeserver.yaml',
    ),
    'utf8',
  );
}

test.describe('Google OIDC gating in homeserver.yaml generation', () => {
  test('interpolates secrets when both env vars are present', async () => {
    const template = await readDevHomeserverTemplate();
    const result = applyGoogleOidcGating(
      template,
      'my-client-id.apps.googleusercontent.com',
      'my-secret',
    );

    expect(result).toContain('oidc_providers:');
    expect(result).toContain('my-client-id.apps.googleusercontent.com');
    expect(result).toContain('my-secret');
    // No placeholder must survive — a leftover {{...}} would make Synapse
    // boot with a literal placeholder as the client id.
    expect(result).not.toContain('{{GOOGLE_OAUTH_CLIENT_ID}}');
    expect(result).not.toContain('{{GOOGLE_OAUTH_CLIENT_SECRET}}');
  });

  test('strips the entire block when the client id is missing', async () => {
    const template = await readDevHomeserverTemplate();
    const result = applyGoogleOidcGating(template, '', 'my-secret');

    expect(result).not.toContain('# BEGIN_GOOGLE_OIDC');
    expect(result).not.toContain('# END_GOOGLE_OIDC');
    expect(result).not.toContain('oidc_providers:');
    expect(result).not.toContain('{{GOOGLE_OAUTH_CLIENT_SECRET}}');
  });

  test('strips the entire block when the client secret is missing', async () => {
    const template = await readDevHomeserverTemplate();
    const result = applyGoogleOidcGating(template, 'my-client-id', '');

    expect(result).not.toContain('# BEGIN_GOOGLE_OIDC');
    expect(result).not.toContain('oidc_providers:');
    expect(result).not.toContain('{{GOOGLE_OAUTH_CLIENT_ID}}');
  });

  test('preserves config outside the gated block when stripping', async () => {
    const template = await readDevHomeserverTemplate();
    const result = applyGoogleOidcGating(template, '', '');

    // experimental_features sits immediately above the block in the template;
    // the non-greedy strip must not chew into surrounding config.
    expect(result).toContain('experimental_features:');
    expect(template).toContain('# BEGIN_GOOGLE_OIDC');
  });
});
