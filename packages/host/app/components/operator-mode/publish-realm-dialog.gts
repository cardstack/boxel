import { guidFor } from '@ember/object/internals';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import perform from 'ember-concurrency/helpers/perform';
import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import PublishRealmModal from '@cardstack/host/components/operator-mode/publish-realm-modal';
import { modalFocusTrapOptions } from '@cardstack/host/lib/modal-focus-trap';
import type { PublishRealmActions } from '@cardstack/host/lib/publish-realm-actions';
import type RealmService from '@cardstack/host/services/realm';

interface Signature {
  Args: {
    // The workspace to publish.
    realmURL: string;
    // Its publish and unpublish commands, from the realm-publishing service.
    actions: PublishRealmActions;
    isOpen: boolean;
    onClose: () => void;
    // Where focus goes when the dialog closes, when not back to where it was.
    returnFocusTarget?: () => HTMLElement | undefined;
  };
}

// The publish dialog for one workspace. Focus moves into it on open, stays
// in it, and Escape closes it.
export default class PublishRealmDialog extends Component<Signature> {
  @service declare private realm: RealmService;

  private dialogId = guidFor(this);

  // The visible title asks "Where to?"; the name says what is published.
  private get label() {
    return `Publish ${this.realm.info(this.args.realmURL).name}`;
  }

  private get focusTrapOptions() {
    return modalFocusTrapOptions(this.dialogId, this.args);
  }

  <template>
    <PublishRealmModal
      @realmURL={{@realmURL}}
      @isOpen={{@isOpen}}
      @onClose={{@onClose}}
      @handlePublish={{@actions.publish}}
      @publishError={{@actions.publishError}}
      @handleUnpublish={{perform @actions.unpublishTask}}
      aria-label={{this.label}}
      id={{this.dialogId}}
      tabindex='-1'
      {{focusTrap focusTrapOptions=this.focusTrapOptions}}
    />
  </template>
}
