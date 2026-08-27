import { describe, it, expect, vi } from 'vitest';

import { resolveAnonymousBrowseUrl } from '../../src/lib/published-realm.js';

// A minimal Response stand-in shaped to what the resolver reads.
function fakeResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  let realHeaders = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => realHeaders.get(name),
    },
  } as unknown as Response;
}

// Every realm response carries this header; its presence is what marks the
// probed URL as a Boxel realm rather than an arbitrary site that returns 200.
const REALM_HEADERS = { 'x-boxel-realm-url': 'https://alice.boxel.space/' };

describe('resolveAnonymousBrowseUrl', () => {
  const REALM_SERVER = 'https://app.boxel.ai/';

  it('returns a published-realm URL as-is when it serves anonymously', async () => {
    let publicFetch = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, REALM_HEADERS));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://alice.boxel.space/Post/1',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBe('https://alice.boxel.space/Post/1');
    // Probed unauthenticated, asking for the card representation.
    expect(publicFetch).toHaveBeenCalledWith(
      'https://alice.boxel.space/Post/1',
      {
        headers: { Accept: 'application/vnd.card+json' },
      },
    );
  });

  it('handles a published site root (the realm serves its index card there)', async () => {
    let publicFetch = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, REALM_HEADERS));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://alice.boxel.space',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBe('https://alice.boxel.space/');
  });

  it('returns undefined for a relative card path (realm-server origin) without probing', async () => {
    let publicFetch = vi.fn();

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'alice/blog/Post/1',
      {
        publicFetch: publicFetch as unknown as typeof fetch,
      },
    );

    expect(url).toBeUndefined();
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('returns undefined for an absolute URL on the realm-server origin without probing', async () => {
    let publicFetch = vi.fn();

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://app.boxel.ai/alice/blog/Post/1',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBeUndefined();
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('returns undefined when a foreign URL responds 200 without the realm header', async () => {
    let publicFetch = vi.fn().mockResolvedValue(fakeResponse(200));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://example.com/some/page',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBeUndefined();
  });

  it('returns undefined when the anonymous probe is not ok', async () => {
    // e.g. the realm was unpublished, or the card is absent from the copy.
    let publicFetch = vi
      .fn()
      .mockResolvedValue(fakeResponse(404, REALM_HEADERS));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://alice.boxel.space/Post/1',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBeUndefined();
  });

  it('returns undefined when the probe throws (unreachable origin, etc.)', async () => {
    let publicFetch = vi
      .fn()
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://gone.boxel.space/Post/1',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBeUndefined();
  });
});
