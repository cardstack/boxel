import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  RealmOperationError,
  refusalReason,
  type HostURL,
} from '@cardstack/runtime-common/realm-operations';
import type { RealmClient } from '@cardstack/runtime-common/realm-client';
import {
  mountTarget,
  registerMountCommand,
} from '../../src/commands/realm/mount.ts';
import { registerUnmountCommand } from '../../src/commands/realm/unmount.ts';
import {
  formatHostURLList,
  registerHostURLsCommand,
} from '../../src/commands/realm/host-urls.ts';
import {
  describeHostURLError,
  ensureSiteNameClaimed,
  findHostURL,
  hostURLAddress,
  siteNameHostname,
} from '../../src/lib/host-urls.ts';

const REALM = 'https://app.example.test/mango/blog/';

function hostURL(overrides: Partial<HostURL>): HostURL {
  return {
    id: '0b6c1f2e-8a51-4f6b-9a3e-2c4d5e6f7a8b',
    realmURL: REALM,
    url: 'https://mango.boxel.space/blog/',
    kind: 'boxel-space',
    isCanonical: true,
    ...overrides,
  };
}

// Parses argv with the command's real options, and captures the action's
// arguments instead of running it.
function parse(
  register: (realm: Command) => void,
  name: string,
  argv: string[],
): unknown[] {
  let captured: unknown[] = [];
  let program = new Command().exitOverride();
  let realm = program.command('realm');
  register(realm);
  let command = realm.commands.find((c) => c.name() === name)!;
  command.action((...args: unknown[]) => {
    captured = args.slice(0, -1);
  });
  program.parse(['realm', name, ...argv], { from: 'user' });
  return captured;
}

describe('boxel realm mount arguments', () => {
  it('takes a host URL', () => {
    expect(mountTarget('https://shop.example.test/', {})).toEqual({
      hostURL: 'https://shop.example.test/',
    });
  });

  it('takes --space without a host URL', () => {
    expect(mountTarget(undefined, { space: true })).toEqual({ space: true });
  });

  it('refuses a host URL together with --space', () => {
    expect(mountTarget('https://shop.example.test/', { space: true })).toEqual({
      error: 'Give a <host-url> or --space, not both.',
    });
  });

  it('refuses neither a host URL nor --space', () => {
    expect(mountTarget(undefined, {})).toHaveProperty('error');
  });

  it('refuses a host URL that is not a URL', () => {
    expect(mountTarget('shop', {})).toEqual({ error: 'shop is not a URL.' });
  });

  it('parses the host URL and the flags', () => {
    let [realmURL, url, opts] = parse(registerMountCommand, 'mount', [
      REALM,
      'https://mango.boxel.site/',
      '--canonical',
      '--as-user',
      '@mango:boxel.ai',
      '--json',
    ]);
    expect(realmURL).toBe(REALM);
    expect(url).toBe('https://mango.boxel.site/');
    expect(opts).toMatchObject({
      canonical: true,
      asUser: '@mango:boxel.ai',
      json: true,
    });
  });

  it('parses --space without a host URL', () => {
    let [realmURL, url, opts] = parse(registerMountCommand, 'mount', [
      REALM,
      '--space',
    ]);
    expect(realmURL).toBe(REALM);
    expect(url).toBeUndefined();
    expect(opts).toMatchObject({ space: true });
  });
});

describe('boxel realm unmount and host-urls arguments', () => {
  it('unmount parses the host URL and --tolerate-missing', () => {
    let [realmURL, url, opts] = parse(registerUnmountCommand, 'unmount', [
      REALM,
      'https://shop.example.test/',
      '--tolerate-missing',
    ]);
    expect(realmURL).toBe(REALM);
    expect(url).toBe('https://shop.example.test/');
    expect(opts).toMatchObject({ tolerateMissing: true });
  });

  it('host-urls parses --set-canonical', () => {
    let [realmURL, opts] = parse(registerHostURLsCommand, 'host-urls', [
      REALM,
      '--set-canonical',
      'https://shop.example.test/',
    ]);
    expect(realmURL).toBe(REALM);
    expect(opts).toMatchObject({
      setCanonical: 'https://shop.example.test/',
    });
  });
});

describe('host URL matching', () => {
  it('ignores the protocol, the case of the host and a missing slash', () => {
    expect(hostURLAddress('http://Mango.Boxel.Space/blog')).toBe(
      hostURLAddress('https://mango.boxel.space/blog/'),
    );
  });

  it('keeps a port that is not the default', () => {
    expect(hostURLAddress('http://mango.localhost:4201/blog/')).toBe(
      'mango.localhost:4201/blog/',
    );
    expect(hostURLAddress('https://mango.localhost:443/blog/')).toBe(
      'mango.localhost/blog/',
    );
  });

  it('finds the host URL at the same address', () => {
    let space = hostURL({});
    let site = hostURL({
      id: '1b6c1f2e-8a51-4f6b-9a3e-2c4d5e6f7a8b',
      url: 'https://mango.boxel.site/',
      kind: 'site-name',
      isCanonical: false,
    });
    expect(findHostURL([space, site], 'http://MANGO.boxel.site')).toBe(site);
    expect(findHostURL([space, site], 'https://mango.boxel.space/')).toBe(
      undefined,
    );
  });
});

describe('site name detection', () => {
  // A client that fails the test when the code sends a request.
  let noRequests: RealmClient = {
    realmServerURL: 'https://app.example.test/',
    config: { spaceDomain: '', siteDomain: '' },
    authedFetch: async (url) => {
      throw new Error(`unexpected request to ${url}`);
    },
  };

  it('does not ask the server about a URL with a path', async () => {
    expect(
      await siteNameHostname(noRequests, 'https://mango.boxel.space/blog/'),
    ).toBeUndefined();
  });

  it('does not ask the server about a host with one label', async () => {
    expect(
      await siteNameHostname(noRequests, 'http://localhost/'),
    ).toBeUndefined();
  });
});

describe('site name claims', () => {
  // A server whose site domain is `boxel.site`. The caller has no claim of
  // its own for the realm, and the claim endpoint answers with `claimStatus`
  // and `claimError`.
  function siteServer(
    claimStatus: number,
    claimError = 'Hostname is already claimed',
  ) {
    let requests: string[] = [];
    let client: RealmClient = {
      realmServerURL: 'https://app.example.test/',
      config: { spaceDomain: '', siteDomain: '' },
      authedFetch: async (input, init) => {
        let url = new URL(String(input));
        let method = init?.method ?? 'GET';
        requests.push(`${method} ${url.pathname}`);
        if (url.pathname === '/_check-boxel-domain-availability') {
          return Response.json({
            available: false,
            hostname: `${url.searchParams.get('subdomain')}.boxel.site`,
          });
        }
        if (url.pathname === '/_boxel-claimed-domains' && method === 'GET') {
          return Response.json(
            { errors: ['No hostname claim found for this realm'] },
            { status: 404 },
          );
        }
        if (url.pathname === '/_boxel-claimed-domains' && method === 'POST') {
          return Response.json(
            { errors: [claimError] },
            { status: claimStatus },
          );
        }
        throw new Error(`unexpected request to ${url}`);
      },
    };
    return { client, requests };
  }

  it('leaves a name that is claimed already to the mount', async () => {
    // Another administrator may have claimed the name for this realm. The
    // caller can't see that claim, and the mount accepts it.
    let { client, requests } = siteServer(422);
    expect(
      await ensureSiteNameClaimed(client, REALM, 'https://mango.boxel.site/'),
    ).toEqual({
      claimed: true,
      hostname: 'mango.boxel.site',
      alreadyClaimed: true,
    });
    expect(requests).toContain('POST /_boxel-claimed-domains');
  });

  it('stops on a claim refusal for another reason', async () => {
    let { client } = siteServer(422, 'Subdomain must be lowercase');
    await expect(
      ensureSiteNameClaimed(client, REALM, 'https://mango.boxel.site/'),
    ).rejects.toThrow('Subdomain must be lowercase');
  });

  it('stops on a claim failure that is not a refusal', async () => {
    let { client } = siteServer(500);
    await expect(
      ensureSiteNameClaimed(client, REALM, 'https://mango.boxel.site/'),
    ).rejects.toBeInstanceOf(RealmOperationError);
  });
});

describe('host URL errors', () => {
  it('reads the reasons from an errors document', () => {
    expect(
      refusalReason(
        JSON.stringify({
          errors: ['Another realm is mounted at shop.example.test/'],
        }),
      ),
    ).toBe('Another realm is mounted at shop.example.test/');
    expect(
      refusalReason(
        JSON.stringify({ errors: [{ detail: 'one' }, { title: 'two' }] }),
      ),
    ).toBe('one; two');
  });

  it('uses a body that is not an errors document as the reason', () => {
    expect(refusalReason('Bad gateway')).toBe('Bad gateway');
    expect(refusalReason('')).toBe('The request failed');
  });

  it('reports the status and Retry-After of a refusal', () => {
    let error = new RealmOperationError('Try again shortly.', {
      status: 503,
      retryAfter: '30',
    });
    expect(describeHostURLError(error)).toEqual({
      error: 'Try again shortly.',
      status: 503,
      retryAfter: '30',
    });
  });

  it('reports an error that is not a refusal by its message', () => {
    expect(describeHostURLError(new Error('no profile'))).toEqual({
      error: 'no profile',
    });
  });
});

describe('host URL list output', () => {
  it('marks the canonical host URL and names the Boxel Space URL', () => {
    let lines = formatHostURLList({
      hostURLs: [
        hostURL({}),
        hostURL({
          id: '1b6c1f2e-8a51-4f6b-9a3e-2c4d5e6f7a8b',
          url: 'https://mango.boxel.site/',
          kind: 'site-name',
          isCanonical: false,
        }),
      ],
      boxelSpaceURL: 'https://mango.boxel.space/blog/',
    }).map(stripColor);
    expect(lines).toEqual([
      '* https://mango.boxel.space/blog/  boxel-space',
      '  https://mango.boxel.site/        site-name',
      '* canonical',
      'Boxel Space URL: https://mango.boxel.space/blog/',
    ]);
  });

  it('says when the realm has no host URL', () => {
    expect(formatHostURLList({ hostURLs: [] }).map(stripColor)).toEqual([
      'The realm is not mounted at a host URL.',
    ]);
  });
});

function stripColor(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, '');
}
