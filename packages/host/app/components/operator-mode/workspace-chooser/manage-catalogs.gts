import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Settings from '@cardstack/boxel-icons/settings';

import { Alert } from '@cardstack/pretui/components/alert';
import { Avatar } from '@cardstack/pretui/components/avatar';
import { Button } from '@cardstack/pretui/components/button';
import { Dialog } from '@cardstack/pretui/components/dialog';
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { Item } from '@cardstack/pretui/components/item';
import { List } from '@cardstack/pretui/components/list';
import { LoadingState } from '@cardstack/pretui/components/loading-state';
import { Scroller } from '@cardstack/pretui/components/scroller';
import { restartableTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { baseRealm, type PublicRealmSummary } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

interface ManageCatalogsModalSignature {
  Args: {
    onClose: () => void;
  };
}

// Lists the public realms the user could add to their Catalogs section — every
// public realm on their realm server except the ones already listed some other
// way — with the ones they added checked.
class ManageCatalogsModal extends Component<ManageCatalogsModalSignature> {
  @service declare private matrixService: MatrixService;
  @service declare private realmServer: RealmServerService;

  // Null until the list has loaded; Save stays disabled until then.
  @tracked private choices: PublicRealmSummary[] | null = null;
  @tracked private loadError: string | null = null;
  @tracked private selected: string[];
  @tracked private saveError: string | null = null;

  constructor(owner: Owner, args: ManageCatalogsModalSignature['Args']) {
    super(owner, args);
    this.selected = this.realmServer.userCatalogPicks;
    this.loadChoices.perform();
  }

  // Loaded here and handed to List as plain rows rather than through List's
  // `@load`: List's loader re-runs whenever any of its args change, so each
  // toggle of `@selected` would reload the rows and flash the skeleton.
  // Realms the dashboard already shows some other way, which the picker
  // doesn't offer.
  private get listedElsewhere() {
    return new Set<string>([
      baseRealm.url,
      ...this.realmServer.catalogRealmIdentifiers,
      ...this.realmServer.userRealmIdentifiers,
    ]);
  }

  private loadChoices = restartableTask(async () => {
    this.loadError = null;
    try {
      let listedElsewhere = this.listedElsewhere;
      let realms = await this.realmServer.fetchPublicRealms();
      this.choices = realms
        .filter(({ url }) => !listedElsewhere.has(url))
        .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    } catch (e: any) {
      this.loadError = e.message;
    }
  });

  private save = task(async () => {
    this.saveError = null;
    try {
      // The checked realms on offer, plus earlier picks the picker didn't
      // offer because another list shows them, so they come back if that
      // list stops showing them. A pick that is neither is no longer public,
      // and is dropped.
      let selected = new Set(this.selected);
      let listedElsewhere = this.listedElsewhere;
      let kept = this.realmServer.userCatalogPicks.filter((url) =>
        listedElsewhere.has(url),
      );
      let chosen = (this.choices ?? [])
        .map(({ url }) => url)
        .filter((url) => selected.has(url));
      await this.matrixService.setUserCatalogRealms([
        ...new Set([...kept, ...chosen]),
      ]);
      this.args.onClose();
    } catch (e: any) {
      this.saveError = e.message;
    }
  });

  private rowKey = (realm: PublicRealmSummary) => realm.url;

  private rowLabel = (realm: PublicRealmSummary) => displayName(realm);

  private iconSrc = (realm: PublicRealmSummary) => realm.iconURL ?? undefined;

  private setSelected = (keys: (string | number)[]) => {
    this.selected = keys.map(String);
  };

  // A click anywhere on a row, or Enter on it, toggles the row like its
  // checkbox does.
  private toggle = (realm: PublicRealmSummary) => {
    this.selected = this.selected.includes(realm.url)
      ? this.selected.filter((url) => url !== realm.url)
      : [...this.selected, realm.url];
  };

  private get rows(): PublicRealmSummary[] {
    return this.choices ?? [];
  }

  private get isSaveDisabled() {
    return this.choices === null;
  }

  <template>
    <Dialog
      @open={{true}}
      @onClose={{@onClose}}
      @label='Choose Catalogs'
      @size='m'
      class='manage-catalogs-dialog'
      data-test-manage-catalogs-modal
    >
      <:title>Choose Catalogs</:title>
      <:default>
        <p class='intro'>
          Choose public realms to show in your Catalogs section.
        </p>
        {{#if this.loadChoices.isRunning}}
          <LoadingState
            @label='Loading public realms'
            class='loading'
            data-test-public-realms-loading
          />
        {{else if this.loadError}}
          <Alert
            @tone='danger'
            @title="Couldn't load the public realms"
            data-test-manage-catalogs-error
          >
            {{this.loadError}}
          </Alert>
        {{else}}
          <div class='realm-list-frame'>
            <Scroller @orientation='vertical'>
              <List
                @items={{this.rows}}
                @key={{this.rowKey}}
                @rowLabel={{this.rowLabel}}
                @label='Public realms'
                @selectionMode='multi'
                @selected={{this.selected}}
                @onSelectionChange={{this.setSelected}}
                @onActivate={{this.toggle}}
                @itemNoun='realm'
                @emptyTitle='Nothing more to add'
                @emptyMessage='Every public realm is already in your Catalogs or Your Workspaces.'
                data-test-public-realm-list
              >
                <:item as |realm|>
                  <Item
                    @title={{displayName realm}}
                    @description={{realm.url}}
                    data-test-public-realm={{realm.url}}
                  >
                    <:leading>
                      <span class='realm-icon'>
                        <Avatar
                          @name={{displayName realm}}
                          @src={{this.iconSrc realm}}
                          @size={{32}}
                        />
                      </span>
                    </:leading>
                  </Item>
                </:item>
              </List>
            </Scroller>
          </div>
        {{/if}}
        {{#if this.saveError}}
          <Alert
            @tone='danger'
            @title="Couldn't save your catalogs"
            data-test-manage-catalogs-error
          >
            {{this.saveError}}
          </Alert>
        {{/if}}
      </:default>
      <:footer>
        <Button
          @variant='secondary'
          {{on 'click' @onClose}}
          data-test-cancel-manage-catalogs
        >
          Cancel
        </Button>
        <Button
          @variant='primary'
          @busy={{this.save.isRunning}}
          @disabled={{this.isSaveDisabled}}
          {{on 'click' (perform this.save)}}
          data-test-save-manage-catalogs
        >
          Save
        </Button>
      </:footer>
    </Dialog>
    <style scoped>
      .intro {
        margin: 0;
      }
      /* The dialog inherits the chooser's light-on-dark scrollbar color;
         restate it from the dialog's own tokens, light or dark. */
      .realm-list-frame {
        scrollbar-color: color-mix(
            in oklch,
            var(--muted-foreground) 50%,
            transparent
          )
          transparent;
      }
      .realm-list-frame :deep(.pretui-scroller-viewport) {
        max-height: min(50dvh, 26rem);
      }
      /* Realm icons are rounded squares on the workspace tiles; match them. */
      .realm-icon :deep(.pretui-avatar) {
        border-radius: var(--boxel-border-radius-xs);
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: var(--boxel-sp-lg) 0;
      }
    </style>
  </template>
}

function displayName(realm: PublicRealmSummary): string {
  return realm.name ?? realm.url;
}

// The gear beside the Catalogs heading that opens the catalog picker.
export default class ManageCatalogs extends Component {
  @tracked private isModalOpen = false;

  private setIsModalOpen = (value: boolean) => {
    this.isModalOpen = value;
  };

  <template>
    <span class='manage-catalogs'>
      <IconButton
        @label='Choose catalogs'
        @icon={{Settings}}
        @iconWidth='16'
        @iconHeight='16'
        @variant='ghost'
        @size='s'
        {{on 'click' (fn this.setIsModalOpen true)}}
        data-test-manage-catalogs
      />
    </span>
    {{#if this.isModalOpen}}
      <ManageCatalogsModal @onClose={{fn this.setIsModalOpen false}} />
    {{/if}}
    <style scoped>
      .manage-catalogs {
        display: inline-flex;
      }
      .manage-catalogs :deep(.pretui-iconbtn) {
        color: var(--boxel-light);
        background: transparent;
      }
      .manage-catalogs :deep(.pretui-iconbtn:hover),
      .manage-catalogs :deep(.pretui-iconbtn:focus-visible) {
        color: var(--boxel-highlight);
      }
    </style>
  </template>
}
