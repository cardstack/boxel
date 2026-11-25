import { concat } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import ExternalLink from '@cardstack/boxel-icons/external-link';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';

import type {
  default as HostModeService,
  OpenSiteHostURL,
} from '@cardstack/host/services/host-mode-service';

interface OpenSitePopoverArgs {
  isOpen: boolean;
  // Host Mode v2: the realm's host URLs, canonical first. They show before
  // the sites published with v1.
  hostURLs?: OpenSiteHostURL[];
}

export default class OpenSitePopover extends Component<OpenSitePopoverArgs> {
  @service declare hostModeService: HostModeService;

  get hostURLs() {
    return this.args.hostURLs ?? [];
  }

  get hasHostURLs() {
    return this.hostURLs.length > 0;
  }

  get hasPublishedRealms() {
    return this.hostModeService.publishedRealmMetadata.length > 0;
  }

  // Each list has a heading only when both show.
  get showsGroupLabels() {
    return this.hasHostURLs && this.hasPublishedRealms;
  }

  <template>
    {{#if @isOpen}}
      <div class='open-site-popover' data-test-open-site-popover>
        {{#if this.hasHostURLs}}
          <section>
            {{#if this.showsGroupLabels}}
              <h3 class='group-label' data-test-open-site-group='host-urls'>Host
                URLs</h3>
            {{/if}}
            <ul class='sites'>
              {{#each this.hostURLs as |hostURL|}}
                <li class='site' data-test-open-site-host-url={{hostURL.href}}>
                  <span
                    class='site-url'
                    title={{hostURL.href}}
                  >{{hostURL.href}}</span>
                  {{#if hostURL.isCanonical}}
                    <Chip
                      @label='Canonical'
                      @tone='success'
                      @dot={{false}}
                      data-test-open-site-canonical
                    />
                  {{/if}}
                  <Button
                    @tone='neutral'
                    @appearance='outlined'
                    @size='s'
                    @href={{hostURL.href}}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label={{concat 'Open ' hostURL.href}}
                    data-test-open-site-button
                  >
                    <ExternalLink width='16' height='16' aria-hidden='true' />
                    Open
                  </Button>
                </li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
        {{#if this.hasPublishedRealms}}
          <section>
            {{#if this.showsGroupLabels}}
              <h3 class='group-label' data-test-open-site-group='v1-sites'>
                Published with the old publishing
              </h3>
            {{/if}}
            <ul class='sites'>
              {{#each
                this.hostModeService.publishedRealmMetadata
                as |realmMetadata|
              }}
                <li
                  class='site'
                  data-test-published-realm-item={{realmMetadata.currentCardUrlString}}
                >
                  <span
                    class='site-url'
                    title={{realmMetadata.currentCardUrlString}}
                  >{{realmMetadata.currentCardUrlString}}</span>
                  <Button
                    @tone='neutral'
                    @appearance='outlined'
                    @size='s'
                    @href={{realmMetadata.currentCardUrlString}}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label={{concat
                      'Open '
                      realmMetadata.currentCardUrlString
                    }}
                    data-test-open-site-button
                  >
                    <ExternalLink width='16' height='16' aria-hidden='true' />
                    Open
                  </Button>
                </li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
        {{#unless this.hasHostURLs}}
          {{#unless this.hasPublishedRealms}}
            <p class='no-published-message'>No sites are currently published.</p>
          {{/unless}}
        {{/unless}}
      </div>
    {{/if}}

    <style scoped>
      .open-site-popover {
        position: absolute;
        top: 100%;
        right: 0;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        min-width: 20rem;
        max-width: 28rem;
        max-height: 20rem;
        overflow-y: auto;
        margin-top: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--popover);
        color: var(--popover-foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-box-shadow);
      }

      /* The popover renders outside a CardContainer, which would zero a
         heading's margin. */
      .group-label {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        line-height: var(--boxel-line-height-xs);
      }

      .sites {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .site {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) 0;
        border-bottom: 1px solid var(--border);
      }

      .site:last-child {
        border-bottom: none;
      }

      .site-url {
        flex: 1;
        min-width: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .no-published-message {
        padding: var(--boxel-sp);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-xs);
        font-style: italic;
        text-align: center;
      }
    </style>
  </template>
}
