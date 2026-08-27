import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import type Owner from '@ember/owner';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import ScrollTextIcon from '@cardstack/boxel-icons/scroll-text';

import { StatusBoard } from '../components/status-board';
import { Feed, type FeedEntry } from '../components/feed';
import sortBy from '../utils/sort';
import filterBy from '../utils/filter';
import { Quest, QuestStatusField } from './quest';
import { Session } from './session';
import { Badge } from './badge';

/**
 * The quest log book: every surface is a consumed block. The board is
 * StatusBoard over the quest lifecycle, the journal is Feed over sessions,
 * ordering and archived-hiding come from the shared sort/filter utils. The
 * app owns only its chrome — masthead, columns, the warm journal identity.
 */
export class QuestLog extends CardDef {
  static displayName = 'Quest Log';
  static icon = ScrollTextIcon;
  static prefersWideFormat = true;

  @field appTitle = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: QuestLog) {
      return this.appTitle?.trim()?.length ? this.appTitle : 'Quest Log';
    },
  });

  static isolated = class Isolated extends Component<typeof QuestLog> {
    private questList: ReturnType<getCards> | undefined;
    private sessionList: ReturnType<getCards> | undefined;
    private badgeList: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      let live = { isLive: true };
      let realms = () => this.realms;
      let queryFor = (type: any) => () => {
        let ref = identifyCard(type);
        return ref ? { filter: { type: ref } } : undefined;
      };
      let ctx = this.args.context;
      this.questList = ctx?.getCards(this, queryFor(Quest), realms, live);
      this.sessionList = ctx?.getCards(this, queryFor(Session), realms, live);
      this.badgeList = ctx?.getCards(this, queryFor(Badge), realms, live);
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    private get realm(): string | undefined {
      return this.realms?.[0];
    }

    private get commandContext() {
      return (this.args as any).context?.commandContext;
    }

    // Prerender gets the static shell; the live app gets the board.
    get interactive() {
      return Boolean((this.args as any).viewCard);
    }

    get quests(): Quest[] {
      let all = ((this.questList?.instances ?? []) as Quest[]).filter(Boolean);
      return filterBy(all, (q) => q.recordStatus !== 'Archived');
    }

    get archivedCount(): number {
      return ((this.questList?.instances ?? []) as Quest[])
        .filter(Boolean)
        .filter((q) => q.recordStatus === 'Archived').length;
    }

    get sessions(): Session[] {
      return ((this.sessionList?.instances ?? []) as Session[]).filter(
        Boolean,
      );
    }

    get sessionEntries(): FeedEntry[] {
      let recent = sortBy(
        this.sessions,
        (s) => s.startedAt,
        'desc',
      ).slice(0, 8);
      return recent.map((s) => ({
        id: s.id,
        actor: s.cardTitle,
        initials: s.mood ?? '·',
        meta: s.quest?.cardTitle ?? undefined,
        body: s.achievements ?? undefined,
        at: s.startedAt ?? undefined,
        kind: 'inward' as const,
      }));
    }

    get badges(): Badge[] {
      let visible = filterBy(
        ((this.badgeList?.instances ?? []) as Badge[]).filter(Boolean),
        (b) => b.isVisible !== false,
      );
      return sortBy(visible, (b) => b.claimedAt, 'desc').slice(0, 6);
    }

    statusOf = (item: CardDef) => (item as Quest).status;

    onMove = async (item: CardDef, statusValue: string) => {
      if (!this.commandContext) {
        return;
      }
      (item as Quest).status = statusValue;
      await new SaveCardCommand(this.commandContext).execute({
        card: item,
      } as any);
    };

    onOpen = (item: CardDef) => {
      (this.args as any).viewCard?.(item, 'isolated');
    };

    openCard = (card: CardDef | undefined) => {
      if (card) {
        (this.args as any).viewCard?.(card, 'isolated');
      }
    };

    openSessionEntry = (entry: FeedEntry) => {
      this.openCard(this.sessions.find((s) => s.id === entry.id));
    };

    newQuest = async () => {
      let ref = identifyCard(Quest);
      if (!ref) {
        return;
      }
      await (this.args as any).createCard?.(ref, undefined, {
        realmURL: this.realm ? new URL(this.realm) : undefined,
        doc: {
          data: {
            attributes: {
              status: 'Active',
              recordStatus: 'Active',
              createdAt: new Date().toISOString(),
            },
            meta: { adoptsFrom: ref },
          },
        },
      });
    };

    logSession = async () => {
      let ref = identifyCard(Session);
      if (!ref) {
        return;
      }
      await (this.args as any).createCard?.(ref, undefined, {
        realmURL: this.realm ? new URL(this.realm) : undefined,
        doc: {
          data: {
            attributes: {
              startedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
            meta: { adoptsFrom: ref },
          },
        },
      });
    };

    claimBadge = async () => {
      let ref = identifyCard(Badge);
      if (!ref) {
        return;
      }
      await (this.args as any).createCard?.(ref, undefined, {
        realmURL: this.realm ? new URL(this.realm) : undefined,
        doc: {
          data: {
            attributes: {
              claimedAt: new Date().toISOString(),
              isVisible: true,
            },
            meta: { adoptsFrom: ref },
          },
        },
      });
    };

    <template>
      <div class='quest-log'>
        <header class='masthead'>
          <div class='wordmark'>
            <h1>{{@model.cardTitle}}</h1>
            <p class='tagline'>Your pursuits, at your pace.</p>
          </div>
          {{#if this.interactive}}
            <div class='actions'>
              <BoxelButton
                @kind='secondary-light'
                @size='small'
                {{on 'click' this.logSession}}
              >Log session</BoxelButton>
              <BoxelButton
                @kind='secondary-light'
                @size='small'
                {{on 'click' this.claimBadge}}
              >Claim badge</BoxelButton>
              <BoxelButton
                @kind='primary'
                @size='small'
                {{on 'click' this.newQuest}}
              >New quest</BoxelButton>
            </div>
          {{/if}}
        </header>

        <div class='body'>
          <section class='board-pane'>
            {{#if this.interactive}}
              <StatusBoard
                @boardLabel='Quests'
                @items={{this.quests}}
                @statusField={{QuestStatusField}}
                @statusOf={{this.statusOf}}
                @onMove={{this.onMove}}
                @onOpen={{this.onOpen}}
              />
            {{else}}
              <div class='shell'>
                <p class='shell-count'>Quests in the log:
                  {{this.quests.length}}</p>
              </div>
            {{/if}}
            {{#if this.archivedCount}}
              <p class='archived-note'>{{this.archivedCount}}
                archived quest{{if (gtOne this.archivedCount) 's'}}
                — open one from search to bring it back.</p>
            {{/if}}
          </section>

          <aside class='rail'>
            <section class='panel'>
              <h2>Recent sessions</h2>
              <Feed
                @entries={{this.sessionEntries}}
                @newestFirst={{true}}
                @onSelect={{this.openSessionEntry}}
                @emptyMessage='No sessions yet — log the first five minutes.'
              />
            </section>
            <section class='panel'>
              <h2>Trophy shelf</h2>
              {{#if this.badges.length}}
                <ul class='shelf'>
                  {{#each this.badges as |badge|}}
                    <li>
                      <button
                        type='button'
                        class='shelf-badge'
                        {{on 'click' (fn this.openCard badge)}}
                      >
                        <span class='shelf-icon'>{{if
                            badge.icon
                            badge.icon
                            '🏆'
                          }}</span>
                        <span class='shelf-title'>{{badge.cardTitle}}</span>
                      </button>
                    </li>
                  {{/each}}
                </ul>
              {{else}}
                <p class='empty'>Badges you claim appear here.</p>
              {{/if}}
            </section>
          </aside>
        </div>
      </div>
      <style scoped>
        .quest-log {
          height: 100%;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          box-sizing: border-box;
          overflow: auto;
        }
        .masthead {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 3px double var(--primary, var(--boxel-warning));
          padding-bottom: 1rem;
        }
        .wordmark h1 {
          margin: 0;
          font-size: 2.25rem;
          line-height: 1;
          font-family: var(--font-heading, inherit);
          letter-spacing: -0.01em;
        }
        .tagline {
          margin: 0.375rem 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .actions {
          display: flex;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .body {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 20rem;
          gap: 1.25rem;
          flex: 1;
          min-height: 0;
        }
        @container (width < 860px) {
          .body {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .board-pane {
          min-height: 24rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .shell {
          border: 1px dashed var(--border, var(--boxel-200));
          border-radius: 0.75rem;
          padding: 2rem;
          text-align: center;
        }
        .shell-count {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .archived-note {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .rail {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          min-width: 0;
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, var(--boxel-light));
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .shelf {
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .shelf li {
          list-style: none;
        }
        .shelf-badge {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          width: 100%;
          border: none;
          background: none;
          cursor: pointer;
          padding: 0.25rem 0.375rem;
          border-radius: var(--boxel-border-radius-sm);
          text-align: left;
          color: inherit;
          font-family: inherit;
        }
        .shelf-badge:hover {
          background: var(--muted, var(--boxel-100));
        }
        .shelf-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 1.75rem;
          height: 1.75rem;
          border-radius: 50%;
          font-size: 0.9375rem;
          flex: none;
          background: color-mix(
            in oklch,
            var(--primary, var(--boxel-warning)) 18%,
            var(--card, var(--boxel-light))
          );
          box-shadow: inset 0 0 0 1.5px var(--primary, var(--boxel-warning));
        }
        .shelf-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };
}

function gtOne(n: number): boolean {
  return n > 1;
}

export default QuestLog;
