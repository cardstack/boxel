import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import { z } from 'zod';

const destination = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => {
        let url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }),
    methods: z.array(z.enum(['GET', 'POST'])).min(1),
  })
  .strict();
const policies = z.record(
  z.string().url(),
  z
    .object({
      ownerUserId: z.string().regex(/^@[^:]+:.+$/),
      destinations: z.array(destination).min(1),
    })
    .strict(),
);

export function parsePublishedProxyPolicies(value: unknown) {
  return policies.parse(value ?? {});
}

export function matchesPublishedProxyDestination(
  destinations: z.infer<typeof destination>[],
  value: string,
  method: string,
): boolean {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return false;
  }
  if (target.username || target.password || target.hash) return false;
  return destinations.some((destination) => {
    let allowed = new URL(destination.url);
    return (
      destination.methods.some((item) => item === method) &&
      target.origin === allowed.origin &&
      (allowed.pathname.endsWith('/')
        ? target.pathname.startsWith(allowed.pathname)
        : target.pathname === allowed.pathname)
    );
  });
}

const ownerRows = z.array(
  z.object({ source_url: z.string().url(), owner: z.string().min(1) }),
);
export type PublishedProxyPolicies = ReturnType<
  typeof parsePublishedProxyPolicies
>;

export async function publishedProxyOwner(
  dbAdapter: DBAdapter,
  realmURL: string,
  url: string,
  method: string,
  policies: ReturnType<typeof parsePublishedProxyPolicies>,
): Promise<string | null> {
  let rows = ownerRows.parse(
    await query(dbAdapter, [
      `SELECT registry.source_url, owners.username AS owner FROM realm_registry registry
     JOIN realm_user_permissions readers ON readers.realm_url = registry.url AND readers.username = '*' AND readers.read = true
     JOIN realm_user_permissions owners ON owners.realm_url = registry.source_url AND owners.realm_owner = true
     WHERE registry.url = `,
      param(realmURL),
      ` AND registry.kind = 'published' AND registry.last_published_at IS NOT NULL`,
    ]),
  );
  return (
    rows.find((row) => {
      let policy = policies[row.source_url];
      return (
        policy?.ownerUserId === row.owner &&
        matchesPublishedProxyDestination(policy.destinations, url, method)
      );
    })?.owner ?? null
  );
}
