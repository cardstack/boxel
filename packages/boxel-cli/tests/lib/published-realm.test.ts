import { describe, it, expect, vi } from 'vitest';

import {
  pickLatestPublishedOrigin,
  resolvePublishedCardUrl,
  resolveAnonymousBrowseUrl,
} from '../../src/lib/published-realm.js';

// A minimal Response stand-in shaped to what the resolver reads.
function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  let lower = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => lower.get(name),
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('pickLatestPublishedOrigin', () => {
  it('returns undefined for null / string / empty maps', () => {
    expect(pickLatestPublishedOrigin(null)).toBeUndefined();
    expect(pickLatestPublishedOrigin(undefined)).toBeUndefined();
    expect(pickLatestPublishedOrigin('2026-01-01')).toBeUndefined();
    expect(pickLatestPublishedOrigin({})).toBeUndefined();
  });

  it('returns the single origin when there is one', () => {
    expect(
      pickLatestPublishedOrigin({ 'https://alice.boxel.space/': '1700000000' }),
    ).toBe('https://alice.boxel.space/');
  });

  it('returns the most-recently published origin', () => {
    expect(
      pickLatestPublishedOrigin({
        'https://old.boxel.space/': '1700000000',
        'https://new.boxel.space/': '1800000000',
      }),
    ).toBe('https://new.boxel.space/');
  });
});

describe('resolvePublishedCardUrl', () => {
  it('rebases the card id onto the published origin', () => {
    expect(
      resolvePublishedCardUrl({
        publishedOrigin: 'https://alice.boxel.space/',
        sourceRealmUrl: 'https://app.boxel.ai/alice/blog/',
        cardId: 'https://app.boxel.ai/alice/blog/Post/1',
      }),
    ).toBe('https://alice.boxel.space/Post/1');
  });

  it('strips a trailing index (the realm index card)', () => {
    expect(
      resolvePublishedCardUrl({
        publishedOrigin: 'https://alice.boxel.space/',
        sourceRealmUrl: 'https://app.boxel.ai/alice/blog/',
        cardId: 'https://app.boxel.ai/alice/blog/index',
      }),
    ).toBe('https://alice.boxel.space/');
  });

  it('normalizes a published origin missing its trailing slash', () => {
    expect(
      resolvePublishedCardUrl({
        publishedOrigin: 'https://alice.boxel.space',
        sourceRealmUrl: 'https://app.boxel.ai/alice/blog/',
        cardId: 'https://app.boxel.ai/alice/blog/Post/1',
      }),
    ).toBe('https://alice.boxel.space/Post/1');
  });

  it('returns undefined when the card id is not under the source realm', () => {
    expect(
      resolvePublishedCardUrl({
        publishedOrigin: 'https://alice.boxel.space/',
        sourceRealmUrl: 'https://app.boxel.ai/alice/blog/',
        cardId: 'https://elsewhere.example.com/Post/1',
      }),
    ).toBeUndefined();
  });
});

describe('resolveAnonymousBrowseUrl', () => {
  const REALM_SERVER = 'https://app.boxel.ai/';
  const SOURCE_REALM = 'https://app.boxel.ai/alice/blog/';
  const CARD_ID = 'https://app.boxel.ai/alice/blog/Post/1';

  function publishedInfo(origin = 'https://alice.boxel.space/') {
    return {
      data: {
        id: SOURCE_REALM,
        attributes: { lastPublishedAt: { [origin]: '1800000000' } },
      },
    };
  }

  it('returns the published URL for a card in a published realm', async () => {
    let authedRealmFetch = vi
      .fn()
      // card fetch: realm header + canonical id
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          { data: { id: CARD_ID } },
          { 'x-boxel-realm-url': SOURCE_REALM },
        ),
      )
      // _info fetch: lastPublishedAt map
      .mockResolvedValueOnce(fakeResponse(200, publishedInfo()));
    let publicFetch = vi.fn().mockResolvedValue(fakeResponse(200, {}));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'alice/blog/Post/1',
      {
        authedRealmFetch,
        publicFetch: publicFetch as unknown as typeof fetch,
      },
    );

    expect(url).toBe('https://alice.boxel.space/Post/1');
    // The published URL was confirmed with an unauthenticated fetch.
    expect(publicFetch).toHaveBeenCalledWith(
      'https://alice.boxel.space/Post/1',
      expect.anything(),
    );
  });

  it('returns undefined when the card fetch is not found (fall back to auth)', async () => {
    let authedRealmFetch = vi
      .fn()
      .mockResolvedValue(fakeResponse(404, 'not found'));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'alice/blog/Post/1',
      {
        authedRealmFetch,
      },
    );

    expect(url).toBeUndefined();
  });

  it('returns undefined when the realm is not published', async () => {
    let authedRealmFetch = vi
      .fn()
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          { data: { id: CARD_ID } },
          { 'x-boxel-realm-url': SOURCE_REALM },
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(200, {
          data: { id: SOURCE_REALM, attributes: { lastPublishedAt: null } },
        }),
      );

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'alice/blog/Post/1',
      {
        authedRealmFetch,
      },
    );

    expect(url).toBeUndefined();
  });

  it('returns undefined when the published URL does not render anonymously', async () => {
    let authedRealmFetch = vi
      .fn()
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          { data: { id: CARD_ID } },
          { 'x-boxel-realm-url': SOURCE_REALM },
        ),
      )
      .mockResolvedValueOnce(fakeResponse(200, publishedInfo()));
    // Stale lastPublishedAt: the published copy 404s without auth.
    let publicFetch = vi.fn().mockResolvedValue(fakeResponse(404, 'gone'));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'alice/blog/Post/1',
      {
        authedRealmFetch,
        publicFetch: publicFetch as unknown as typeof fetch,
      },
    );

    expect(url).toBeUndefined();
  });

  it('returns undefined when the authed fetch throws (no realm token, etc.)', async () => {
    let authedRealmFetch = vi
      .fn()
      .mockRejectedValue(new Error('No realm token available'));

    let url = await resolveAnonymousBrowseUrl(
      REALM_SERVER,
      'alice/blog/Post/1',
      {
        authedRealmFetch,
      },
    );

    expect(url).toBeUndefined();
  });
});
