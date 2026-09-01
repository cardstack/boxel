import { describe, it, expect, vi } from 'vitest';

import { resolveAnonymousBrowseUrl } from '../../src/lib/published-realm.js';

// A minimal Response stand-in shaped to what the resolver reads.
function fakeResponse(
  status: number,
  headers: Record<string, string> = {},
  body = '',
): Response {
  let realHeaders = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => realHeaders.get(name),
    },
    text: async () => body,
  } as unknown as Response;
}

// Every realm response carries this header; its presence is what marks the
// probed URL as a Boxel realm rather than an arbitrary site that returns 200.
const REALM_HEADERS = { 'x-boxel-realm-url': 'https://alice.boxel.space/' };

// The Boxel host shell always carries the host config meta tag; the routing
// fallback keys on it because the shell stamps no realm header.
const SHELL_BODY =
  '<!DOCTYPE html><meta name="@cardstack/host/config/environment" content="%7B%7D"><body></body>';

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
    // Probed unauthenticated with a HEAD, asking for the card representation —
    // we only read the status and realm header, never a body.
    expect(publicFetch).toHaveBeenCalledWith(
      'https://alice.boxel.space/Post/1',
      {
        method: 'HEAD',
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

  it('recognizes a host-routed/vanity path the card probe cannot see', async () => {
    // `/pricing` (mapped to a card elsewhere) is not itself an indexed card, so
    // the card+json HEAD 404s; a browser reaches it with a text/html
    // navigation that applies the routing map and gets the host shell.
    let publicFetch = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(404))
      .mockResolvedValueOnce(fakeResponse(200, {}, SHELL_BODY));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://alice.boxel.space/pricing',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBe('https://alice.boxel.space/pricing');
    // Second probe is the browser-style navigation.
    expect(publicFetch).toHaveBeenNthCalledWith(
      2,
      'https://alice.boxel.space/pricing',
      { headers: { Accept: 'text/html' } },
    );
  });

  it('rejects a foreign 200 that is not the Boxel host shell', async () => {
    // Card probe misses and the text/html fallback returns some other site's
    // 200 — no host config meta tag, so it is not a published realm.
    let publicFetch = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(404))
      .mockResolvedValueOnce(fakeResponse(200, {}, '<html>not boxel</html>'));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://example.com/pricing',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBeUndefined();
  });

  it('resolves an absolute published URL with no profile (undefined realm server)', async () => {
    // A fresh install has no active profile, hence no realm-server URL, but an
    // absolute published URL still needs no credentials.
    let publicFetch = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, REALM_HEADERS));

    let url = await resolveAnonymousBrowseUrl(
      undefined,
      'https://alice.boxel.space/Post/1',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBe('https://alice.boxel.space/Post/1');
  });

  it('returns undefined for a relative path with no profile (no origin to resolve)', async () => {
    let publicFetch = vi.fn();

    let url = await resolveAnonymousBrowseUrl(undefined, 'alice/blog/Post/1', {
      publicFetch: publicFetch as unknown as typeof fetch,
    });

    expect(url).toBeUndefined();
    expect(publicFetch).not.toHaveBeenCalled();
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
    // Card probe: 200 but no realm header. Fallback: still no host shell.
    let publicFetch = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(200))
      .mockResolvedValueOnce(fakeResponse(200, {}, '<html>not boxel</html>'));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'https://example.com/some/page',
      { publicFetch: publicFetch as unknown as typeof fetch },
    );

    expect(url).toBeUndefined();
  });

  it('returns undefined when both probes miss (unpublished, or card absent)', async () => {
    // e.g. the realm was unpublished, or the card is absent from the copy.
    let publicFetch = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(404, REALM_HEADERS))
      .mockResolvedValueOnce(fakeResponse(404));

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
