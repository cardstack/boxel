import CodeRefField from 'https://cardstack.com/base/code-ref';
import {
  CardDef,
  field,
  contains,
  containsMany,
  FieldDef,
  Component,
  realmURL,
  StringField,
  type CardContext,
} from 'https://cardstack.com/base/card-api';
import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { TabbedHeader } from '@cardstack/boxel-ui/components';

import { ViewField } from './view';
import { PrerenderedCard } from '@cardstack/runtime-common';

export class Tab extends FieldDef {
  @field displayName = contains(StringField);
  @field tabId = contains(StringField);
  // @field ref = contains(CodeRefField);
  @field view = contains(ViewField);
}

class ListingCardIsolated extends Component<typeof listingCard> {
  //tou have this plan
  mockPlan: Card[] = Array.from({ length: 3 }, (_, index) => ({
    title: `card ${index + 1}`,
    description: 'desc',
  }));

  // image videos
  mockImagesAndVideos: Card[] = Array.from({ length: 6 }, (_, index) => ({
    title: `card ${index + 1}`,
    description: 'desc',
  }));

  <template>
    <section class='listing-card'>
      <TabbedHeader
        @title={{@model.title}}
        @tabs={{this.tabs}}
        @onSetActiveTab={{this.setActiveTab}}
        @activeTabIndex={{this.activeTabIndex}}
        @headerBackgroundColor={{this.headerColor}}
      >
        <:headerIcon>

          {{! temporaily no need this }}
        </:headerIcon>
      </TabbedHeader>
      <div class='listing-card-content'>
        {{#if this.activeTab}}

          <main>
            <aside class='sidebar-left column'>
              category
            </aside>
            <div class='main-content column'>

              {{#if (eq this.activeTabView 'grid')}}
                <section class='masthead'>
                  <aside>
                    <div class='logo'></div>
                  </aside>
                  <div class='info'>
                    <div class='title'>Invoice Generator</div>
                    <div>by @author</div>

                    <div class='sub-title mt-5'>Summary</div>
                    <div class='desc mt-2'>Lorem ipsum, dolor sit amet
                      consectetur adipisicing elit. Tempore, accusamus!</div>

                    <CardsGridComponent
                      @instances={{this.mockPlan}}
                      @displayFormat='grid'
                      @class='mt-5'
                    />

                  </div>
                </section>
                <section class='images-videos'>
                  <div class='title'>Images & Videos</div>
                  <div class='layout mt-5'>
                    <div class='card'>
                      <div class='card-content-center'>
                        <div class='card-title text-center'>
                          card
                        </div>
                        <p class='card-desc text-center'>card desc</p>
                      </div>
                    </div>

                    <CardsGridComponent
                      @instances={{this.mockImagesAndVideos}}
                      @displayFormat='grid'
                    />
                  </div>
                </section>
                <section class='examples'>
                  <div class='title'>Examples</div>
                </section>
                <section class='categories'>
                  <div class='title'>Categories</div>
                </section>
                <section class='includes-these-boxels'>
                  <div class='title'>Include These Boxels</div>
                </section>

              {{/if}}

              {{#if (eq this.activeTabView 'list')}}
                <CardsGridComponent
                  @instances={{this.mockImagesAndVideos}}
                  @displayFormat='list'
                />
              {{/if}}
            </div>
            <aside class='sidebar-right column'>
              relationship
            </aside>
          </main>

        {{/if}}

      </div>
    </section>
    <style>
      div {
        font-size: 0.8rem;
      }
      .listing-card {
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        color: var(--boxel-dark);
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
      }
      .listing-card-content {
        width: 100%;
        margin: 0 auto;
        padding: var(--boxel-sp);
      }
      main {
        display: grid;
        grid-template-columns: 200px minmax(auto, 1fr) 200px;
        gap: var(--boxel-sp-lg);
        container-name: main;
        container-type: inline-size;
      }
      .column {
        background-color: white;
        padding: clamp(var(--boxel-sp), var(--boxel-sp-lg), var(--boxel-sp-xl));
        border: 1px solid #dddddd;
        border-radius: 1rem;
      }
      .card {
        overflow: hidden;
        cursor: pointer;
        background: white;
        border: 1px solid #dddddd;
        border-radius: 1rem;
        padding: var(--boxel-sp);
        container-name: embedded-card;
        container-type: inline-size;
      }
      .card-content-center {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .card-title {
        font-size: 1rem;
        font-weight: bold;
      }
      .card-desc {
        font-size: 12px;
      }
      .text-center {
        text-align: center;
      }
      .title {
        font-size: 1.3rem;
        font-weight: bold;
      }
      .sub-title {
        font-size: 0.95rem;
        font-weight: bold;
      }
      .mt-1 {
        margin-top: 0.25rem;
      } /* 4px */
      .mt-2 {
        margin-top: 0.5rem;
      } /* 8px */
      .mt-3 {
        margin-top: 0.75rem;
      } /* 12px */
      .mt-4 {
        margin-top: 1rem;
      } /* 16px */
      .mt-5 {
        margin-top: 1.25rem;
      } /* 20px */
      .mt-6 {
        margin-top: 1.5rem;
      } /* 24px */
      .mt-7 {
        margin-top: 1.75rem;
      } /* 28px */
      .mt-8 {
        margin-top: 2rem;
      } /* 32px */
      .masthead {
        display: grid;
        grid-template-columns: 1fr 4fr;
        gap: var(--boxel-sp-lg);
      }
      .masthead .logo {
        background: gray;
        border: 1px solid #dddddd;
        border-radius: 1rem;
        aspect-ratio: 1 / 1;
      }
      .main-content > * + * {
        margin-top: 4rem;
        container-name: main-content;
        container-type: inline-size;
      }

      .main-content section.images-videos .layout {
        display: grid;
        grid-template-columns: minmax(300px, 1fr) 1fr;
        gap: var(--boxel-sp-lg);
      }

      @container main-content (max-width: 500px) {
        .main-content section.images-videos .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>

  @tracked tabs = this.args.model.tabs;
  @tracked activeTabIndex = 0;
  @tracked private declare liveQuery: {
    instances: CardDef[];
    isLoading: boolean;
  };
  @tracked errorMessage = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.setTab();
  }

  setTab() {
    let index = this.tabs?.findIndex(
      (tab: Tab) => tab.tabId === window.location?.hash?.slice(1),
    );

    if (index && index !== -1) {
      this.activeTabIndex = index;
    }
  }

  get currentRealm() {
    return this.args.model[realmURL];
  }

  get activeTab() {
    if (!this.tabs?.length) {
      return;
    }
    let tab = this.tabs[this.activeTabIndex];
    if (!tab) {
      return;
    }
    return tab;
  }

  get activeTabView() {
    if (!this.tabs) return;
    return this.tabs[this.activeTabIndex].view.displayFormat;
  }

  get headerColor() {
    return (
      Object.getPrototypeOf(this.args.model).constructor.headerColor ??
      undefined
    );
  }

  get tableData() {
    if (!this.instances) {
      return;
    }
    let exampleCard = this.instances[0];
    let headers: string[] = [];
    for (let fieldName in exampleCard) {
      if (
        fieldName !== 'title' &&
        fieldName !== 'description' &&
        fieldName !== 'thumbnailURL' &&
        fieldName !== 'id'
      ) {
        headers.push(fieldName);
      }
    }
    headers.sort();

    let rows = this.instances.map((card) => {
      let row: string[] = [];
      for (let header of headers) {
        row.push((card as any)[header]);
      }
      return row;
    });
    return {
      headers,
      rows,
    };
  }

  @action setActiveTab(index: number) {
    this.activeTabIndex = index;
  }

  get instances() {
    return this.liveQuery?.instances;
  }
}

export class listingCard extends CardDef {
  static displayName = 'Listing Card';
  static prefersWideFormat = true;
  static headerColor = '#53c22d';
  @field tabs = containsMany(Tab);
  static isolated = ListingCardIsolated;
}

type Instance = CardDef | PrerenderedCard;

interface Card {
  title: string;
  description: string;
}

export class CardsGridComponent extends GlimmerComponent<{
  Args: {
    instances?: Instance[] | [] | Card[];
    context?: CardContext;
    displayFormat: 'grid' | 'list' | string;
    class?: string;
  };
  Element: HTMLElement;
}> {
  <template>
    <div class={{cn 'cards-layout' this.args.class}}>
      {{!-- <p style='margin-bottom:1rem;color:red'>Display:
        {{this.args.displayFormat}}</p> --}}

      <div class={{cn 'cards' this.args.displayFormat}} ...attributes>
        {{#each this.args.instances as |card|}}
          <div class='card'>
            <div class='card-content-center'>
              <div class='card-title text-center'>{{card.title}}</div>
              <p class='card-desc text-center'>{{card.description}}</p>
            </div>
          </div>
        {{/each}}
      </div>
    </div>
    <style>
      .cards-layout {
        position: relative;
        container-name: cards-layout;
      }
      .cards,
      .cards.grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--boxel-sp);
      }
      .cards.list {
        display: block;
      }
      .cards.list > * + * {
        margin-top: 1rem;
        display: block;
      }
      .card {
        overflow: hidden;
        cursor: pointer;
        background: white;
        border: 1px solid #dddddd;
        border-radius: 1rem;
        padding: var(--boxel-sp);
        container-name: embedded-card;
        container-type: inline-size;
      }
      .card-content-center {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .card-title {
        font-size: 1rem;
        font-weight: bold;
      }
      .card-desc {
        font-size: 12px;
      }
      .text-center {
        text-align: center;
      }
      .mt-1 {
        margin-top: 0.25rem;
      } /* 4px */
      .mt-2 {
        margin-top: 0.5rem;
      } /* 8px */
      .mt-3 {
        margin-top: 0.75rem;
      } /* 12px */
      .mt-4 {
        margin-top: 1rem;
      } /* 16px */
      .mt-5 {
        margin-top: 1.25rem;
      } /* 20px */
      .mt-6 {
        margin-top: 1.5rem;
      } /* 24px */
      .mt-7 {
        margin-top: 1.75rem;
      } /* 28px */
      .mt-8 {
        margin-top: 2rem;
      } /* 32px */

      @container cards-layout (max-width: 700px) {
        .cards,
        .cards.grid {
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        }
      }
    </style>
  </template>

  getComponent = (card: CardDef) => card.constructor.getComponent(card);
}

function removeFileExtension(cardUrl: string) {
  return cardUrl.replace(/\.[^/.]+$/, '');
}
