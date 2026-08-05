import {
  decideBoxelExecution,
  type BoxelExecutionDecision,
  type BoxelExecutionPolicyInput,
} from './boxel-execution-policy';
import CapsuleRuntimeRegistry from './capsule-runtime-registry';

import RetainedRuntimeRegistry from './retained-runtime-registry';

import type { BoxelRuntime } from './boxel-runtime';
import type CapsuleBoxelRuntime from './capsule-boxel-runtime';

import type DirectBoxelRuntime from './direct-boxel-runtime';

import type SandboxRuntimeProcess from './sandbox-runtime-process';

export interface BoxelRuntimeRouteInput extends BoxelExecutionPolicyInput {
  /** Viewer/app execution principal, not a data Realm URL. */
  principal: string;
  /** Stable mounted surface identity for a persistent Sandbox child. */
  surfaceId: string;
}

export interface BoxelRuntimeLease {
  runtime: BoxelRuntime;
  decision: BoxelExecutionDecision;
  release(): void;
}

/**
 * Central execution owner. Direct is shared across the Host, Capsule is
 * retained per principal, and Sandbox is retained per mounted surface.
 */
export default class BoxelRuntimeRouter {
  private capsuleRuntimes: CapsuleRuntimeRegistry;
  private sandboxRuntimes: RetainedRuntimeRegistry<SandboxRuntimeProcess>;

  constructor(
    private directRuntime: DirectBoxelRuntime,
    createCapsule: (principal: string) => CapsuleBoxelRuntime,
    createSandbox: (surfaceIdentity: string) => SandboxRuntimeProcess,
    idleTTL = 90_000,
  ) {
    this.capsuleRuntimes = new CapsuleRuntimeRegistry(
      createCapsule,
      () => undefined,
      idleTTL,
    );
    this.sandboxRuntimes = new RetainedRuntimeRegistry(
      createSandbox,
      () => undefined,
      idleTTL,
    );
  }

  route(input: BoxelRuntimeRouteInput): BoxelRuntimeLease {
    let decision = decideBoxelExecution(input);
    if (decision.mode === 'direct') {
      return {
        runtime: this.directRuntime,
        decision,
        release: () => undefined,
      };
    }
    if (decision.mode === 'capsule') {
      let runtime = this.capsuleRuntimes.runtimeFor(input.principal);
      let release = this.capsuleRuntimes.retain(input.principal);
      return { runtime, decision, release };
    }
    let identity = `${input.principal}:${input.surfaceId}`;
    let runtime = this.sandboxRuntimes.runtimeFor(identity);
    let release = this.sandboxRuntimes.retain(identity);
    return { runtime, decision, release };
  }

  destroy(): void {
    this.capsuleRuntimes.destroy();
    this.sandboxRuntimes.destroy();
  }
}
