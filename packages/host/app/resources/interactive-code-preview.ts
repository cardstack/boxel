import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import { Resource } from 'ember-modify-based-class-resource';

import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type CodePreviewSandbox from '../lib/code-preview-sandbox';
import type { BaseDef } from '@cardstack/base/card-api';

interface Args {
  named: {
    card: BaseDef;
    enabled: boolean;
  };
}

class InteractiveCodePreviewResource extends Resource<Args> {
  @service declare private realmSandbox: RealmSandboxService;
  private card?: BaseDef;
  private enabled = false;
  private unregister?: () => void;
  private releaseRealmRuntime?: () => void;

  constructor(owner: Owner) {
    super(owner);
    registerDestructor(this, () => {
      this.unregister?.();
      this.releaseRealmRuntime?.();
    });
  }

  modify(_positional: never[], named: Args['named']) {
    let { card, enabled } = named;
    if (this.card === card && this.enabled === enabled) {
      return;
    }
    if (this.card !== card) {
      this.unregister?.();
      this.unregister = undefined;
      this.releaseRealmRuntime?.();
      this.releaseRealmRuntime = this.realmSandbox.retainRealmCard(card);
      this.card = card;
    }
    if (this.enabled !== enabled) {
      this.unregister?.();
      this.unregister = undefined;
    }
    this.enabled = enabled;
    if (enabled && !this.unregister) {
      this.unregister = this.realmSandbox.registerInteractiveCodePreview(card);
    }
  }

  get preview(): CodePreviewSandbox | undefined {
    return this.card && this.enabled
      ? this.realmSandbox.interactiveCodePreviewFor(this.card)
      : undefined;
  }
}

export default function interactiveCodePreview(
  parent: object,
  args: () => Args['named'],
) {
  return InteractiveCodePreviewResource.from(parent, () => ({
    named: args(),
  })) as unknown as InteractiveCodePreviewResource;
}
