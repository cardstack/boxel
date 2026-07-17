import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadFactoryBrief,
  parseGitHubRepoUrl,
} from '../src/factory-brief.ts';
import { createSeedIssue } from '../src/factory-seed.ts';

const DARKFACTORY_MODULE =
  'https://example.com/software-factory/darkfactory';

function githubFetchStub(): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    let url = String(input);
    if (url === 'https://api.github.com/repos/acme/closet-app') {
      return new Response(
        JSON.stringify({
          name: 'closet-app',
          description: 'Digitize your closet with AI cutouts.',
        }),
        { status: 200 },
      );
    }
    if (url === 'https://api.github.com/repos/acme/closet-app/readme') {
      return new Response('# Closet App\n\nSnap photos, build outfits.', {
        status: 200,
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
}

test('parseGitHubRepoUrl accepts repo URLs and rejects everything else', () => {
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/acme/closet-app'), {
    owner: 'acme',
    repo: 'closet-app',
  });
  assert.deepEqual(
    parseGitHubRepoUrl('https://github.com/acme/closet-app.git'),
    { owner: 'acme', repo: 'closet-app' },
  );
  assert.equal(parseGitHubRepoUrl('https://github.com/acme'), undefined);
  assert.equal(
    parseGitHubRepoUrl('https://example.com/acme/closet-app'),
    undefined,
  );
  assert.equal(parseGitHubRepoUrl('not a url'), undefined);
});

test('loadFactoryBrief synthesizes a port brief from a GitHub URL', async () => {
  let brief = await loadFactoryBrief('https://github.com/acme/closet-app', {
    fetch: githubFetchStub(),
  });
  assert.equal(brief.title, 'Port: Closet App');
  assert.equal(brief.githubRepoUrl, 'https://github.com/acme/closet-app');
  assert.equal(brief.contentSummary, 'Digitize your closet with AI cutouts.');
  assert.match(brief.content, /Snap photos, build outfits/);
  assert.deepEqual(brief.tags, ['github-port']);
});

test('createSeedIssue seeds a port-analysis issue that blocks bootstrap', async () => {
  let workspaceDir = await mkdtemp(join(tmpdir(), 'github-port-seed-'));
  try {
    let brief = await loadFactoryBrief('https://github.com/acme/closet-app', {
      fetch: githubFetchStub(),
    });
    let result = await createSeedIssue(brief, {
      darkfactoryModuleUrl: DARKFACTORY_MODULE,
      workspaceDir,
    });
    assert.equal(result.status, 'created');

    let analysis = JSON.parse(
      await readFile(
        join(workspaceDir, 'Issues', 'port-analysis-seed.json'),
        'utf8',
      ),
    );
    assert.equal(analysis.data.attributes.issueType, 'analysis');
    assert.equal(analysis.data.attributes.status, 'backlog');
    assert.equal(analysis.data.attributes.order, 0);
    assert.match(
      analysis.data.attributes.description,
      /github\.com\/acme\/closet-app/,
    );
    assert.match(
      analysis.data.attributes.acceptanceCriteria,
      /Better than the original/,
    );

    let bootstrap = JSON.parse(
      await readFile(
        join(workspaceDir, 'Issues', 'bootstrap-seed.json'),
        'utf8',
      ),
    );
    assert.deepEqual(bootstrap.data.relationships['blockedBy.0'], {
      links: { self: '../Issues/port-analysis-seed' },
    });
    assert.equal(bootstrap.data.attributes.order, 1);
    assert.match(
      bootstrap.data.attributes.description,
      /Port background \(read first\)/,
    );
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('non-GitHub briefs seed no analysis issue', async () => {
  let workspaceDir = await mkdtemp(join(tmpdir(), 'plain-seed-'));
  try {
    let brief = {
      title: 'Plain Brief',
      sourceUrl: 'https://example.com/realm/Wiki/plain',
      content: 'Build a widget.',
      contentSummary: 'Build a widget.',
      tags: [],
    };
    await createSeedIssue(brief, {
      darkfactoryModuleUrl: DARKFACTORY_MODULE,
      workspaceDir,
    });
    let bootstrap = JSON.parse(
      await readFile(
        join(workspaceDir, 'Issues', 'bootstrap-seed.json'),
        'utf8',
      ),
    );
    assert.equal(bootstrap.data.relationships, undefined);
    assert.equal(bootstrap.data.attributes.order, 0);
    await assert.rejects(
      readFile(
        join(workspaceDir, 'Issues', 'port-analysis-seed.json'),
        'utf8',
      ),
    );
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
