import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

// Names the running instance of a service. Worker ids begin with it, and so
// do `job_reservations.worker_id` and the `worker_id` log label. The
// `X-Boxel-Instance-Id` response header carries it, which tells apart the
// replicas behind a load balancer.
//
// A deployment may set BOXEL_INSTANCE_ID when its platform has a better name.
// Otherwise the id is the hostname, which is unique among running containers
// on every common platform, plus a per-boot suffix, so that an instance on a
// reused hostname never takes an earlier instance's id. Nothing here reads a
// platform-specific variable (ADR 003 §1.6).
//
// The worker manager passes its id to its workers in BOXEL_INSTANCE_ID, so
// every worker id begins with the id of the instance that runs it.
export const INSTANCE_ID_ENV = 'BOXEL_INSTANCE_ID';
export const INSTANCE_ID_HEADER = 'X-Boxel-Instance-Id';

let instanceId: string | undefined;

export function getInstanceId(): string {
  instanceId ??=
    process.env[INSTANCE_ID_ENV]?.trim() ||
    `${hostname()}-${randomBytes(4).toString('hex')}`;
  return instanceId;
}
