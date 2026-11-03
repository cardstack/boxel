import type { LocalPath } from './paths.ts';

// The audit of a policy change against a realm's shares.
//
// Whether people who aren't signed in may use a key is its owner's setting on
// the key, and whether they can use it in a realm is that realm's policy's to
// say: a visitor's call is served only when the policy opens the operation
// and the share's key allows anonymous use. Sharing a key into a realm whose
// policy already opens such calls is refused for a key that doesn't allow
// them, so the sharer agrees knowingly. A policy that comes to open such calls
// after keys were shared into its realm is the other way round, and this
// audit is what makes that change a knowing one too.
//
// A write that would put such a policy in force — the policy card a realm
// names, or the realm's `realm.json` pointing at another one — is audited
// before anything is written. Every share in a governed realm that is bound to
// an operation the new policy opens to visitors with a shared key, and the
// realm's current policy doesn't, is listed. The write is refused with that
// list (`POLICY_OPENS_SHARES_CODE`, 409) unless it carries the list's
// confirmation in `POLICY_AUDIT_CONFIRMATION_HEADER`. A confirmation is the
// fingerprint of the list it was shown, so it confirms exactly that list: a
// share bound, or a key's setting changed, in between makes a new list and a
// new confirmation.
//
// Once a confirmed write lands, each listed share's owner gets a notice:
// visitors now use their key in that realm, or the realm wants visitors to
// use it and they can allow it on the key.

export const POLICY_AUDIT_CONFIRMATION_HEADER =
  'x-boxel-policy-audit-confirmation';

export const POLICY_OPENS_SHARES_CODE = 'policy-opens-shares-to-anonymous';

// One share the change opens to visitors.
export interface PolicyShareAuditEntry {
  // The realm the share is in, which the policy governs.
  realm: string;
  // The share, by id and by its label in the realm.
  share: string;
  label: string;
  // The share's owner, a Matrix user id.
  owner: string;
  // Whether the key the share holds allows people who aren't signed in to
  // use it. Visitors start using a key that does as soon as the change is
  // saved; one that doesn't refuses them until its owner allows it.
  keyAllowsAnonymous: boolean;
  // The operations the change opens to visitors that are bound to the share,
  // each as `<module>#<export>.<operation>`, sorted.
  operations: string[];
}

export interface PolicyShareAudit {
  // The policy card the change puts in force, or null where it removes one.
  policy: string | null;
  // Sorted by realm, then label.
  entries: PolicyShareAuditEntry[];
  // What the write carries in `POLICY_AUDIT_CONFIRMATION_HEADER` to confirm
  // this list.
  confirmation: string;
}

// What the realm hands the auditor about one write: the files it changes and
// their content as it will be written.
export interface PolicyWriteAuditRequest {
  realmURL: string;
  paths: LocalPath[];
  // The content `path` will hold once the write lands, as text. Read only for
  // a path the auditor finds is a policy or a realm's config, since a write
  // of another file can't change a policy.
  contentOf(path: LocalPath): Promise<string>;
  // Whether the card stored at `path` is a policy card, as the realm's index
  // records it. A card no realm can name yet, being new, governs nothing.
  isPolicyCard(path: LocalPath): Promise<boolean>;
}

// Supplied by the server a realm runs in, which knows the realms it serves and
// the shares in them. A realm without one audits nothing.
export interface PolicyWriteAuditor {
  // The audit of a write, or undefined where it opens no share to visitors.
  audit(
    request: PolicyWriteAuditRequest,
  ): Promise<PolicyShareAudit | undefined>;
  // Records the notices a confirmed write owes the owners of the shares it
  // listed. Called once the write has landed.
  notify(audit: PolicyShareAudit, savedBy: string | null): Promise<void>;
}

// What a write that may change a policy carries from its request.
export interface PolicyAuditOptions {
  // The confirmation the request sent, if any.
  confirmation: string | null;
  // Who is writing, for the notices.
  actor: string | null;
}

export function policyAuditOptionsFor(
  request: Request,
  actor: string | null | undefined,
): PolicyAuditOptions {
  return {
    confirmation:
      request.headers.get(POLICY_AUDIT_CONFIRMATION_HEADER)?.trim() || null,
    actor: actor ?? null,
  };
}

// The audit a refusal carries, read back from an error document's `meta`, or
// undefined where the error is something else.
export function policyShareAuditFromError(
  error: unknown,
): PolicyShareAudit | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  let meta = (error as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  let { code, audit } = meta as { code?: unknown; audit?: unknown };
  if (code !== POLICY_OPENS_SHARES_CODE || !isPolicyShareAudit(audit)) {
    return undefined;
  }
  return audit;
}

// The audit a refused response's JSON:API error document carries, or
// undefined where the body is anything else.
export function policyShareAuditFromErrorBody(
  body: unknown,
): PolicyShareAudit | undefined {
  let errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) {
    return undefined;
  }
  for (let error of errors) {
    let audit = policyShareAuditFromError(error);
    if (audit) {
      return audit;
    }
  }
  return undefined;
}

function isPolicyShareAudit(value: unknown): value is PolicyShareAudit {
  if (!value || typeof value !== 'object') {
    return false;
  }
  let { policy, entries, confirmation } = value as Record<string, unknown>;
  return (
    (policy === null || typeof policy === 'string') &&
    typeof confirmation === 'string' &&
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.realm === 'string' &&
        typeof entry.share === 'string' &&
        typeof entry.label === 'string' &&
        typeof entry.owner === 'string' &&
        typeof entry.keyAllowsAnonymous === 'boolean' &&
        Array.isArray(entry.operations) &&
        entry.operations.every((op: unknown) => typeof op === 'string'),
    )
  );
}
