import { describe, it, expect } from 'vitest';

import { matrixLogout } from '../../src/lib/auth.ts';

const MATRIX_URL = 'https://matrix.example.test/';

function matrix(status: number) {
  let requests: { url: string; init?: RequestInit }[] = [];
  let fetchFn = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response('{}', { status });
  }) as typeof fetch;
  return { requests, fetchFn };
}

describe('matrixLogout', () => {
  it('signs the access token out', async () => {
    let server = matrix(200);

    await matrixLogout(MATRIX_URL, 'matrix-token', server.fetchFn);

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].url).toBe(
      'https://matrix.example.test/_matrix/client/v3/logout',
    );
    expect(server.requests[0].init?.method).toBe('POST');
    expect(
      (server.requests[0].init?.headers as Record<string, string>)
        .Authorization,
    ).toBe('Bearer matrix-token');
  });

  it('counts a token that is already signed out as done', async () => {
    await expect(
      matrixLogout(MATRIX_URL, 'matrix-token', matrix(401).fetchFn),
    ).resolves.toBeUndefined();
  });

  it('throws when the server fails', async () => {
    await expect(
      matrixLogout(MATRIX_URL, 'matrix-token', matrix(500).fetchFn),
    ).rejects.toThrow('Matrix logout failed: 500');
  });
});
