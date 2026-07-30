import Service, { service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';

import {
  assertAllowedAIProxyURL,
  assertURLWithinRealm,
  snapshotFromCardDocument,
  type RealmSandboxProbeReport,
  type SpikeRealmConfig,
  type WorkerCapabilityRequest,
} from '@cardstack/host/lib/realm-isolation-spike';
import RealmIsolationWorkerRuntime from '@cardstack/host/lib/realm-isolation-worker-runtime';
import type NetworkService from '@cardstack/host/services/network';

export interface RealmSandboxProbeCard {
  id?: string;
  realmLabel?: string;
  realmURL?: string;
  targetCardURL?: string;
  targetEndpoint?: string;
}

interface RealmRuntimeEntry {
  cardURL: string;
  runtime: RealmIsolationWorkerRuntime;
}

export default class RealmSandboxService extends Service {
  @service declare private network: NetworkService;

  private runtimes = new Map<string, Promise<RealmRuntimeEntry>>();

  isSecurityProbe(card: object, format: string | undefined): boolean {
    return (
      format !== 'edit' &&
      format !== 'head' &&
      (card as { sandboxProfile?: string }).sandboxProfile ===
        'realm-exfiltration-probe'
    );
  }

  async runSecurityProbe(
    card: RealmSandboxProbeCard,
  ): Promise<RealmSandboxProbeReport> {
    let realmURL = this.requiredString(card.realmURL, 'realmURL');
    let targetCardURL = this.requiredString(
      card.targetCardURL,
      'targetCardURL',
    );
    let targetEndpoint = this.requiredString(
      card.targetEndpoint,
      'targetEndpoint',
    );
    let entry = await this.runtimeForRealm(realmURL, card);
    return await entry.runtime.invoke<RealmSandboxProbeReport>(
      'scrapeAll',
      targetCardURL,
      targetEndpoint,
    );
  }

  private async runtimeForRealm(
    realmURL: string,
    card: RealmSandboxProbeCard,
  ): Promise<RealmRuntimeEntry> {
    let cardURL = this.requiredString(card.id, 'card id');
    let existing = this.runtimes.get(realmURL);
    if (existing) {
      let entry = await existing;
      if (entry.cardURL !== cardURL) {
        throw new Error(
          `Realm sandbox is already bound to ${entry.cardURL}; per-card authority must be selected at invocation time before multiple active probe cards are supported`,
        );
      }
      return entry;
    }

    let pending = this.createRuntime(realmURL, cardURL, card.realmLabel);
    this.runtimes.set(realmURL, pending);
    try {
      return await pending;
    } catch (error) {
      this.runtimes.delete(realmURL);
      throw error;
    }
  }

  private async createRuntime(
    realmURL: string,
    cardURL: string,
    realmLabel: string | undefined,
  ): Promise<RealmRuntimeEntry> {
    let programURL = assertURLWithinRealm(
      realmURL,
      `${realmURL}security-probe-program.js`,
    ).href;
    let response = await this.network.authedFetch(programURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(
        `Could not load realm sandbox program: ${response.status} ${await response.text()}`,
      );
    }

    let config: SpikeRealmConfig = {
      realmURL,
      cardURL,
      programURL,
      label: realmLabel ?? realmURL,
      role: 'child',
      // The compartment gets a fetch-shaped capability. The host still
      // validates every destination, so attacker.invalid is rejected before
      // any network request is created.
      canUseAIProxy: true,
    };
    let runtime = new RealmIsolationWorkerRuntime(
      config,
      await response.text(),
      async (request) => await this.handleCapability(config, request),
    );
    return { cardURL, runtime };
  }

  private async handleCapability(
    config: SpikeRealmConfig,
    request: WorkerCapabilityRequest,
  ): Promise<unknown> {
    switch (request.operation) {
      case 'read-own-card':
        return await this.readCard(config, config.cardURL);
      case 'read-card':
        return await this.readCard(config, String(request.args[0] ?? ''));
      case 'proxy-fetch':
        // Throws for every target except the single approved AI proxy. This
        // probe deliberately asks for attacker.invalid.
        assertAllowedAIProxyURL(String(request.args[0] ?? ''));
        throw new Error('The security probe is not granted AI proxy access');
      default:
        throw new Error(
          `Capability ${request.operation} is not granted to this card`,
        );
    }
  }

  private async readCard(config: SpikeRealmConfig, cardURL: string) {
    assertURLWithinRealm(config.realmURL, cardURL);
    let response = await this.network.authedFetch(`${cardURL}.json`, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(`Could not read card ${cardURL}: ${response.status}`);
    }
    return snapshotFromCardDocument(cardURL, await response.json());
  }

  private requiredString(value: string | undefined, label: string): string {
    if (!value) {
      throw new Error(`Security probe card is missing ${label}`);
    }
    return value;
  }

  willDestroy() {
    super.willDestroy();
    for (let pending of this.runtimes.values()) {
      void pending.then(({ runtime }) => runtime.destroy());
    }
    this.runtimes.clear();
  }
}

declare module '@ember/service' {
  interface Registry {
    'realm-sandbox': RealmSandboxService;
  }
}
