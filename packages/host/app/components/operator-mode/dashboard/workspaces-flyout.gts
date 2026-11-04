import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import RealmListFlyout from './realm-list-flyout';
import { sortByUpdatedAtDesc } from './workspace-layout';

import type { SectionFlyoutSignature } from './sections';

// The Workspaces entry's flyout: every workspace of the user's own, most
// recently updated first, whatever the page's filter.
export default class WorkspacesFlyout extends Component<SectionFlyoutSignature> {
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @cached
  private get workspaceURLs() {
    return sortByUpdatedAtDesc(
      this.realmServer.userRealmIdentifiers,
      this.realm.info,
    );
  }

  <template>
    <RealmListFlyout
      @title='Workspaces'
      @titleId={{@titleId}}
      @close={{@close}}
      @realmURLs={{this.workspaceURLs}}
      @emptyMessage='No workspaces yet. Create one from the Workspaces section.'
    />
  </template>
}
