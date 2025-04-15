import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import {
  restartableTask,
  type EncapsulatedTaskDescriptor as Descriptor,
} from 'ember-concurrency';
import {
  DefaultFormatsProvider,
  PermissionsConsumer,
  getBoxComponent,
} from './field-component';
import {
  type CardDef,
  type BaseDef,
  type Box,
  type Field,
  type CardContext,
} from './card-api';
import {
  chooseCard,
  baseCardRef,
  identifyCard,
  CardContextName,
  RealmURLContextName,
  getNarrowestType,
  Loader,
  type ResolvedCodeRef,
  isCardInstance,
} from '@cardstack/runtime-common';
import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconMinusCircle } from '@cardstack/boxel-ui/icons';
import { consume } from 'ember-provide-consume-context';
import { hash } from '@ember/helper';

interface Signature {
  Element: HTMLElement;
  Args: {
    model: Box<CardDef | null>;
    field: Field<typeof CardDef>;
    typeConstraint?: ResolvedCodeRef;
  };
}

export class LinksToEditor extends GlimmerComponent<Signature> {
  @consume(CardContextName) declare cardContext: CardContext;
  @consume(RealmURLContextName) declare realmURL: URL | undefined;

  <template>
    <PermissionsConsumer as |permissions|>
      <div
        class='links-to-editor'
        data-test-links-to-editor={{@field.name}}
        ...attributes
      >
        {{#if this.isEmpty}}
          {{#if permissions.canWrite}}
            <AddButton
              class='add-new'
              @variant='full-width'
              @hideIcon={{true}}
              {{on 'click' this.add}}
              data-test-add-new
            >
              Link
              {{@field.card.displayName}}
            </AddButton>
          {{else}}
            - Empty -
          {{/if}}
        {{else}}
          <DefaultFormatsProvider
            @value={{hash cardDef='fitted' fieldDef='embedded'}}
          >
            <this.linkedCard />
          </DefaultFormatsProvider>
          {{#if permissions.canWrite}}
            <IconButton
              @variant='primary'
              @icon={{IconMinusCircle}}
              @width='20px'
              @height='20px'
              class='remove'
              {{on 'click' this.remove}}
              disabled={{this.isEmpty}}
              aria-label='Remove'
              data-test-remove-card
            />
          {{/if}}
        {{/if}}
      </div>
    </PermissionsConsumer>
    <style scoped>
      .links-to-editor {
        position: relative;
        display: grid;
        grid-template-columns: 1fr max-content;
      }
      .links-to-editor > :deep(.boxel-card-container.embedded-format) {
        order: -1;
      }
      .remove {
        --icon-color: var(--boxel-light);
        --icon-border: var(--boxel-dark);
        --icon-bg: var(--boxel-dark);
        align-self: center;
        outline: 0;
      }
      .remove:focus,
      .remove:hover {
        --icon-bg: var(--boxel-highlight);
        --icon-border: var(--boxel-highlight);
      }
      .remove:focus + :deep(.boxel-card-container.embedded-format),
      .remove:hover + :deep(.boxel-card-container.embedded-format) {
        box-shadow:
          0 0 0 1px var(--boxel-light-500),
          var(--boxel-box-shadow-hover);
      }
    </style>
  </template>

  add = () => {
    (this.chooseCard as unknown as Descriptor<any, any[]>).perform();
  };

  remove = () => {
    this.args.model.value = null;
  };

  get isEmpty() {
    return this.args.model.value == null;
  }

  get linkedCard() {
    if (this.args.model.value == null) {
      throw new Error(
        `can't make field component with box value of null for field ${this.args.field.name}`,
      );
    }
    let card = Reflect.getPrototypeOf(this.args.model.value)!
      .constructor as typeof BaseDef;
    return getBoxComponent(
      card,
      this.args.model as Box<BaseDef>,
      this.args.field,
    );
  }

  private chooseCard = restartableTask(async () => {
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    if (this.args.typeConstraint) {
      type = await getNarrowestType(this.args.typeConstraint, type, myLoader());
    }
    let cardId = await chooseCard(
      { filter: { type } },
      {
        offerToCreate: {
          ref: type,
          relativeTo: undefined,
          realmURL: this.realmURL,
        },
        createNewCard: this.cardContext?.actions?.createCard,
        consumingRealm: this.realmURL,
      },
    );
    if (cardId) {
      let card = await this.cardContext.store.get(cardId);
      if (isCardInstance(card)) {
        this.args.model.value = card;
      }
    }
  });
}

function myLoader(): Loader {
  // we know this code is always loaded by an instance of our Loader, which sets
  // import.meta.loader.

  // When type-checking realm-server, tsc sees this file and thinks
  // it will be transpiled to CommonJS and so it complains about this line. But
  // this file is always loaded through our loader and always has access to import.meta.
  // @ts-ignore
  return (import.meta as any).loader;
}
