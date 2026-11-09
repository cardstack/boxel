import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConditionalGets } from './github-api.ts';

// A stand-in for GitHub that answers 304 when the request's ETag is current.
function fakeGitHub() {
  const resources = new Map<string, { etag: string; body: unknown }>();
  const sent: { url: string; ifNoneMatch: string | undefined }[] = [];
  const request = async (
    _method: 'GET',
    url: string,
    _token: string,
    _body: undefined,
    headers?: Record<string, string>,
  ) => {
    const ifNoneMatch = headers?.['if-none-match'];
    sent.push({ url, ifNoneMatch });
    const resource = resources.get(url);
    if (!resource)
      return new Response('{"message":"Not Found"}', { status: 404 });
    if (ifNoneMatch === resource.etag)
      return new Response(null, { status: 304 });
    return new Response(JSON.stringify(resource.body), {
      status: 200,
      headers: { etag: resource.etag },
    });
  };
  return { resources, sent, request };
}

test('an unchanged resource is read again with its ETag, and gives the kept body', async () => {
  const github = fakeGitHub();
  github.resources.set('/a', { etag: '"1"', body: { jobs: [1] } });
  const gets = new ConditionalGets(github.request);

  assert.deepEqual(await gets.get('/a', 't'), { jobs: [1] });
  assert.deepEqual(await gets.get('/a', 't'), { jobs: [1] });
  assert.deepEqual(
    github.sent.map((s) => s.ifNoneMatch),
    [undefined, '"1"'],
  );
});

test('a changed resource gives the new body', async () => {
  const github = fakeGitHub();
  github.resources.set('/a', { etag: '"1"', body: { jobs: [1] } });
  const gets = new ConditionalGets(github.request);
  await gets.get('/a', 't');

  github.resources.set('/a', { etag: '"2"', body: { jobs: [1, 2] } });
  assert.deepEqual(await gets.get('/a', 't'), { jobs: [1, 2] });
  assert.deepEqual(await gets.get('/a', 't'), { jobs: [1, 2] });
  assert.equal(github.sent.at(-1)?.ifNoneMatch, '"2"');
});

test('a failed request throws with its status and forgets the URL', async () => {
  const github = fakeGitHub();
  github.resources.set('/a', { etag: '"1"', body: {} });
  const gets = new ConditionalGets(github.request);
  await gets.get('/a', 't');

  github.resources.delete('/a');
  await assert.rejects(
    gets.get('/a', 't'),
    (e: { status?: number }) => e.status === 404,
  );
  assert.equal(gets.size, 0);
});

test('a sweep forgets only the URLs that nothing asked for since the last sweep', async () => {
  const github = fakeGitHub();
  github.resources.set('/a', { etag: '"1"', body: {} });
  github.resources.set('/b', { etag: '"1"', body: {} });
  const gets = new ConditionalGets(github.request);
  await gets.get('/a', 't');
  await gets.get('/b', 't');
  gets.sweep();
  assert.equal(gets.size, 2);

  await gets.get('/a', 't');
  gets.sweep();
  assert.equal(gets.size, 1);
  await gets.get('/b', 't');
  assert.equal(github.sent.at(-1)?.ifNoneMatch, undefined);
});
