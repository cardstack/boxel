import GlimmerComponent from '@glimmer/component';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { restartableTask } from 'ember-concurrency';
import {
  CardCrudFunctionsConsumer,
  DefaultFormatsProvider,
  PermissionsConsumer,
  getBoxComponent,
} from './field-component';
import {
  type BaseDef,
  type Box,
  type Field,
  type CardContext,
  type LinkableDefConstructor,
  CreateCardFn,
  isFileDef,
} from './card-api';
import {
  chooseCard,
  chooseFile,
  baseCardRef,
  identifyCard,
  CardContextName,
  RealmURLContextName,
  getNarrowestType,
  Loader,
  type ResolvedCodeRef,
  isCardInstance,
} from '@cardstack/runtime-common';
import { Button, IconButton } from '@cardstack/boxel-ui/components';
import { IconMinusCircle } from '@cardstack/boxel-ui/icons';
import { consume } from 'ember-provide-consume-context';
import BrokenLinkTemplate from './default-templates/broken-link-template';
import { type RelationshipState } from './field-support';

// A broken singular link surfaces as a terminal failure state from
// `getRelationshipMembershipState`. The owning `linksTo` component reads it (it has the
// containing instance in scope) and hands it down so the editor can show the
// placeholder alongside a remove control, rather than the bare "Link" button it
// shows for a never-set field. To swap in a working link, the user removes the
// broken reference, which reverts the field to the not-set state and its "Link"
// button.
type BrokenLink = Extract<RelationshipState, { kind: 'error' | 'not-found' }>;

interface Signature {
  Element: HTMLElement;
  Args: {
    model: Box<BaseDef | null>;
    field: Field<LinkableDefConstructor>;
    brokenLink?: BrokenLink;
    typeConstraint?: ResolvedCodeRef;
    /**
     * When true, hard-scope the card chooser to the consuming realm
     * (the realm of the parent card). The catalog modal's realm picker
     * is locked. UI hint only; no runtime validation.
     */
    lockConsumingRealm?: boolean;
    /**
     * Explicit consuming-realm override. Without this, the editor
     * derives the consuming realm from the `RealmURLContext` provided
     * by the surrounding stack item — but in code submode the rule
     * editor renders outside any stack item, so context is absent.
     * Callers that know the owning card's realm (e.g. by reading
     * `model[realmURL]`) can pass it directly here so the chooser
     * filters correctly in both interact and code submodes.
     */
    consumingRealm?: URL;
    createCard?: CreateCardFn;
  };
}

export class LinksToEditor extends GlimmerComponent<Signature> {
  @consume(CardContextName) declare cardContext: CardContext;
  @consume(RealmURLContextName) declare realmURL: URL | undefined;

  <template>
    <PermissionsConsumer as |permissions|>
      <div
        class='links-to-editor
          {{if permissions.canWrite "can-write" "read-only"}}'
        data-test-links-to-editor={{@field.name}}
        ...attributes
      >
        {{#if @brokenLink}}
          {{! A broken reference still occupies the slot — show the placeholder
              (so the broken URL is visible) and, when writable, a remove control
              to clear it. Removing reverts the field to the not-set state, where
              the existing "Link" button can add a working replacement. }}
          {{#if permissions.canWrite}}
            <IconButton
              @icon={{IconMinusCircle}}
              @width='20px'
              @height='20px'
              class='remove'
              {{on 'click' this.remove}}
              aria-label='Remove'
              data-test-remove-card
            />
          {{/if}}
          {{! The editor lays the slot out in flow (a `1fr auto` grid), not a
              fixed-dimension card slot, so the placeholder renders `embedded`
              (flow-sized) rather than `fitted` (which clamps to a badge
              footprint and would clip the URL here). }}
          <CardCrudFunctionsConsumer as |crud|>
            <BrokenLinkTemplate
              @brokenUrl={{@brokenLink.reference}}
              @errorDoc={{@brokenLink.errorDoc}}
              @state={{@brokenLink.kind}}
              @format='embedded'
              @viewCard={{crud.viewCard}}
            />
          </CardCrudFunctionsConsumer>
        {{else if this.isEmpty}}
          {{#if permissions.canWrite}}
            <Button
              class='add-new'
              @kind='muted'
              @size='tall'
              @rectangular={{true}}
              {{on 'click' this.add}}
              data-test-add-new={{@field.name}}
            >
              Link
              {{@field.card.displayName}}
            </Button>
          {{else}}
            - Empty -
          {{/if}}
        {{else}}
          {{#if permissions.canWrite}}
            <IconButton
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
          <DefaultFormatsProvider
            @value={{hash cardDef='fitted' fieldDef='embedded'}}
          >
            <this.linkedCard />
          </DefaultFormatsProvider>
        {{/if}}
      </div>
    </PermissionsConsumer>
    <style scoped>
      .links-to-editor {
        position: relative;
        display: grid;
      }
      .links-to-editor.can-write {
        grid-template-columns: 1fr auto;
        gap: var(--boxel-sp-xs);
        align-items: center;
      }
      /* The linked card (or the broken-link placeholder standing in for it)
         occupies the leading 1fr column; the remove button, though first in the
         DOM, is reordered into the trailing `auto` column. */
      .links-to-editor > :deep(.boxel-card-container),
      .links-to-editor > :deep(.broken-link-template) {
        order: -1;
      }
      .links-to-editor .field-component-card {
        min-height: 65px;
      }
      .remove {
        --icon-color: var(--background, var(--boxel-light));
        --icon-border: var(--foreground, var(--boxel-dark));
        --icon-bg: var(--foreground, var(--boxel-dark));
        --boxel-icon-button-width: var(--boxel-icon-med);
        --boxel-icon-button-height: var(--boxel-icon-med);
        outline: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .remove:focus,
      .remove:hover {
        --icon-bg: var(--primary, var(--boxel-highlight));
        --icon-border: var(--primary, var(--boxel-highlight));
      }
      .remove:focus + :deep(.boxel-card-container.fitted-format),
      .remove:hover + :deep(.boxel-card-container.fitted-format) {
        box-shadow:
          0 0 0 1px var(--border, var(--boxel-300)),
          var(--boxel-box-shadow);
      }
      .add-new {
        width: fit-content;
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>

  add = () => {
    this.chooseCard.perform();
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
    if (isFileDef(this.args.field.card)) {
      let fileType = identifyCard(this.args.field.card);
      let fileTypeName = this.args.field.card.displayName;
      let file = await chooseFile(
        fileType ? { fileType, fileTypeName } : undefined,
      );
      if (file) {
        this.args.model.value = file;
      }
      return;
    }
    let type = identifyCard(this.args.field.card) ?? baseCardRef;
    if (this.args.typeConstraint) {
      type = await getNarrowestType(this.args.typeConstraint, type, myLoader());
    }
    // Prefer the explicit `@consumingRealm` arg over the
    // `RealmURLContext` consumption, so callers in contexts that don't
    // provide the context (e.g. code submode's playground / spec
    // preview, where there is no stack item) can still scope the
    // chooser to the owning card's realm.
    let consumingRealm = this.args.consumingRealm ?? this.realmURL;
    // Only honor `@lockConsumingRealm` when a realm is actually known.
    // Locking without a consuming realm leaves the picker disabled but
    // unscoped — search results would span every realm and the user
    // couldn't change the (effectively empty) selection. Treat the
    // lock as advisory and let the picker stay interactive if there's
    // no realm to lock to.
    let lockConsumingRealm =
      this.args.lockConsumingRealm === true && consumingRealm != null;
    let cardId = await chooseCard(
      { filter: { type } },
      {
        offerToCreate: {
          ref: type,
          relativeTo: undefined,
          realmURL: consumingRealm,
        },
        createNewCard: this.args.createCard,
        consumingRealm,
        lockConsumingRealm,
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
