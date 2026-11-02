import { modifier } from 'ember-modifier';
import {
  hasNothingToShow,
  decodedLastSegmentOfIdentifier,
} from '@cardstack/runtime-common';
import {
  CardDef,
  Component,
  type CardContext,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from './card-api';
import CodeRefField, { AbsoluteCodeRefField } from './code-ref';
import BooleanField from './boolean';
import MarkdownField from './markdown';
import NumberField from './number';
import ResponseField from './response-field';
import RealmField from './realm';
import { Skill } from './skill';
import { Spec } from './spec';
import {
  JsonField,
  QueryField,
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
  SearchCardSummaryField,
} from './commands/search-card-result';
import {
  SearchEntriesInput,
  SearchEntriesResult,
  SearchEntrySummaryField,
} from './commands/search-entry-result';
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import { SignedCaptureLink } from '@cardstack/boxel-host/lib/signed-capture';

export type ToolCallStatus = 'applied' | 'ready' | 'applying';
// Pre-rename spelling; new code imports `ToolCallStatus`.
export type CommandStatus = ToolCallStatus;

export class ApplyMarkdownEditInput extends CardDef {
  @field cardId = contains(StringField);
  @field fieldPath = contains(StringField);
  @field markdownDiff = contains(StringField); // The replacement/result text
  @field instructions = contains(StringField);
  @field currentContent = contains(StringField); // Optional focused section to transform
}

export class SaveCardInput extends CardDef {
  @field card = linksTo(CardDef);
  @field realm = contains(StringField);
  @field localDir = contains(StringField);
  // When true, the save does not block on the realm's in-flight incremental
  // indexing: the realm indexes the write deferred and responds from the
  // serialized document. The writer's own next card read still waits on that
  // deferred job (the realm drains the requester's own writes on card reads),
  // so what goes eventually-consistent is search — _search/_federated-search
  // have no such drain — plus other users' sessions and anonymous readers.
  // Defaults to false — an unset BooleanField reads as false — which preserves
  // the synchronous-indexing behavior every caller relies on. The polarity is
  // opt-in precisely so the safe default survives the field being unset.
  //
  // Deliberately exposed in the generated tool schema (it is not in
  // ignoreInputFields): the description below is what the model sees.
  @field skipIndexWait = contains(BooleanField, {
    description:
      'Leave unset for a normal save. Set true only to make the save return without waiting for the realm to index it — the saved card may briefly not appear in searches. Do not set this when a search for the saved card follows the save.',
  });
}

// The copy is created like any new card, so the realm picks its path: a
// directory named after the card's type, beneath `localDir`, holding a file
// with a generated name. The descriptions below spell that out because models
// otherwise pass the path they want the new file to have as `localDir`.
export class CopyCardToRealmInput extends CardDef {
  @field sourceCard = linksTo(CardDef, {
    description:
      'The card to copy, as relationships.sourceCard.links.self: its id as a full URL or a realm identifier such as @cardstack/catalog/…; either works.',
  });
  @field targetRealm = contains(StringField, {
    description:
      'URL of the realm to copy the card into, ending in a slash, e.g. "https://example.com/my-realm/". The copy is written to <targetRealm><localDir>/<CardTypeName>/<generated-id>.json — see localDir.',
  });
  @field localDir = contains(StringField, {
    description:
      'Optional folder inside targetRealm to put the copy under, relative to the realm root; it must stay inside the realm, so .. segments are refused. It is not the path of the new file: the realm always adds a folder named after the card\'s type (the name its class is exported under, e.g. Incident for export class Incident; for a default export, the module file name in PascalCase, e.g. IncidentRecord for export default from incident-record.gts) and generates the file name, and neither can be chosen. Copying an Incident card with localDir "projects/acme" writes projects/acme/Incident/<generated-id>.json; leaving localDir unset writes Incident/<generated-id>.json; localDir "Incident" writes Incident/Incident/<generated-id>.json. The result\'s newCardId is the URL of the copy.',
  });
}

export class CopyCardToStackInput extends CardDef {
  @field sourceCard = linksTo(CardDef, {
    description:
      'The card to copy, as relationships.sourceCard.links.self: its id as a full URL or a realm identifier such as @cardstack/catalog/…; either works.',
  });
  @field targetStackIndex = contains(NumberField);
  @field localDir = contains(StringField, {
    description:
      'Optional folder to put the copy under, in the realm of the card on top of the target stack, relative to the realm root; it must stay inside the realm, so .. segments are refused. It is not the path of the new file: the realm always adds a folder named after the card\'s type (the name its class is exported under, e.g. Incident for export class Incident; for a default export, the module file name in PascalCase, e.g. IncidentRecord for export default from incident-record.gts) and generates the file name, and neither can be chosen. Copying an Incident card with localDir "projects/acme" writes projects/acme/Incident/<generated-id>.json; leaving localDir unset writes Incident/<generated-id>.json. The result\'s newCardId is the URL of the copy.',
  });
}

export class CopyCardResult extends CardDef {
  @field newCardId = contains(StringField);
}

export class CopySourceInput extends CardDef {
  @field originSourceIdentifier = contains(StringField);
  @field destinationSourceIdentifier = contains(StringField);
}

export class CopySourceResult extends CardDef {
  @field identifier = contains(StringField);
}

export class CopyFileToRealmInput extends CardDef {
  @field sourceFileIdentifier = contains(StringField);
  @field targetRealm = contains(StringField);
}

export class CopyFileToRealmResult extends CardDef {
  @field newFileIdentifier = contains(StringField);
}

export class PatchCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field patch = contains(JsonField);
  @field roomId = contains(StringField);
}

export class CardIdCard extends CardDef {
  @field cardId = contains(StringField);
}

export class CardTypeSchemaInput extends CardDef {
  @field codeRef = contains(CodeRefField);
}

export class GetUserSystemCardResult extends CardDef {
  @field cardId = contains(StringField);
  @field isDefault = contains(BooleanField);
}

export class ShowCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field format = contains(StringField);
}

export class PatchThemeInput extends CardDef {
  @field cardId = contains(StringField);
  @field skillCard = linksTo(Skill);
}

export class CopyAndEditInput extends CardDef {
  @field card = linksTo(CardDef);
}

export class FileIdentifierCard extends CardDef {
  @field fileIdentifier = contains(StringField);
}

export class RealmIdentifierCard extends CardDef {
  @field realmIdentifier = contains(StringField);
}

export class InvalidateRealmIdentifiersInput extends RealmIdentifierCard {
  @field resourceIdentifiers = containsMany(StringField);
}

export class ReadTextFileInput extends CardDef {
  @field realm = contains(StringField);
  @field path = contains(StringField);
}

export class ReadSourceInput extends CardDef {
  @field realm = contains(StringField);
  @field path = contains(StringField);
}

export class FileContents extends CardDef {
  @field content = contains(StringField);
}

export class SwitchSubmodeInput extends CardDef {
  @field submode = contains(StringField);
  @field codePath = contains(StringField);
  @field createFile = contains(BooleanField);
}

export class PersistModuleInspectorViewInput extends CardDef {
  @field codePath = contains(StringField);
  @field moduleInspectorView = contains(StringField); // 'schema' | 'spec' | 'preview'
}

// One choice the assistant offers with `ask-user`: a card, a color, or a
// plain option. `value` is what comes back as the answer.
export class AskUserOption extends FieldDef {
  @field label = contains(StringField);
  @field value = contains(StringField);
  @field detail = contains(StringField);
  // a card to show as the option, fitted
  @field cardId = contains(StringField);
  // a color to show as a swatch, as a CSS color
  @field color = contains(StringField);
  // for kind `recommend`: how sure the assistant is ('high', 'medium', 'low')
  @field confidence = contains(StringField);
}

// The assistant asks the user to pick. `kind` chooses the picker: `cards`
// (each option a card), `swatches` (each a color), `options` (pills) or
// `recommend` (the assistant's pick first, with its reason and confidence,
// and the others as alternatives).
// `answer` is filled by the host from the user's pick, never by the model.
export class AskUserInput extends CardDef {
  @field question = contains(StringField);
  @field kind = contains(StringField);
  @field options = containsMany(AskUserOption);
  @field allowOther = contains(BooleanField);
  @field answer = contains(StringField);
}

export class AskUserResult extends CardDef {
  @field question = contains(StringField);
  @field answer = contains(StringField);
  @field label = contains(StringField);

  // The row says what was picked; there is nothing else to show.
  get [hasNothingToShow](): boolean {
    return true;
  }
}

export class SwitchSubmodeResult extends CardDef {
  @field codePath = contains(StringField);
}

// What the secure window is opened for. Every field names something; none
// carries a value. `mode` is `enter-key`, `replace-key`, `share-key`,
// `swap-key`, `connect`, `approve` or `review-changes`. A key is entered, the
// key an operation sends is replaced, an account connected, or a card's
// requests approved or their changes reviewed, for an operation on a card
// instance (`cardId`) or on a card type (`module`, `name` and `realm`);
// `replace-key`, `approve` and `review-changes` always name the operation, and
// the last two name only the one a card is blocked on: the window gathers the
// card's others. A key is shared with `realm`; one of the user's
// keys is swapped into the suspended share `share` of `realm`; and an account
// may also be connected for `realm` alone.
// `reason` is one line the window shows as written by whoever opened it.
export class OpenSecureWindowInput extends CardDef {
  @field mode = contains(StringField);
  @field cardId = contains(StringField);
  @field module = contains(StringField);
  @field name = contains(StringField);
  @field realm = contains(StringField);
  @field share = contains(StringField);
  @field operation = contains(StringField);
  @field reason = contains(StringField);
}

// Whether the window opened (`opened`), or the browser blocked it and the app
// shows a button that opens it instead (`blocked`). Never what the user did in
// the window.
export class OpenSecureWindowResult extends CardDef {
  @field status = contains(StringField);
}

export class RealmKeySharesInput extends CardDef {
  @field realm = contains(StringField);
}

// An operation one of a realm's shares is approved for there: one binding,
// naming the operation by the type it is invoked through (`module`, in RRI
// form, and `name`), the card it was approved for when it is approved per
// instance (`instance`, in RRI form), the credential slot the share fills, and
// the binding's `state`: `active`, `needs-reapproval` or `suspended`.
export class RealmKeyShareOperationField extends FieldDef {
  @field bindingId = contains(StringField);
  @field module = contains(StringField);
  @field name = contains(StringField);
  @field operation = contains(StringField);
  @field instance = contains(StringField);
  @field slot = contains(StringField);
  @field state = contains(StringField);
}

// One of a realm's shares, as the realm's direct writers see it: no key and no
// value, only what the share is called, whose key it holds, whether it is in
// use and the operations it is approved for (`operations`). `state` is `active` or `suspended`; a suspended share carries its
// `suspensionReason` (`owner-lost-write`, `suspended-by-writer` or
// `key-deleted`), and `suspendedBy` names the writer who suspended it. `own`
// says the share holds the signed-in user's key, so they may unshare it, and
// `suspendedByYou` that the signed-in user is the writer who suspended it.
export class RealmKeyShareField extends FieldDef {
  @field shareId = contains(StringField);
  @field label = contains(StringField);
  @field owner = contains(StringField);
  @field own = contains(BooleanField);
  @field state = contains(StringField);
  @field suspensionReason = contains(StringField);
  @field suspendedBy = contains(StringField);
  @field suspendedByYou = contains(BooleanField);
  @field suspendedAt = contains(StringField);
  @field operations = containsMany(RealmKeyShareOperationField);
}

// A realm's shares, by label. `visible` is false when the signed-in user is not
// one of the realm's direct writers, who alone see its shares.
export class RealmKeySharesResult extends CardDef {
  @field visible = contains(BooleanField);
  @field shares = containsMany(RealmKeyShareField);
}

export class KeyShareInput extends CardDef {
  @field shareId = contains(StringField);
}

export class WriteTextFileInput extends CardDef {
  @field content = contains(StringField);
  @field realm = contains(StringField);
  @field path = contains(StringField);
  @field overwrite = contains(BooleanField);
  @field useNonConflictingFilename = contains(BooleanField);
}

export class MigrateSkillInput extends CardDef {
  // The realm to migrate: legacy `Skill` cards are read from it and the
  // resulting `skills/<name>/SKILL.md` files are written back into it.
  @field realm = contains(StringField);
  // Overwrite an existing `SKILL.md` at the target path. When false (default),
  // a skill whose target already exists is left untouched and reported as
  // skipped.
  @field overwrite = contains(BooleanField);
}

export class MigrateSkillResult extends CardDef {
  // Absolute URLs of the `SKILL.md` files written by this run.
  @field migratedFiles = containsMany(StringField);
  // Ids of legacy `Skill` cards skipped because their target `SKILL.md`
  // already exists and `overwrite` was not set.
  @field skippedSkillIds = containsMany(StringField);
  // Ids of skills skipped because they had no instructions to write — e.g. a
  // markdown-backed skill whose linked instructions did not resolve. Reported
  // rather than written out as an empty `SKILL.md`.
  @field emptySkillIds = containsMany(StringField);
}

export class WriteBinaryFileInput extends CardDef {
  @field path = contains(StringField);
  @field realm = contains(StringField);
  @field base64Content = contains(StringField);
  // No content-type field: the binary-write path always posts
  // application/octet-stream (the realm router matches binary uploads on it)
  // and the realm infers the file type from the destination path's extension.
  @field useNonConflictingFilename = contains(BooleanField);
}

export class WriteBinaryFileResult extends CardDef {
  @field fileIdentifier = contains(StringField);
}

export class ReadBinaryFileInput extends CardDef {
  @field fileIdentifier = contains(StringField);
}

export class ReadBinaryFileResult extends CardDef {
  @field base64Content = contains(StringField);
  @field contentType = contains(StringField);
}

export class DownloadFileToRealmInput extends CardDef {
  @field sourceUrl = contains(StringField); // the URL to download
  @field realm = contains(StringField); // target realm (defaults to the writable realm)
  @field path = contains(StringField); // destination path within the realm, e.g. "Captures/card.png"
  @field useNonConflictingFilename = contains(BooleanField);
}

export class DownloadFileToRealmResult extends CardDef {
  @field fileIdentifier = contains(StringField);
}

export class GenerateThumbnailInput extends CardDef {
  @field prompt = contains(StringField);
  @field sourceImageUrl = contains(StringField);
  @field targetRealmIdentifier = contains(StringField);
  @field targetPath = contains(StringField); // optional: subfolder within realm, e.g. "thumbnails"
  @field targetCardId = contains(StringField);
  @field cardName = contains(StringField); // card name for filename generation
  @field llmModel = contains(StringField);
}

export class GenerateThumbnailOutput extends CardDef {
  @field imageDefIdentifier = contains(StringField);
}

export class CaptureInput extends CardDef {
  @field card = linksTo(CardDef);
  @field format = contains(StringField); // 'isolated' | 'embedded'
  // The capture surface, exposed one JSON-primitive field per parameter.
  // `run-command`'s headless input path builds this card via
  // `new InputType(rawJson)`; it resolves `linksTo` ids to instances (that is
  // how `card` above reaches the tool) but cannot construct a nested
  // `contains(SomeFieldDef)` from a plain JSON object — the field validator
  // rejects a non-instance value. So the geometry is flattened into
  // StringField/NumberField/BooleanField fields the tool reassembles into the
  // endpoint's nested `captureSpec` (see capture-spec.ts). Every field is
  // optional; each is part of the canonical capture identity, so a capture
  // with any of them persists and serves under its own durable URL.
  @field viewportWidth = contains(NumberField);
  @field viewportHeight = contains(NumberField);
  @field deviceScaleFactor = contains(NumberField);
  @field fullPage = contains(BooleanField);
  @field clipX = contains(NumberField);
  @field clipY = contains(NumberField);
  @field clipWidth = contains(NumberField);
  @field clipHeight = contains(NumberField);
  // 'png' (the default) or 'pdf'. A pdf paginates the settled render into a
  // document and takes none of the raster geometry above.
  @field type = contains(StringField);
  // 'screen' (the default) or 'print'. 'print' settles the render under the
  // card's print CSS (`@page`, `@media print`, `break-*`) — the paper layout a
  // pdf usually wants.
  @field media = contains(StringField);
}

// One capture. `url` is the durable served MediaCache URL the capture
// persisted under — the only reference the tool returns; a re-capture rotates
// its bytes, never the URL. An image carries `width`/`height`; a pdf carries
// `pageCount` instead.
export class Capture extends FieldDef {
  @field name = contains(StringField);
  @field url = contains(StringField);
  @field contentType = contains(StringField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field pageCount = contains(NumberField);
}

export class CaptureOutput extends CardDef {
  static displayName = 'Capture Result';

  @field captures = containsMany(Capture);

  static embedded = class Embedded extends Component<typeof CaptureOutput> {
    <template>
      <div class='capture-result'>
        {{#each @model.captures as |capture|}}
          <figure class='capture'>
            {{#if capture.url}}
              {{#if (eq capture.contentType 'application/pdf')}}
                {{! A pdf can't render in an <img>, and a bare anchor to a
                    private realm's capture is refused, so the link mints a
                    signed URL on click. }}
                <SignedCaptureLink @url={{capture.url}}>
                  {{capture.name}}
                  (PDF{{#if capture.pageCount}},
                    {{capture.pageCount}}
                    {{if (eq capture.pageCount 1) 'page' 'pages'}}{{/if}})
                </SignedCaptureLink>
              {{else}}
                <img src={{capture.url}} alt={{capture.name}} />
              {{/if}}
              <figcaption><a
                  href={{capture.url}}
                >{{capture.url}}</a></figcaption>
            {{/if}}
          </figure>
        {{/each}}
      </div>
      <style scoped>
        .capture-result {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
        }
        .capture {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
        }
        .capture img {
          max-width: 100%;
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
        }
        .capture figcaption {
          font-size: var(--boxel-font-sm);
          word-break: break-all;
        }
      </style>
    </template>
  };
}

export class CreateInstanceInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field realm = contains(StringField);
}

export class CreateInstancesInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field realm = contains(StringField);
  @field count = contains(NumberField);
  @field exampleCard = linksTo(CardDef);
}

export class CreateInstanceResult extends CardDef {
  @field createdCard = linksTo(CardDef);
}

export class GenerateThemeExampleInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field realm = contains(StringField);
  @field prompt = contains(MarkdownField);
  @field llmModel = contains(StringField);
  @field skillCardIds = containsMany(StringField);
  @field skillCard = linksTo(Skill);
  @field localDir = contains(StringField);
}

export class GenerateListingExampleInput extends CardDef {
  @field listing = linksTo(CardDef);
  @field realm = contains(StringField);
  @field referenceExample = linksTo(CardDef);
}
export class UpdateCodePathWithSelectionInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field localName = contains(StringField);
  @field fieldName = contains(StringField);
}

export class UpdatePlaygroundSelectionInput extends CardDef {
  @field moduleId = contains(StringField);
  @field cardId = contains(StringField);
  @field format = contains(StringField);
  @field fieldIndex = contains(NumberField);
}

export class LintAndFixInput extends CardDef {
  @field fileContent = contains(StringField);
  @field realm = contains(StringField);
  @field filename = contains(StringField);
}

export class LintAndFixResult extends CardDef {
  @field output = contains(StringField);
  @field lintIssues = containsMany(StringField); // all remaining issues (errors + warnings)
  @field lintErrors = containsMany(StringField); // severity 2 only (unfixable errors)
  @field lintWarnings = containsMany(StringField); // severity 1 only
}

// A URL as the reader thinks of it: the path inside the run's realm
// (`collab/Article/a.json`), else the path on its server. Anything that is
// not a URL is left alone.
function shortPath(url: string | undefined, realm: string | undefined): string {
  if (!url) {
    return '';
  }
  if (realm && url.startsWith(realm) && url !== realm) {
    return url.slice(realm.length);
  }
  try {
    return new URL(url).pathname.split('/').filter(Boolean).join('/');
  } catch {
    return url;
  }
}

// Shows an image a tool uploaded to the room. Room media loads only through
// the host's `loadRoomMedia`, which answers with an object URL this releases
// once the image is gone; without it (outside the assistant's chat) the URL
// is used as it is.

const roomMediaSrc = modifier(
  (
    img: HTMLImageElement,
    [url, loadRoomMedia]: [
      string | undefined,
      CardContext['loadRoomMedia'] | undefined,
    ],
  ) => {
    if (!url) {
      img.removeAttribute('src');
      return;
    }
    if (!loadRoomMedia) {
      img.src = url;
      return;
    }
    let isTornDown = false;
    let src: string | undefined;
    loadRoomMedia(url).then(
      (loaded) => {
        if (isTornDown) {
          URL.revokeObjectURL(loaded);
          return;
        }
        src = loaded;
        img.src = loaded;
      },
      () => {
        // The image stays empty, and its alt text names what it was.
      },
    );
    return () => {
      isTornDown = true;
      if (src) {
        URL.revokeObjectURL(src);
      }
    };
  },
);

function lastPathSegment(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  return decodedLastSegmentOfIdentifier(url) || url;
}

export class RunRealmCodeInput extends CardDef {
  @field code = contains(StringField);
  @field realm = contains(StringField);
  @field roomId = contains(StringField);
}

export class RealmCodeFileResult extends FieldDef {
  @field fileUrl = contains(StringField);
  @field status = contains(StringField);
  @field detail = contains(StringField);
  // What the run changed in a text file, one line per diff line signed ' ',
  // '-' or '+', with `…N` for N unchanged lines left out and a closing
  // `…truncated` past the size the result carries. The transcript shows it
  // as the file's inline diff, and Undo after a reload reverses it.
  @field diff = contains(StringField);
}

// A capture the assistant looked at, already uploaded to the room's media.
// The tool result that carries it attaches the image, which is how the model
// receives it as image input; `sourceUrl` names what was captured.
export class AttachedImageField extends FieldDef {
  @field name = contains(StringField);
  @field sourceUrl = contains(StringField);
  @field url = contains(StringField);
  @field contentType = contains(StringField);
  @field contentHash = contains(StringField);
  @field contentSize = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
}

// A `realm.ui` action the script asked for. The host does it after the
// script finishes; `status` is 'done' or 'failed'.
export class RealmCodeUiActionResult extends FieldDef {
  @field action = contains(StringField);
  @field target = contains(StringField);
  @field status = contains(StringField);
  @field detail = contains(StringField);
}

export class RunRealmCodeResult extends CardDef {
  static displayName = 'Realm Code Result';

  // The realm the run worked in, ending in a slash.
  @field realm = contains(StringField);
  @field files = containsMany(RealmCodeFileResult);
  @field scriptResult = contains(StringField);
  @field uiActions = containsMany(RealmCodeUiActionResult);
  // What the script looked at with `realm.capture`: each capture rides the tool
  // result as an attached image, so the model sees it.
  @field captures = containsMany(AttachedImageField);
  // URLs of the workspaces the script created with `realm.workspaces.create`.
  @field createdWorkspaces = containsMany(StringField);
  // URLs of the workspaces the script deleted with `realm.workspaces.delete`.
  @field deletedWorkspaces = containsMany(StringField);
  // The `realm.index` calls the script made, in order, such as `reindex` or
  // `invalidate <paths>`. The realm server does the indexing after each call.
  @field indexActions = containsMany(StringField);
  // What the run did beyond files, one line each, in order: the steps the
  // script reported with `realm.activity` (`Step 2 of 4 · Gather sources`),
  // what its `realm.web.*` and `realm.resolve` calls did or why they failed,
  // and an auto-fix of the script itself.
  @field activity = containsMany(StringField);
  // Each fix the runner made to the script before it ran: the error, what
  // was changed and the diff, so the assistant sees what it got wrong.
  @field scriptFixes = containsMany(StringField);
  // What the run changed in the room with `room.*`, one line per change, made
  // after the script finished.
  @field roomChanges = containsMany(StringField);
  // The card the script asked to show with `return { show: path }`, once it
  // is open, or why it could not be shown.
  @field shownCard = contains(StringField);
  @field showError = contains(StringField);

  // The UI actions that failed. A UI action that was done is already visible
  // in the app, so the chat lists only these.
  get failedUiActions(): RealmCodeUiActionResult[] {
    return (this.uiActions ?? []).filter(
      (uiAction) => uiAction?.status === 'failed',
    );
  }

  // The chat shows the card only for what the run wrote or what failed: saved
  // or deleted files, room changes, created or deleted workspaces, a failed UI
  // action, or a card it could not show. A run that only read, looked, or
  // opened something has nothing for the chat to show. Its script result and
  // captures go to the model only.
  get [hasNothingToShow](): boolean {
    return (
      !this.files?.length &&
      !this.roomChanges?.length &&
      !this.activity?.length &&
      !this.scriptFixes?.length &&
      !this.createdWorkspaces?.length &&
      !this.deletedWorkspaces?.length &&
      !this.failedUiActions.length &&
      !this.showError
    );
  }

  // What the run changed and what it looked at. The script's own result is
  // for the model and stays out of the chat.
  // What the run changed and what it looked at, as plain lines on the
  // assistant's ToolRow grid (a 16px glyph column, an 8px gap, the text):
  // no box of its own, so it reads as part of the call that made it. The
  // script's own result is for the model and stays out of the chat.
  static embedded = class Embedded extends Component<
    typeof RunRealmCodeResult
  > {
    <template>
      <div class='realm-code-result'>
        {{#each @model.files as |file|}}
          <div class='line' data-test-realm-code-file={{file.fileUrl}}>
            <span class='glyph done' aria-hidden='true'>✓</span>
            <span class='text'>
              <a class='path' href={{file.fileUrl}}>{{shortPath
                  file.fileUrl
                  @model.realm
                }}</a>
              <span class='status'>{{file.status}}</span>
            </span>
          </div>
        {{/each}}
        {{#each @model.createdWorkspaces as |url|}}
          <div class='line' data-test-realm-code-created-workspace>
            <span class='glyph done' aria-hidden='true'>✓</span>
            <span class='text'>Created workspace
              <a class='path' href={{url}}>{{url}}</a></span>
          </div>
        {{/each}}
        {{#each @model.deletedWorkspaces as |url|}}
          <div class='line' data-test-realm-code-deleted-workspace>
            <span class='glyph' aria-hidden='true'>−</span>
            <span class='text'>Deleted workspace
              <span class='path'>{{url}}</span></span>
          </div>
        {{/each}}
        {{#each @model.failedUiActions as |uiAction|}}
          <div class='line' data-test-realm-code-ui-action={{uiAction.action}}>
            <span class='glyph' aria-hidden='true'>→</span>
            <span class='text'>
              {{uiAction.action}}
              <span class='path'>{{shortPath
                  uiAction.target
                  @model.realm
                }}</span>
              <span class='status'>{{uiAction.status}}</span>
              {{#if uiAction.detail}}
                <span class='status'>{{uiAction.detail}}</span>
              {{/if}}
            </span>
          </div>
        {{/each}}
        {{#each @model.roomChanges as |change|}}
          <div class='line' data-test-realm-code-room-change>
            <span class='glyph' aria-hidden='true'>·</span>
            <span class='text muted'>{{change}}</span>
          </div>
        {{/each}}
        {{#each @model.activity as |activity|}}
          <div class='line' data-test-realm-code-activity>
            <span class='glyph' aria-hidden='true'>·</span>
            <span class='text muted'>{{activity}}</span>
          </div>
        {{/each}}
        {{#if @model.shownCard}}
          <div class='line' data-test-realm-code-shown-card>
            <span class='glyph' aria-hidden='true'>↗</span>
            <span class='text'>Opened
              <a class='path' href={{@model.shownCard}}>{{shortPath
                  @model.shownCard
                  @model.realm
                }}</a></span>
          </div>
        {{/if}}
        {{#if @model.showError}}
          <div class='line failed' data-test-realm-code-show-error>
            <span class='glyph' aria-hidden='true'>✕</span>
            <span class='text'>{{@model.showError}}</span>
          </div>
        {{/if}}
        {{#if @model.captures.length}}
          <div class='captures'>
            {{#each @model.captures as |capture|}}
              <img
                class='capture'
                alt={{capture.name}}
                title={{capture.name}}
                {{roomMediaSrc capture.url @context.loadRoomMedia}}
                data-test-realm-code-capture
              />
            {{/each}}
          </div>
        {{/if}}
      </div>
      <style scoped>
        .realm-code-result {
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: var(--boxel-font-size-sm, 13px);
          line-height: 1.45;
          color: inherit;
        }
        .line {
          display: grid;
          grid-template-columns: 16px minmax(0, 1fr);
          column-gap: 8px;
          align-items: baseline;
        }
        .glyph {
          text-align: center;
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: 11.5px;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .glyph.done {
          color: var(--success, var(--boxel-highlight));
        }
        .text {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .path {
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: 12px;
          color: inherit;
          text-decoration: none;
        }
        a.path:hover {
          text-decoration: underline;
        }
        .status,
        .muted {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .status {
          margin-inline-start: 6px;
          font-size: 11.5px;
          text-transform: lowercase;
        }
        .failed .glyph,
        .failed .text {
          color: var(--destructive, var(--boxel-error-200));
        }
        .captures {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding-inline-start: 24px;
        }
        .capture {
          max-width: 8rem;
          max-height: 8rem;
          object-fit: contain;
          border-radius: 6px;
          box-shadow: 0 0 0 1px var(--border, var(--boxel-200));
        }
      </style>
    </template>
  };
}

export class ViewVisuallyInput extends CardDef {
  // A card instance or a file in a workspace, by URL.
  @field url = contains(StringField);
  @field format = contains(StringField, {
    description: '"isolated" (the default) or "embedded".',
  });
  // Flat JSON-primitive geometry, for the reason `CaptureInput` gives.
  @field viewportWidth = contains(NumberField, {
    description:
      'Width of the browser window the capture renders in, in CSS px; set together with viewportHeight. The default is 1280×800, a laptop screen. Capture at the width the work is about: a phone is about 390×844, a tablet about 820×1180.',
  });
  @field viewportHeight = contains(NumberField, {
    description:
      'Height of the browser window the capture renders in, in CSS px; set together with viewportWidth.',
  });
  @field fullPage = contains(BooleanField, {
    description:
      'Set true to capture the whole page, not just the top viewportHeight of it. Not with target.',
  });
  @field target = contains(StringField, {
    description:
      'A CSS selector for one part of a card, such as ".pricing" or "footer", read from the card\'s template: the capture is of the first element it matches, scrolled into view and cropped to it. Use it to see a part of the card below the top of the page, or one section up close. Cards only (a file renders in its own frame), and not with fullPage.',
  });
}

export class ViewVisuallyResult extends CardDef {
  static displayName = 'View Visually Result';

  @field sourceUrl = contains(StringField);
  @field kind = contains(StringField); // 'card' | 'file'
  @field format = contains(StringField);
  // The window the capture rendered in, and the selector it was cropped to
  // (unset for a capture of the page).
  @field viewportWidth = contains(NumberField);
  @field viewportHeight = contains(NumberField);
  @field target = contains(StringField);
  // Set when the attached image shows less than the capture (a tall capture
  // cut to its top).
  @field note = contains(StringField);
  @field attachedImages = containsMany(AttachedImageField);

  // What the assistant saw: the captured image, and what it is an image of.
  static embedded = class Embedded extends Component<
    typeof ViewVisuallyResult
  > {
    get title() {
      return `View of ${lastPathSegment(this.args.model.sourceUrl) ?? 'capture'}`;
    }
    get image() {
      return this.args.model.attachedImages?.[0];
    }
    <template>
      <figure class='view-visually-result'>
        <h3 class='title' data-test-view-visually-title>{{this.title}}</h3>
        {{#if this.image.url}}
          <img
            alt={{this.title}}
            {{roomMediaSrc this.image.url @context.loadRoomMedia}}
            data-test-view-visually-image
          />
        {{/if}}
        <figcaption>
          {{#if @model.sourceUrl}}
            <a href={{@model.sourceUrl}}>{{@model.sourceUrl}}</a>
          {{/if}}
          {{#if @model.note}}
            <p class='note'>{{@model.note}}</p>
          {{/if}}
        </figcaption>
      </figure>
      <style scoped>
        .view-visually-result {
          margin: 0;
          padding: var(--boxel-sp-sm);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .title {
          margin: 0;
          font: 600 var(--boxel-font-sm);
        }
        img {
          max-width: 100%;
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius);
        }
        figcaption {
          font: var(--boxel-font-xs);
          word-break: break-all;
        }
        .note {
          margin: var(--boxel-sp-xxxs) 0 0;
          color: var(--boxel-450);
        }
      </style>
    </template>
  };
}

// Aliases: a stored capture-card tool result adopts from `CaptureCardOutput`,
// and realm content references these types by name.
export { CaptureInput as CaptureCardInput, CaptureOutput as CaptureCardOutput };

// One file or card instance a correctness check covers. `attempt` is set only
// past a target's first automated round.
export class CorrectnessTargetField extends FieldDef {
  @field type = contains(StringField);
  @field ref = contains(StringField);
  @field lintIssues = containsMany(StringField);
  @field attempt = contains(NumberField);
}

// A check names either one target (`targetType` + `targetRef`, the shape
// older rooms carry) or several (`targets`).
export class CheckCorrectnessInput extends CardDef {
  @field targetType = contains(StringField);
  @field targetRef = contains(StringField);
  @field roomId = contains(StringField);
  @field lintIssues = containsMany(StringField);
  @field targets = containsMany(CorrectnessTargetField);
}

export class CorrectnessTargetResultField extends FieldDef {
  @field targetType = contains(StringField);
  @field targetRef = contains(StringField);
  @field errors = containsMany(StringField);
  @field warnings = containsMany(StringField);
}

// `errors` and `warnings` hold every target's lines. A check of several
// targets also fills `targetResults`, one entry per target that failed or
// warned (a target without one passed clean), and the counts.
export class CorrectnessResultCard extends CardDef {
  @field correct = contains(BooleanField);
  @field errors = containsMany(StringField);
  @field warnings = containsMany(StringField);
  @field targetResults = containsMany(CorrectnessTargetResultField);
  @field checkedCount = contains(NumberField);
  @field passedCount = contains(NumberField);
}

export class CreateAIAssistantRoomInput extends CardDef {
  @field name = contains(StringField);
  // Legacy: skills passed as loaded `Skill` cards. Retained for back-compat.
  @field enabledSkills = linksToMany(Skill);
  @field disabledSkills = linksToMany(Skill);
  // Skills passed by id (kind-agnostic): each id may name a `.md` skill file
  // (`boxel.kind: skill`) or a legacy `Skill` card. Resolved via
  // `loadSkillSource` at room creation. Preferred over the card fields above.
  @field enabledSkillIds = containsMany(StringField);
  @field disabledSkillIds = containsMany(StringField);
  @field llmMode = contains(StringField); // 'gpt-4o' or 'gpt-4o-mini'
}

export class CreateAIAssistantRoomResult extends CardDef {
  @field roomId = contains(StringField);
}

export class InviteUserToRoomInput extends CardDef {
  @field roomId = contains(StringField);
  @field userId = contains(StringField);
}

export class RegisterBotInput extends CardDef {
  @field username = contains(StringField);
}

export class RegisterBotResult extends CardDef {
  @field botRegistrationId = contains(StringField);
}

export class UnregisterBotInput extends CardDef {
  @field botRegistrationId = contains(StringField);
}

export class SetActiveLLMInput extends CardDef {
  @field roomId = contains(StringField);
  @field model = contains(StringField);
  @field mode = contains(StringField); // 'act' or 'ask'
}

export class AddSkillsToRoomInput extends CardDef {
  @field roomId = contains(StringField);
  @field skills = linksToMany(Skill);
}

export class UpdateSkillActivationInput extends CardDef {
  @field roomId = contains(StringField);
  @field skillCardId = contains(StringField);
  @field isActive = contains(BooleanField);
}

export class UpdateRoomSkillsInput extends CardDef {
  @field roomId = contains(StringField);
  @field skillCardIdsToActivate = containsMany(StringField);
  @field skillCardIdsToDeactivate = containsMany(StringField);
}

export class UseAiAssistantInput extends CardDef {
  @field roomId = contains(StringField); // pass 'new' or leave blank to create a new room
  @field roomName = contains(StringField); // only used when creating a new room
  @field llmModel = contains(StringField);
  @field llmMode = contains(StringField); // act vs ask
  @field openRoom = contains(BooleanField);
  @field skillCards = linksToMany(Skill);
  @field skillCardIds = containsMany(StringField);
  @field attachOpenCards = contains(BooleanField); // also attach the cards currently open in the host
  @field attachedCards = linksToMany(CardDef);
  @field attachedCardIds = containsMany(StringField);
  @field attachedFileIdentifiers = containsMany(StringField);
  @field prompt = contains(StringField);
  @field clientGeneratedId = contains(StringField);
  @field openCardIds = containsMany(StringField);
  @field requireCommandCall = contains(BooleanField); // optional: require AI to execute commands
}

export class SendAiAssistantMessageInput extends CardDef {
  @field roomId = contains(StringField);
  @field prompt = contains(StringField);
  @field clientGeneratedId = contains(StringField);
  @field attachedCards = linksToMany(CardDef);
  @field attachedFileIdentifiers = containsMany(StringField);
  @field realmIdentifier = contains(StringField);
  @field openCardIds = containsMany(StringField);
  @field requireCommandCall = contains(BooleanField);
}

export class SendAiAssistantMessageResult extends CardDef {
  @field roomId = contains(StringField);
  @field eventId = contains(StringField);
}

export class OpenAiAssistantRoomInput extends CardDef {
  @field roomId = contains(StringField);
}

export class AddFieldToCardDefinitionInput extends CardDef {
  @field realm = contains(StringField);
  @field path = contains(StringField);
  @field cardDefinitionToModify = contains(CodeRefField);
  @field fieldName = contains(StringField);
  @field module = contains(StringField);
  @field fieldType = contains(StringField); // 'contains' or 'containsMany'
  @field fieldRef = contains(CodeRefField);
  @field fieldDefinitionType = contains(StringField); // 'card' or 'field'
  @field incomingRelativeTo = contains(StringField); // can be undefined when you know the url is not going to be relative
  @field outgoingRelativeTo = contains(StringField); // can be undefined when you know url is not going to be relative
  @field outgoingRealmURL = contains(StringField); // should be provided when the other 2 params are provided
  @field addFieldAtIndex = contains(NumberField); // if provided, the field will be added at the specified index in the card's possibleFields map
  @field computedFieldFunctionSourceCode = contains(StringField); // if provided, the field will be added as a computed field
}

export class ListingActionInput extends CardDef {
  @field realm = contains(StringField);
  @field actionType = contains(StringField);
  @field listing = linksTo(CardDef);
  @field attachedCard = linksTo(CardDef);
}

export class ListingBuildInput extends CardDef {
  @field realm = contains(StringField);
  @field listing = linksTo(CardDef);
}

export class ListingInstallInput extends CardDef {
  @field realm = contains(StringField);
  @field listing = linksTo(CardDef);
}

export class ListingInstallResult extends CardDef {
  @field exampleCardId = contains(StringField);
  @field skillCardId = contains(StringField);
  @field selectedCodeRef = contains(CodeRefField);
}

export class CreateListingPRRequestInput extends CardDef {
  @field realm = contains(RealmField);
  @field listingId = contains(StringField);
  @field listingName = contains(StringField);
}

export class RetrySubmissionWorkflowInput extends CardDef {
  @field workflowCardId = contains(StringField);
}

export class ListingCreateInput extends CardDef {
  @field openCardIds = containsMany(StringField);
  // installed with the listing but not shown in the listing detail view
  @field supportingCardIds = containsMany(StringField);
  @field codeRef = contains(CodeRefField);
  @field targetRealm = contains(RealmField);
}

export class ListingCreateResult extends CardDef {
  @field listing = linksTo(CardDef);
}

export class ListingUpdateSpecsInput extends CardDef {
  @field listing = linksTo(CardDef);
}

export class ListingUpdateSpecsResult extends CardDef {
  @field listing = linksTo(CardDef);
  @field specs = linksToMany(Spec);
}

export class VisitCardsInput extends CardDef {
  @field query = contains(QueryField);
  @field commandRef = contains(CodeRefField);
}

export class EvaluateModuleInput extends CardDef {
  @field moduleIdentifier = contains(StringField);
  @field realmIdentifier = contains(StringField);
}

export class EvaluateModuleResult extends CardDef {
  @field passed = contains(BooleanField);
  @field error = contains(StringField);
  @field stackTrace = contains(StringField);
  @field deps = containsMany(StringField);
}

export class InstantiateCardInput extends CardDef {
  @field moduleIdentifier = contains(StringField);
  @field cardName = contains(StringField);
  @field realmIdentifier = contains(StringField);
  @field instanceData = contains(StringField);
}

export class InstantiateCardResult extends CardDef {
  @field passed = contains(BooleanField);
  @field error = contains(StringField);
  @field stackTrace = contains(StringField);
}

export class JsonCard extends CardDef {
  @field json = contains(JsonField);
}

export class FileForAttachmentCard extends CardDef {
  @field fileForAttachment = contains(JsonField);
}

export class CardForAttachmentCard extends CardDef {
  @field cardForAttachment = contains(JsonField);
}

export class GetEventsFromRoomInput extends CardDef {
  @field roomId = contains(StringField);
  @field sinceEventId = contains(StringField);
}

export class GetEventsFromRoomResult extends CardDef {
  @field matrixEvents = containsMany(JsonField);
}

export class SendBotTriggerEventInput extends CardDef {
  @field roomId = contains(StringField);
  @field type = contains(StringField);
  @field input = contains(JsonField);
  @field realm = contains(StringField);
}

export class PreviewFormatInput extends CardDef {
  @field cardId = contains(StringField);
  @field format = contains(StringField);
  @field modulePath = contains(StringField);
}

export class SendRequestViaProxyInput extends CardDef {
  @field url = contains(StringField);
  @field method = contains(StringField);
  @field requestBody = contains(StringField);
  @field headers = contains(JsonField); // optional
  @field multipart = contains(BooleanField); // optional
  // How long the caller is prepared to wait, in milliseconds. A tool input is
  // a CardDef, so a deadline can only be expressed as serializable data — the
  // host turns this into the abort signal on the request. Unset means wait
  // indefinitely.
  @field timeoutMs = contains(NumberField); // optional
}

export class SendRequestViaProxyResult extends CardDef {
  @field response = contains(ResponseField);
}

export class SummarizeSessionInput extends CardDef {
  @field roomId = contains(StringField);
}

export class SummarizeSessionResult extends CardDef {
  @field summary = contains(StringField);
}

export {
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
  SearchCardSummaryField,
  SearchEntriesInput,
  SearchEntriesResult,
  SearchEntrySummaryField,
};

export class RealmInfoField extends FieldDef {
  @field name = contains(StringField);
  @field backgroundURL = contains(StringField);
  @field iconURL = contains(StringField);
  @field showAsCatalog = contains(BooleanField);
  @field visibility = contains(StringField);
  @field realmUserId = contains(StringField);
  @field publishable = contains(BooleanField);
  @field isIndexing = contains(BooleanField);
  @field isPublic = contains(BooleanField);
}

export class RealmMetaField extends FieldDef {
  @field info = contains(RealmInfoField);
  @field canWrite = contains(BooleanField);
  @field realmIdentifier = contains(StringField);
}

export class GetAllRealmMetasResult extends CardDef {
  @field results = containsMany(RealmMetaField);
}

export class GetAvailableRealmIdentifiersResult extends CardDef {
  @field realmIdentifiers = containsMany(StringField);
}

export class GetCatalogRealmIdentifiersResult extends CardDef {
  @field realmIdentifiers = containsMany(StringField);
}

export class FetchCardJsonInput extends CardDef {
  @field cardIdentifier = contains(StringField);
}

export class FetchCardJsonResult extends CardDef {
  @field document = contains(JsonField);
}

export class ExecuteAtomicOperationsInput extends CardDef {
  @field realmIdentifier = contains(StringField);
  @field operations = containsMany(JsonField);
}

export class ExecuteAtomicOperationsResult extends CardDef {
  @field results = containsMany(JsonField);
}

// One invocation of one operation a card's type declares. 'payload' carries
// the operation's params, keyed exactly as its 'params' schema names them.
//
// 'realm' and 'relationships' describe a card the plain 'create' mints, and
// are read for nothing else: where it lands, and the links it is created
// holding, as JSON:API relationship objects. An operation that runs against
// the card at 'cardId' runs in that card's own realm, and a declared
// operation takes the cards it links among its params.
export class InvokeCardOperationInput extends CardDef {
  @field cardId = contains(StringField);
  @field operation = contains(StringField);
  @field payload = contains(JsonField);
  @field realm = contains(StringField);
  @field relationships = contains(JsonField);
  // The same opt-out `SaveCardInput.skipIndexWait` is, for a write made
  // through an operation: the realm answers once the write is durable rather
  // than once it is indexed. Opt-in for the same reason, so an unset field
  // keeps the waiting behavior.
  @field skipIndexWait = contains(BooleanField, {
    description:
      'Leave unset normally. Set true only to make a write return without waiting for the realm to index it — the written card may briefly not appear in searches. Do not set this when a search for the written card follows.',
  });
}

// What an operation answers, in the two shapes an answer takes. A write
// reports the card it wrote and the version it wrote — the card's own id, not
// the target's, so a create reports the card it minted. A read reports the
// document, which an author's output program may have reshaped. A delete
// answers nothing and so fills neither: the card is gone, and the invocation
// having succeeded is the whole of the news.
//
// 'cardId' rather than 'id' because CardDef already carries 'id' as the
// instance's own identifier.
export class InvokeCardOperationResult extends CardDef {
  @field cardId = contains(StringField);
  @field version = contains(StringField);
  @field generation = contains(NumberField);
  // True when the realm answered the write before indexing it, which is why
  // `generation` is empty: a search may not show the write until it lands.
  @field indexPending = contains(BooleanField);
  @field lastModified = contains(NumberField);
  @field document = contains(JsonField);
}

// A publish destination for a realm. 'type' is 'subdirectory' (a Boxel Space
// under the user's space domain, where 'name' is the realm-name path segment)
// or 'custom' (a claimed custom domain, where 'name' is the full hostname).
export class PublishTarget extends FieldDef {
  @field type = contains(StringField);
  @field name = contains(StringField);
}

export class PublishRealmInput extends CardDef {
  @field realmURL = contains(StringField);
  @field targets = containsMany(PublishTarget);
  // Pre-resolved published-realm URLs. The publish UI builds these with live
  // Matrix state, so it passes them directly instead of typed targets; they are
  // merged with any resolved 'targets'. Provide at least one of the two.
  @field publishedRealmURLs = containsMany(StringField);
  // Bypass the pre-publish publishability gate (private-dependency and
  // error-document violations). Defaults to false.
  @field force = contains(BooleanField);
}

// Per-target outcome. 'status' is 'published' (the site is live),
// 'published-pending' (accepted, and its HTML is still rendering after the
// readiness wait ran out; it goes live without another publish) or 'error'.
export class PublishTargetResult extends FieldDef {
  @field publishedRealmURL = contains(StringField);
  @field status = contains(StringField);
  @field error = contains(StringField);
}

export class PublishRealmResult extends CardDef {
  @field results = containsMany(PublishTargetResult);
}

export class UnpublishRealmInput extends CardDef {
  @field realmURL = contains(StringField);
  // Supply either a typed target or a fully-resolved publishedRealmURL.
  @field target = contains(PublishTarget);
  @field publishedRealmURL = contains(StringField);
}

// 'status' is 'unpublished' or 'error'.
export class UnpublishRealmResult extends CardDef {
  @field publishedRealmURL = contains(StringField);
  @field status = contains(StringField);
  @field error = contains(StringField);
}

export class GetPublishedRealmsInput extends CardDef {
  @field realmURL = contains(StringField);
}

// One published destination for a source realm. lastPublishedAt mirrors the
// realm-server value: epoch milliseconds rendered as a string (Date.now()
// .toString()); absent when the realm has never been published.
export class PublishedRealmInfo extends FieldDef {
  @field publishedRealmURL = contains(StringField);
  @field lastPublishedAt = contains(StringField);
}

export class GetPublishedRealmsResult extends CardDef {
  @field results = containsMany(PublishedRealmInfo);
}

// 'type' is 'subdirectory' | 'custom'; 'name' matches PublishTarget.name.
export class CheckDomainAvailabilityInput extends CardDef {
  @field type = contains(StringField);
  @field name = contains(StringField);
  @field realmURL = contains(StringField);
}

export class CheckDomainAvailabilityResult extends CardDef {
  @field available = contains(BooleanField);
  @field publishedRealmURL = contains(StringField);
  @field reason = contains(StringField);
}

export class StoreAddInput extends CardDef {
  @field document = contains(JsonField);
  @field realm = contains(StringField);
}

export class GetRealmOfResourceIdentifierInput extends CardDef {
  @field resourceIdentifier = contains(StringField);
}

export class GetRealmOfResourceIdentifierResult extends CardDef {
  @field realmIdentifier = contains(StringField); // empty string if not found
}

export class CanReadRealmInput extends CardDef {
  @field realmIdentifier = contains(StringField);
}

export class CanReadRealmResult extends CardDef {
  @field canRead = contains(BooleanField);
}

export class AuthedFetchInput extends CardDef {
  @field url = contains(StringField);
  @field method = contains(StringField);
  @field acceptHeader = contains(StringField);
}

export class AuthedFetchResult extends CardDef {
  @field ok = contains(BooleanField);
  @field status = contains(NumberField);
  @field body = contains(JsonField);
}

export class GetDefaultWritableRealmResult extends CardDef {
  @field realmIdentifier = contains(StringField); // empty string if no writable realm found
}

export class ValidateRealmInput extends CardDef {
  @field realmIdentifier = contains(StringField);
}

export class ValidateRealmResult extends CardDef {
  @field realmIdentifier = contains(StringField); // normalized with trailing slash
}

export class SanitizeModuleListInput extends CardDef {
  @field moduleIdentifiers = containsMany(StringField);
}

export class SanitizeModuleListResult extends CardDef {
  @field moduleIdentifiers = containsMany(StringField);
}

export class SearchGoogleImagesInput extends CardDef {
  @field query = contains(StringField);
  @field maxResults = contains(NumberField); // optional, default 10
  @field startIndex = contains(NumberField); // optional, default 1, for pagination
}

export class SearchGoogleImagesResult extends CardDef {
  @field images = containsMany(JsonField);
  @field totalResults = contains(NumberField);
  @field searchTime = contains(NumberField);
  @field formattedTotalResults = contains(StringField);
  @field formattedSearchTime = contains(StringField);
  @field hasNextPage = contains(BooleanField);
  @field nextPageStartIndex = contains(NumberField);
  @field currentStartIndex = contains(NumberField);
}

export class CreateSpecsInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field module = contains(StringField);
  @field targetRealm = contains(StringField);
  @field autoGenerateReadme = contains(BooleanField);
}

export class CreateSpecsResult extends CardDef {
  @field newSpecs = linksToMany(Spec);
  @field specs = linksToMany(Spec);
}

export class PatchFieldsInput extends CardDef {
  static displayName = 'Patch Fields Input';

  @field cardId = contains(StringField);
  @field fieldUpdates = contains(JsonField); // Dynamic field mapping as JSON object
}

export class PatchFieldsOutput extends CardDef {
  static displayName = 'Patch Fields Result';

  @field success = contains(BooleanField);
  @field updatedFields = containsMany(StringField); // Array of successfully updated field paths
  @field errors = contains(JsonField); // Field path to error message mapping

  static embedded = class Embedded extends Component<typeof PatchFieldsOutput> {
    get updatedFieldsCount(): number {
      return this.args.model.updatedFields?.length ?? 0;
    }
    get commaSepUpdatedFields(): string {
      return (this.args.model.updatedFields ?? []).join(', ');
    }
    get commaSepErrors(): string {
      let errors = this.args.model.errors ?? {};
      return Object.entries(errors)
        .map(([field, message]) => `${field}: ${message}`)
        .join('; ');
    }
    <template>
      <div class='wrapper'>
        {{#if (gt this.updatedFieldsCount 0)}}
          Updated
          {{this.updatedFieldsCount}}
          field{{unless (eq this.updatedFieldsCount 1) 's'}}:
          {{this.commaSepUpdatedFields}}.
          {{#if @model.errors.length}}
            Errors:
            {{this.commaSepErrors}}.
          {{/if}}
        {{else}}
          No fields were updated. Errors:
          {{this.commaSepErrors}}.
        {{/if}}
      </div>
      <style scoped>
        .wrapper {
          padding: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };
}

export class GenerateReadmeSpecResult extends CardDef {
  @field readme = contains(MarkdownField);
}

export class GenerateReadmeSpecInput extends CardDef {
  @field spec = linksTo(Spec);
}

export class OneShotLLMRequestInput extends CardDef {
  @field codeRef = contains(AbsoluteCodeRefField);
  @field userPrompt = contains(StringField);
  @field systemPrompt = contains(StringField);
  @field llmModel = contains(StringField);
  @field skillCardIds = containsMany(StringField);
  @field attachedFileIdentifiers = containsMany(StringField);
}

export class OneShotLLMRequestResult extends CardDef {
  @field output = contains(StringField);
}

// Select up to N cards of a given type using an LLM heuristic
export class SearchAndChooseInput extends CardDef {
  @field candidateTypeCodeRef = contains(CodeRefField); // module + name of card type whose instances should be searched as candidates
  @field sourceContextCodeRef = contains(AbsoluteCodeRefField); // optional module + name whose source should guide selection
  @field max = contains(NumberField); // optional, default 2
  @field additionalSystemPrompt = contains(StringField); // optional extra hard rules
  @field llmModel = contains(StringField); // optional model override
}

export class SearchAndChooseResult extends CardDef {
  @field selectedIds = containsMany(StringField);
  @field selectedCards = linksToMany(CardDef);
}

export class SyncOpenRouterModelsResult extends CardDef {
  @field modelsProcessed = contains(NumberField);
  @field totalModels = contains(NumberField);
  @field status = contains(StringField);
  @field errors = contains(StringField);
}

export class CreateWorkspaceInput extends CardDef {
  @field name = contains(StringField); // display name; a random name is generated when omitted
  @field endpoint = contains(StringField); // URL path segment (letters, digits, hyphens); derived from the name when omitted
}
