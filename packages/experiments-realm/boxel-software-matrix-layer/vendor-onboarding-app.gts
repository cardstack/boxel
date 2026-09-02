import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import {
  identifyCard,
  realmURL,
  type getCards,
} from '@cardstack/runtime-common';
import type Owner from '@ember/owner';
import { tracked } from '@glimmer/tracking';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { VendorProfile, VendorProfileStatusField } from './vendor-profile';
import { StatusBoard } from './components/status-board';
import { StatePill } from './components/state-pill';

// Vendor Onboarding App — the single-persona intake console. Composes
// matrix blocks UNCHANGED: the vetting pipeline is the shared StatusBoard
// (Board + statusField join), whose columns derive from
// VendorProfileStatusField's own options and whose drag legality comes from
// that field's transition graph — dragging a profile to `onboarded` is
// refused by the graph itself, because activation must go through
// OnboardVendorCommand on the profile card. Prerender gets a static shell
// (the board mounts only when CRUD functions are present), which also keeps
// indexing light.
export class VendorOnboardingApp extends CardDef {
  static displayName = 'Vendor Onboarding';
  static headerColor = '#3e4e88';
  static prefersWideFormat = true;

  @field cardTitle = contains(StringField, {
    computeVia: function () {
      return 'Vendor Onboarding';
    },
  });

  static isolated = class Isolated extends Component<
    typeof VendorOnboardingApp
  > {
    @tracked flash: string | undefined;
    @tracked flashKind: 'ok' | 'warn' = 'ok';

    private profileList: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      this.profileList = this.args.context?.getCards(
        this,
        () => {
          let ref = identifyCard(VendorProfile);
          return ref ? { filter: { type: ref } } : undefined;
        },
        () => this.realms,
        { isLive: true },
      );
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    // Card CRUD functions ride on component args only in interactive
    // contexts; prerender gets the static shell so the indexer never mounts
    // the board (known Glimmer backtracking trap with boards in prerender).
    get isInteractive() {
      return Boolean((this.args as any).viewCard);
    }

    get profiles(): VendorProfile[] {
      return ((this.profileList?.instances ?? []) as VendorProfile[]).filter(
        Boolean,
      );
    }

    get compliantCount() {
      return this.profiles.filter((p) => p.complianceOk).length;
    }

    get awaitingReview() {
      return this.profiles.filter(
        (p) => (p.status ?? 'intake') === 'intake' || p.status === 'under-review',
      ).length;
    }

    // The masthead's narrative beat: what is waiting on YOU right now.
    get callToAction(): string {
      let waiting = this.awaitingReview;
      let lapsed = this.profiles.filter((p) => !p.complianceOk).length;
      if (waiting === 0 && lapsed === 0) {
        return 'Pipeline clear — every profile vetted, every credential current.';
      }
      let parts: string[] = [];
      if (waiting > 0) {
        parts.push(
          `${waiting} profile${waiting === 1 ? '' : 's'} waiting on your review`,
        );
      }
      if (lapsed > 0) {
        parts.push(`${lapsed} with lapsed compliance`);
      }
      return parts.join(' · ');
    }

    statusField = VendorProfileStatusField;

    statusOf = (item: any) => (item as VendorProfile).status ?? 'intake';

    openCard = (card: CardDef) => {
      (this.args as any).viewCard?.(card, 'isolated');
    };

    addProfile = () => {
      let ref = identifyCard(VendorProfile);
      let realm = this.realms?.[0];
      if (!ref || !realm) {
        return;
      }
      (this.args as any).createCard?.(ref, undefined, {
        realmURL: new URL(realm),
        doc: {
          data: {
            attributes: { status: 'intake' },
            meta: { adoptsFrom: ref },
          },
        },
      });
    };

    onMove = async (item: CardDef, statusValue: string) => {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        return;
      }
      this.flash = undefined;
      try {
        await new PatchCardInstanceCommand(commandContext, {
          cardType: VendorProfile,
        }).execute({
          cardId: item.id,
          patch: { attributes: { status: statusValue } },
        });
      } catch (error: any) {
        this.flashKind = 'warn';
        this.flash = error?.message ?? String(error);
      }
    };

    onRejected = (_item: CardDef, _from: string | undefined, to: string) => {
      this.flashKind = 'warn';
      this.flash =
        to === 'onboarded'
          ? 'Onboarding creates the active Vendor record — open the profile and use "Onboard as Vendor" instead of dragging.'
          : `That move is not allowed by the vetting pipeline.`;
    };

    <template>
      <article class='app'>
        <header class='head command-band'>
          <div>
            <p class='kicker'>Procurement · Single-persona console</p>
            <h1>Vendor Onboarding</h1>
            <p class='cta'>{{this.callToAction}}</p>
          </div>
          <div class='head-right'>
            <span class='count-big'>{{this.profiles.length}}</span>
            <span class='count-label'>profiles ·
              {{this.compliantCount}} compliant</span>
          </div>
        </header>

        {{#if this.flash}}
          <div class='flash {{this.flashKind}}'>{{this.flash}}</div>
        {{/if}}

        {{#if this.isInteractive}}
          <StatusBoard
            @items={{this.profiles}}
            @statusField={{this.statusField}}
            @statusOf={{this.statusOf}}
            @onMove={{this.onMove}}
            @onRejected={{this.onRejected}}
            @onOpen={{this.openCard}}
            @onAddCard={{this.addProfile}}
            @boardLabel='Vendor vetting pipeline'
            class='board'
          />
        {{else}}
          <div class='shell'>
            <StatePill
              @label='Vetting pipeline'
              @hue='slate'
              @chrome={{true}}
            />
            <p class='shell-note'>{{this.profiles.length}} vendor profiles
              move intake → under review → approved → onboarded here. Open
              the app to work the board.</p>
          </div>
        {{/if}}
      </article>
      <style scoped>
        .app {
          --console-ink: var(--procurement-ink, var(--primary, var(--boxel-dark)));
          --console-ink-fg: var(--procurement-ink-fg, var(--primary-foreground, var(--boxel-light)));
          container-type: inline-size;
          padding: 0 var(--boxel-sp-lg) var(--boxel-sp-lg);
          background:
            radial-gradient(
              1100px 360px at 15% -10%,
              color-mix(in oklch, var(--console-ink) 7%, transparent),
              transparent 65%
            ),
            var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
          min-height: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
        }
        .command-band {
          background:
            linear-gradient(
              120deg,
              color-mix(in oklch, var(--console-ink) 96%, black),
              var(--console-ink) 55%,
              color-mix(in oklch, var(--console-ink) 82%, #4a5bc4)
            );
          color: var(--console-ink-fg);
          margin: 0 calc(-1 * var(--boxel-sp-lg));
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-sm);
          position: relative;
          overflow: hidden;
        }
        .command-band::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(
              color-mix(in oklch, var(--console-ink-fg) 7%, transparent) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              color-mix(in oklch, var(--console-ink-fg) 7%, transparent) 1px,
              transparent 1px
            );
          background-size: 28px 28px;
          mask-image: linear-gradient(to bottom, black, transparent 90%);
          pointer-events: none;
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: color-mix(in oklch, var(--console-ink-fg) 65%, transparent);
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.75rem;
          letter-spacing: -0.015em;
        }
        .cta {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: 0.9375rem;
          color: color-mix(in oklch, var(--console-ink-fg) 85%, transparent);
        }
        .head-right {
          text-align: right;
        }
        .count-big {
          display: block;
          font-size: 2rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .count-label {
          font-size: 0.8125rem;
          color: color-mix(in oklch, var(--console-ink-fg) 70%, transparent);
          font-variant-numeric: tabular-nums;
        }
        .flash {
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          font-size: 0.875rem;
        }
        .flash.warn {
          background: color-mix(
            in oklch,
            var(--state-amber-fg, #b45309) 12%,
            transparent
          );
          color: var(--state-amber-fg, #b45309);
        }
        .flash.ok {
          background: color-mix(
            in oklch,
            var(--state-green-fg, #15803d) 10%,
            transparent
          );
          color: var(--state-green-fg, #15803d);
        }
        .board {
          flex: 1;
          min-height: 0;
        }
        @media (prefers-reduced-motion: no-preference) {
          .command-band {
            animation: vo-band-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .board,
          .shell {
            animation: vo-rise 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
            animation-delay: 140ms;
          }
        }
        @keyframes vo-band-in {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes vo-rise {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .shell {
          border: 1px dashed var(--border, var(--boxel-300));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp-lg);
          display: grid;
          gap: var(--boxel-sp-xs);
          justify-items: start;
        }
        .shell-note {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.875rem;
        }
      </style>
    </template>
  };

  // Identity-bearing fitted: the app's own navy command-band world, not a
  // generic white tile. Static by design — a fitted may prerender, so no
  // queries; the identity IS the content. Anchor is typographic (Rule 2):
  // the app name decisively loudest at every quantum. Type scale is capped
  // against cqb so a wide+short strip can never shear a glyph (Rule 1).
  static fitted = class Fitted extends Component<
    typeof VendorOnboardingApp
  > {
    <template>
      <div class='fit'>
        <span class='eyebrow'>Procurement</span>
        <span class='name'>Vendor Onboarding</span>
        <span class='sub'>intake → review → approved → onboarded</span>
        <div class='rail-glyph' aria-hidden='true'>
          <i></i><i></i><i class='lit'></i><i></i>
        </div>
      </div>
      <style scoped>
        .fit {
          /* two-scope chain, --boxel-* terminal, no literals (boxel-theming C1) */
          --fit-bg: var(--procurement-ink, var(--primary, var(--boxel-dark)));
          --fit-fg: var(
            --procurement-ink-fg,
            var(--primary-foreground, var(--boxel-light))
          );
          --fit-grid: color-mix(in oklch, var(--fit-fg) 7%, transparent);
          --type-base: clamp(10px, min(calc(3px + 2.1cqi + 1cqb), 10cqb), 17px);
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, auto) auto 1fr;
          align-content: start;
          gap: calc(var(--type-base) * 0.25);
          padding: calc(var(--type-base) * 0.8);
          overflow: hidden;
          background:
            linear-gradient(var(--fit-grid) 1px, transparent 1px),
            linear-gradient(90deg, var(--fit-grid) 1px, transparent 1px),
            linear-gradient(
              120deg,
              color-mix(in oklch, var(--fit-bg) 96%, var(--boxel-dark)),
              var(--fit-bg)
            );
          background-size:
            22px 22px,
            22px 22px,
            100% 100%;
          color: var(--fit-fg);
          font-family: var(--font-sans, inherit);
        }
        .eyebrow {
          font-size: max(calc(var(--type-base) * 0.62), 8px);
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: color-mix(in oklch, var(--fit-fg) 62%, transparent);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .name {
          font-size: calc(var(--type-base) * 1.5);
          font-weight: 700;
          letter-spacing: -0.015em;
          line-height: 1.15;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .sub {
          font-size: max(calc(var(--type-base) * 0.72), 9px);
          color: color-mix(in oklch, var(--fit-fg) 70%, transparent);
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rail-glyph {
          align-self: end;
          display: flex;
          gap: 5px;
        }
        .rail-glyph i {
          width: 16%;
          max-width: 34px;
          height: 5px;
          border-radius: 3px;
          background: color-mix(in oklch, var(--fit-fg) 25%, transparent);
        }
        .rail-glyph i.lit {
          background: var(--fit-fg);
        }
        @container fitted-card (height <= 105px) {
          .sub,
          .rail-glyph {
            display: none;
          }
        }
        @container fitted-card (height <= 65px) {
          .fit {
            grid-template-rows: 1fr;
            grid-template-columns: auto 1fr;
            align-items: center;
            column-gap: calc(var(--type-base) * 0.5);
          }
          .eyebrow {
            display: none;
          }
          .name {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </template>
  };
}
