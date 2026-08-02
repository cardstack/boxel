import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import Modifier from 'ember-modifier';

import { consume } from 'ember-provide-consume-context';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  GetCardContextName,
  rri,
  type getCard,
} from '@cardstack/runtime-common';

import RealmSandboxTemplateIsland from '@cardstack/host/components/realm-sandbox-template-island';
import RealmSandboxStyles from '@cardstack/host/modifiers/realm-sandbox-styles';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type {
  BaseDef,
  CardContext,
  Field,
  Format,
  ViewCardFn,
} from '@cardstack/base/card-api';
import type { ArgsFor, NamedArgs, PositionalArgs } from 'ember-modifier';

const NoopCardComponentModifier = class extends Modifier<any> {
  modify() {}
} as NonNullable<CardContext['cardComponentModifier']>;

interface RelationshipContextSignature {
  Element: Element;
  Args: {
    Named: {
      card: BaseDef;
      getCard: getCard;
      cardContext?: CardContext;
    };
  };
}

class RealmSandboxRelationshipContext extends Modifier<RelationshipContextSignature> {
  @service declare private realmSandbox: RealmSandboxService;
  private unregister?: () => void;

  constructor(owner: Owner, args: ArgsFor<RelationshipContextSignature>) {
    super(owner, args);
    registerDestructor(this, () => this.unregister?.());
  }

  modify(
    _element: Element,
    _positional: PositionalArgs<RelationshipContextSignature>,
    named: NamedArgs<RelationshipContextSignature>,
  ) {
    this.unregister?.();
    this.unregister = this.realmSandbox.registerRelationshipContext(
      named.card,
      { getCard: named.getCard, cardContext: named.cardContext },
    );
  }
}

type SandboxViewCardFn = (
  target: Parameters<ViewCardFn>[0],
  format?: Parameters<ViewCardFn>[1],
  optionsOrEvent?: Parameters<ViewCardFn>[2] | Event,
) => void;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    card: BaseDef;
    format?: Format;
    sandbox: NonNullable<ReturnType<RealmSandboxService['renderFor']>>;
    displayContainer?: boolean;
    field?: Field;
    viewCard?: ViewCardFn;
  };
}

export default class RealmSandboxRender extends Component<Signature> {
  @consume(CardContextName) declare private cardContext:
    | CardContext
    | undefined;
  @consume(GetCardContextName) declare private getCard: getCard;

  set = () => undefined;

  get component() {
    return this.args.sandbox.component;
  }

  get format() {
    return this.args.format ?? 'isolated';
  }

  get displayContainer() {
    return this.args.displayContainer !== false;
  }

  get cardID() {
    return 'id' in this.args.card
      ? (this.args.card.id as string | undefined)
      : undefined;
  }

  get theme() {
    return this.args.sandbox.theme;
  }

  get themeCss() {
    return this.theme?.css;
  }

  get themeScope() {
    return this.theme?.scope;
  }

  @cached get context() {
    let context = this.cardContext;
    if (!context) {
      return undefined;
    }
    // Template-only presentation capabilities cross this boundary explicitly.
    // Data stores, card loaders, and command/tool authority stay on the host
    // side; the search component consumes the host's already-scoped providers.
    return {
      searchResultsComponent: context.searchResultsComponent,
      cardComponentModifier: context.cardComponentModifier,
      markdownEmbedChooser: context.markdownEmbedChooser,
      mode: context.mode,
      submode: context.submode,
    } as CardContext;
  }

  get cardComponentModifier(): NonNullable<
    CardContext['cardComponentModifier']
  > {
    return this.cardContext?.cardComponentModifier ?? NoopCardComponentModifier;
  }

  viewCard: SandboxViewCardFn = (
    target,
    format = 'isolated',
    optionsOrEvent,
  ) => {
    if (!this.args.viewCard) {
      return;
    }
    let targetID =
      target instanceof URL
        ? target.href
        : typeof target === 'string'
          ? target
          : target &&
              typeof target === 'object' &&
              'id' in target &&
              typeof target.id === 'string'
            ? target.id
            : undefined;
    if (!targetID) {
      return;
    }
    let principal = new URL(this.args.sandbox.principal);
    let cardURL = new URL(targetID, principal);
    let principalPath = principal.pathname.endsWith('/')
      ? principal.pathname
      : `${principal.pathname}/`;
    if (
      cardURL.origin !== principal.origin ||
      !cardURL.pathname.startsWith(principalPath)
    ) {
      return;
    }
    let options = optionsOrEvent instanceof Event ? undefined : optionsOrEvent;
    this.args.viewCard(rri(cardURL.href), format, options);
  };

  <template>
    <CardContainer
      @displayBoundaries={{this.displayContainer}}
      @isThemed={{if this.theme true false}}
      @themeCss={{this.themeCss}}
      @themeScope={{this.themeScope}}
      class={{cn
        'realm-sandbox-render'
        'field-component-card'
        (if (eq this.format 'isolated') 'isolated-format')
        (if (eq this.format 'embedded') 'embedded-format')
        (if (eq this.format 'fitted') 'fitted-format')
        (if (eq this.format 'atom') 'atom-format')
        (if
          this.displayContainer
          'display-container-true'
          'display-container-false'
        )
      }}
      data-boxel-card-id={{this.cardID}}
      data-boxel-card-format={{this.format}}
      {{! Keep the host renderer's observable card identity contract when the
          authored component crosses the SES boundary. The ordinary
          FieldComponent renderer exposes these same hooks; playground
          selection and compatibility tests must not need to know which
          renderer tier supplied the selected instance. }}
      data-test-card={{this.cardID}}
      data-test-card-format={{this.format}}
      data-test-field-component-card
      {{this.cardComponentModifier
        cardId=this.cardID
        format=this.format
        fieldType=@field.fieldType
        fieldName=@field.name
      }}
      ...attributes
    >
      <div
        class='realm-sandbox-template-island'
        data-realm-sandbox-template-island
        {{RealmSandboxRelationshipContext
          card=@card
          getCard=this.getCard
          cardContext=this.cardContext
        }}
        {{RealmSandboxStyles @sandbox.styles}}
        {{RealmSandboxTemplateIsland
          this.component
          cardOrField=@card.constructor
          model=@sandbox.model
          fields=@sandbox.fields
          context=this.context
          format=this.format
          set=this.set
          viewCard=this.viewCard
          onError=@sandbox.onError
          onRendered=@sandbox.onRendered
          card=@card
          markerBacked=@sandbox.markerBacked
        }}
      ></div>
    </CardContainer>

    <style scoped>
      .realm-sandbox-render {
        /* The shared-document SES tier needs a host-owned paint boundary in
           addition to compiled selector scoping. Layout containment makes
           this box the containing block for fixed/absolute descendants, paint
           containment clips unusual visual effects as well as ordinary
           overflow, and isolation prevents blending and z-index effects from
           escaping into Host chrome. */
        /* `content` is the CSS shorthand for layout + style + paint without
           size containment, so intrinsic card sizing remains available. */
        contain: content;
        isolation: isolate;
      }
      .realm-sandbox-render.isolated-format {
        height: 100%;
      }
      .realm-sandbox-render.fitted-format {
        width: 100%;
        height: 100%;
        min-height: 40px;
        max-height: 600px;
        container-name: fitted-card;
        container-type: size;
        overflow: hidden;
      }
      .realm-sandbox-render.embedded-format {
        container-name: embedded-card;
        container-type: inline-size;
        overflow: hidden;
      }
      .realm-sandbox-render.atom-format.display-container-false {
        /* A display:contents element has no principal box, so containment and
           the CardContainer clip cannot apply. Preserve atom flow without the
           decorated boundary by using an unpadded shrink-to-fit box. */
        display: inline-block;
        width: auto;
        height: auto;
      }
      .realm-sandbox-render.atom-format.display-container-true {
        display: inline-block;
        width: auto;
        height: auto;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
      }
      .realm-sandbox-render.atom-format > :deep(*) {
        vertical-align: middle;
      }
      .realm-sandbox-template-island {
        display: contents;
      }
      .realm-sandbox-render.edit-format:has(.default-card-template.edit) {
        background-color: var(--muted, var(--boxel-100));
      }
    </style>
  </template>
}
