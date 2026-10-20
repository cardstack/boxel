import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

// Names the running instance of a service. Worker ids begin with it, and so
// do `job_reservations.worker_id` and the `worker_id` log label, so it must
// be unique among running instances and across restarts: the orphan cleanup
// closes every open reservation under a worker id.
//
// The id is a base name plus a per-boot suffix. The base name is
// BOXEL_INSTANCE_ID when the deployment sets it, as a more readable name than
// the hostname, and the hostname otherwise. The suffix keeps the id unique
// when replicas share the setting, or when an instance reuses a hostname.
// Nothing here reads a platform-specific variable (ADR 003 §1.6).
//
// The worker manager passes its whole id to its workers in
// BOXEL_INHERITED_INSTANCE_ID, so every worker id begins with the id of the
// instance that runs it.
export const INSTANCE_ID_ENV = 'BOXEL_INSTANCE_ID';
export const INHERITED_INSTANCE_ID_ENV = 'BOXEL_INHERITED_INSTANCE_ID';
export const INSTANCE_ID_HEADER = 'X-Boxel-Instance-Id';

let instanceId: string | undefined;
let publicInstanceId: string | undefined;

export function getInstanceId(): string {
  if (instanceId === undefined) {
    let inherited = process.env[INHERITED_INSTANCE_ID_ENV]?.trim();
    let base = process.env[INSTANCE_ID_ENV]?.trim() || hostname();
    instanceId = inherited || `${base}-${randomBytes(4).toString('hex')}`;
  }
  return instanceId;
}

// What the `X-Boxel-Instance-Id` response header carries: a digest of the
// instance id. It tells replicas apart and changes when one restarts, without
// giving every client the hostname, which on most platforms names the
// instance's private address.
export function getPublicInstanceId(): string {
  publicInstanceId ??= createHash('sha256')
    .update(getInstanceId())
    .digest('hex')
    .slice(0, 12);
  return publicInstanceId;
}
