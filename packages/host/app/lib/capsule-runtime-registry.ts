import type CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import RetainedRuntimeRegistry from '@cardstack/host/lib/retained-runtime-registry';

/** Principal-keyed warm lifetime for Capsule runtimes. */
export default class CapsuleRuntimeRegistry extends RetainedRuntimeRegistry<CapsuleBoxelRuntime> {}
