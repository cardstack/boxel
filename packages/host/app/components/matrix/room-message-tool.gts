import { isDestroyed } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { later, schedule } from '@ember/runloop';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { cached, tracked } from '@glimmer/tracking';

import Ellipsis from '@cardstack/boxel-icons/ellipsis';

import { registerBeacon } from '@cardstack/choreo';
import { AgentQuestion } from '@cardstack/pretui/components/agent-question';
import { CardEmbed } from '@cardstack/pretui/components/card-embed';

import { CardPills } from '@cardstack/pretui/components/card-pills';
import { CodeBlock as PretCodeBlock } from '@cardstack/pretui/components/code-block';
import { lineDiff } from '@cardstack/pretui/components/diff-block';
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { Menu } from '@cardstack/pretui/components/menu';
import { Reactions } from '@cardstack/pretui/components/reactions';
import { ResultCard } from '@cardstack/pretui/components/result-card';
import { SystemLine } from '@cardstack/pretui/components/system-line';

import { ToolChangeTable } from '@cardstack/pretui/components/tool-change-table';
import { ToolGate } from '@cardstack/pretui/components/tool-gate';

import { ToolMeta } from '@cardstack/pretui/components/tool-meta';
import { ToolPlan } from '@cardstack/pretui/components/tool-plan';
import {
  formatToolDuration,
  ToolChange,
  ToolDiff,
  ToolLine,
  ToolReceiptAction,
  ToolRow,
  humanizeToolName,
} from '@cardstack/pretui/components/tool-row';
import { modifier } from 'ember-modifier';

import { consume, provide } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';
import { motion } from 'glimmer-motion';
import { TrackedObject } from 'tracked-built-ins';

import { and, bool, cn, eq, gt, not, or } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  cardTypeDisplayName,
  cardTypeIcon,
  getMenuItems,
  hasNothingToShow,
  isCardInstance,
} from '@cardstack/runtime-common';

import type { ToolRequest } from '@cardstack/runtime-common/commands';

import { isAskUserTool } from '@cardstack/host/lib/ask-user';
import { cardMenuEntries } from '@cardstack/host/lib/card-menu-entries';
import type MessageTool from '@cardstack/host/lib/matrix-classes/message-tool';
import {
  isDiffable,
  parseCompactDiff,
  resultCardChanges,
  resultDiff,
} from '@cardstack/host/lib/realm-runner/edits';
import type { CardFieldChange } from '@cardstack/host/lib/realm-runner/edits';
import { STOPPED_BY_USER } from '@cardstack/host/lib/realm-runner/types';
import { runDeliveryId } from '@cardstack/host/lib/run-delivery';
import { isAutoExecutableTool } from '@cardstack/host/lib/tool-auto-execute';
import { plainTitle, settledTitle } from '@cardstack/host/lib/tool-title';
import type { ChangedFile } from '@cardstack/host/lib/turn-summary';

import type { RoomResource } from '@cardstack/host/resources/room';
import type AssistantQuickLookService from '@cardstack/host/services/assistant-quick-look';
import type MatrixService from '@cardstack/host/services/matrix-service';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';
import { DENIED_BY_USER } from '@cardstack/host/services/tool-service';

import CardRenderer from '../card-renderer';

import AskUserPicker from './ask-user-picker';
import FoundEntries from './found-entries';

import type { AskUserOptionData } from './ask-user-picker';

import type { ApplyButtonState } from '../ai-assistant/apply-button';
import type { CardContext, CardDef } from '@cardstack/base/card-api';
import type { CardPillItem } from '@cardstack/pretui/components/card-pills';
import type { DiffLine } from '@cardstack/pretui/components/diff-block';
import type { Reaction } from '@cardstack/pretui/components/reactions';
import type { ToolChangeRow } from '@cardstack/pretui/components/tool-change-table';
import type { ToolGateAction } from '@cardstack/pretui/components/tool-gate';
import type { ToolPlanStep } from '@cardstack/pretui/components/tool-plan';
import type {
  ToolDensity,
  ToolProgress,
} from '@cardstack/pretui/components/tool-row';

interface ResultLine {
  glyph: string;
  tone?: 'done' | 'live' | 'failed' | 'attention' | 'muted';
  text: string;
  sub?: string;
  mono?: boolean;
  href?: string;
  hook?: string;
  hookValue?: string;
  // a deleted file: the line names it struck through
  struck?: boolean;
  // an image the call wrote: shown small under its line
  thumb?: string;
  // the thumb is room media (a capture the call uploaded), not a realm file
  roomMedia?: boolean;
  // a question the run asked: the reader's answer, bold after it
  answer?: string;
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;
// A card instance a run wrote: a realm .json file that is not the realm's
// own configuration.
const CARD_FILE = /\/(?!(?:realm|package|tsconfig)\.json$)[^/]+\.json$/;

interface FieldChange {
  label: string;
  from?: string;
  to?: string;
}

interface FileDiff {
  url: string;
  path: string;
  before?: string;
  after?: string;
  lines?: DiffLine[];
  // read from the result, where there is no before or after to tell by
  status?: ChangedFile['status'];
}

// The run card's fields the row reads: its state and where it is.
interface RunState {
  status?: string;
  progressCurrent?: number;
  progressTotal?: number;
  currentActivity?: string;
}

/** Calls back on install and whenever the value changes. */
const whenChanged = modifier(
  (
    _element: HTMLElement,
    [callback, value]: [(value: unknown) => void, unknown],
  ) => {
    callback(value);
  },
);

// A failure's message as one line: its first sentence or line, with a
// runner's repeated step prefix ("Step 1 of 3 · Step 1 of 3") said once.
function failureHeadline(message: string): string {
  let first = message.split('\n', 1)[0]!.trim();
  let sentence = first.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? first;
  return sentence.replace(/(Step \d+ of \d+)(?: · \1)+/g, '$1');
}

// What a runner's activity line reports, as a glyph and a tone: a read or a
// search that worked, one that was refused, an auto-fix, a repair. The
// runner writes these lines in words; the row gives each its mark.
type LineTone = 'done' | 'live' | 'failed' | 'attention' | 'muted';
// A run's UI action as what the reader saw happen
function uiActionText(action: string, target: string | undefined): string {
  let where = target ? shortPath(target) : '';
  switch (action) {
    case 'switchSubmode':
      return `Switched to ${where || 'another'} mode`;
    case 'openFile':
      return `Opened ${where}`;
    case 'previewFormat':
      return `Previewed as ${where}`;
    case 'openWorkspace':
      return `Opened the workspace ${where}`.trim();
    default:
      return `${action} ${where}`.trim();
  }
}

// Tools that move what the reader sees rather than change data
const UI_MOVE =
  /^(?:set-?view|show|open|switch|preview|navigate|reveal|focus)|view$/i;

// "Asked: Which accent? · 🟦 Teal" from realm.ask: the question, and the
// reader's answer without the color mark a model may put before it
const ASKED_LINE = /^Asked: (.*) · (.+)$/;
const LEADING_MARKS = /^[\p{Extended_Pictographic}\p{So}\uFE0F\s]+/u;
// "Lime — #c3fc33" or "Lime (#c3fc33)": the hex a swatch already showed
const TRAILING_COLOR = /\s*(?:[—–-]\s*#[0-9a-f]{3,8}|\(#[0-9a-f]{3,8}\))\s*$/i;
function askedLine(
  text: string,
): { question: string; answer: string } | undefined {
  let match = ASKED_LINE.exec(text);
  if (!match) {
    return undefined;
  }
  let answer =
    match[2]!.replace(LEADING_MARKS, '').replace(TRAILING_COLOR, '').trim() ||
    match[2]!;
  return { question: match[1]!, answer };
}

function activityMark(text: string): { glyph: string; tone: LineTone } {
  // what a run read is counted quietly, as the board's outputs do
  if (/^Read \d+ files? · /.test(text)) {
    return { glyph: 'note', tone: 'muted' };
  }
  if (/^Copied /.test(text)) {
    return { glyph: 'done', tone: 'done' };
  }
  // an auto-fix names the error it fixed, so it is read first
  if (/^fixed a |auto-fix/i.test(text)) {
    return { glyph: 'retry', tone: 'muted' };
  }
  if (
    /could not|failed|refused|not supported|error|\(HTTP [45]\d\d\)/i.test(text)
  ) {
    return { glyph: 'failed', tone: 'failed' };
  }
  if (/^resolved data/i.test(text)) {
    return { glyph: 'resolve', tone: 'muted' };
  }
  if (
    /^(exa searched|firecrawl read|read |wrote |saved |updated |generated )/i.test(
      text,
    )
  ) {
    return { glyph: 'done', tone: 'done' };
  }
  return { glyph: 'note', tone: 'muted' };
}

// A refused read keeps its reason, in a few words: the service's apology
// and sales pitch are not the reader's business.
function briefActivity(text: string): string {
  let refused = text.match(
    /could not read ([^\s:]+)[^]*?(HTTP \d{3})?[^]*?(do not support)?/i,
  );
  if (refused && /could not read/i.test(text)) {
    let host = refused[1]!;
    let code = text.match(/HTTP \d{3}/)?.[0];
    let unsupported = /do not support|not supported/i.test(text);
    return `Couldn’t read ${host}${code ? ` · ${code}` : ''}${unsupported ? ' · not supported by Firecrawl' : ''}`;
  }
  // a report's first line can be a markdown heading: keep its words only
  let plain = text.replace(/^#{1,6}\s+/, '');
  return plain.length > 140 ? `${plain.slice(0, 139)}…` : plain;
}

// A run's own plan or step line, which its checklist already shows
const PLAN_OR_STEP_LINE = new RegExp('^(?:Plan · |Step \\d+ of \\d+)');
const PLAN_LINE = new RegExp('^Plan · ');
// a step a script reports: "Step 2 of 5 · Searching Brooklyn"
const STEP_LINE = new RegExp('^Step (\\d+) of \\d+');
// the model a search ran through is the runner's business, not the reader's
const THROUGH_MODEL = new RegExp(' through [\\w./:-]+(?=:|$)');
// The calls a run cut short reports it made: "… Research calls this run
// made: Step 1 of 5 · Searching Manhattan; Exa searched for …"
const REPORTED_CALLS = new RegExp('Research calls this run made: (.*)$', 's');
function reportedCalls(message: string | undefined): string[] {
  let list = message?.match(REPORTED_CALLS)?.[1];
  return list
    ? list
        .split(/;\s+(?=[A-Z])/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

// a title that says the call changes something
const CHANGE_VERB = new RegExp(
  '^\\s*(?:add|added|remove|removed|delete|deleted|update|updated|set|change|changed|mark|marked|create|created|rename|renamed|move|moved|replace|replaced|edit|edited|write|wrote|save|saved)\\b',
  'i',
);

// a skill's instructions file: …/<skill>/SKILL.md
const SKILL_FILE = new RegExp('([\\w.-]+)/SKILL\\.md\\b');

// the runner's own note that the reader stopped the run
const STOP_NOTE = new RegExp('^Stopped by you');
// a call the stop cut off, as the runner reports it
const STOPPED_CALL = new RegExp('\\s*(?:failed:.*|· stopped)$', 'i');

// What a step did, as the small line under it
function briefDetail(text: string): string {
  return briefActivity(text.replace(THROUGH_MODEL, ''));
}
// a realm call that can't be taken back: realm.fs.delete, realm.cards.remove
const DESTRUCTIVE_CALL = new RegExp('\\.(delete|remove)', 'i');
// the runner's tally of what a script read ("Read 2 files · 13 KB"): an
// incidental of the call, said in its meta line, not as a step it took
const READ_SIZE_LINE = new RegExp('^Read \\d+ files? · [\\d.]+ KB$');

// A runner's activity often starts with its own "Step 2 of 3 · ". The row
// already says the step, so its label keeps only what the step is doing.
function stepless(label: string | undefined): string | undefined {
  let rest = label?.replace(/^(?:Step \d+ of \d+\s*[·:—-]\s*)+/i, '').trim();
  return rest || undefined;
}

// How long a run's saved state may stand still before a page that did not
// start it reads it as paused.
const RUN_IDLE_MS = 3 * 60 * 1000;
// A room change as the reader says it: "Turned on the showcase director
// skill", not "Enabled skills: https://…/skills/showcase-director/SKILL.md"
function roomChangeLine(line: string): string {
  let match = line.match(ROOM_SKILLS_LINE);
  if (!match) {
    return line;
  }
  let names = match[2]!
    .split(/,\s*(?=https?:)/)
    .map((url) => skillName(url.trim()));
  let verb = match[1] === 'Enabled' ? 'Turned on' : 'Turned off';
  let list =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      : names[0];
  return `${verb} the ${list} ${names.length > 1 ? 'skills' : 'skill'}`;
}
const ROOM_SKILLS_LINE = new RegExp('^(Enabled|Disabled) skills: (.+)$');

// a skill's URL as its name: …/skills/boxel-showcase-director/SKILL.md →
// "showcase director"
function skillName(url: string): string {
  let parts = url.replace(/\/(SKILL\.md|index)?$/i, '').split('/');
  let last = parts.pop() || parts.pop() || url;
  return decodeURIComponent(last)
    .replace(/\.(md|json)$/i, '')
    .replace(/^boxel-/, '')
    .replace(/[-_]+/g, ' ');
}

// a markdown table's row, and its header rule (|---|:--:|)
const TABLE_ROW = new RegExp('^\\s*\\|');
const TABLE_RULE = new RegExp('^\\s*\\|?[\\s:|-]+\\|?\\s*$');
// a sentence ends at . ! or ? followed by a space
const SENTENCE_END = new RegExp('(?<=[.!?])\\s+');
// a run's markdown summary as plain words, for a one-line title
function plainText(markdown: string): string {
  return markdown
    .replace(new RegExp('\\[([^\\]]*)\\]\\([^)]*\\)', 'g'), '$1')
    .replace(new RegExp('[*_`#>]+', 'g'), '')
    .replace(new RegExp('\\s+', 'g'), ' ')
    .trim();
}
// how long the assistant's turn must stay settled before a run's result
// is posted into it
const DELIVERY_SETTLE_MS = 2500;
// a link's last path segment with an extension names a file, not a card
const LINK_FILE_EXTENSION = /\/[^/]+\.[a-z0-9]+$/i;
// A tab that only watched the run waits this long before it delivers, so
// the tab that ran it delivers first and its message has synced in by then;
// the watcher delivers only when that tab closed before it could.
const WATCHER_DELIVERY_MS = 30 * 1000;
const DIGITS = new RegExp('^\\d+$');
const READ_NAME = new RegExp('read', 'i');
// finished step lines shown before the rest fold behind "N more"
const FOLD_AFTER = 4;

// "baseWidthMm" → "Base width mm"; the last segment of a path is the field.
function fieldLabel(path: string): string {
  let last =
    path
      .split(/[.[\]]+/)
      .filter((part) => part && !DIGITS.test(part))
      .pop() ?? path;
  return humanizeToolName(last);
}

function displayValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return '—';
  }
  if (value instanceof Date) {
    return value.toLocaleDateString();
  }
  if (typeof value === 'object') {
    let title =
      (value as { title?: unknown; cardTitle?: unknown }).cardTitle ??
      (value as { title?: unknown }).title;
    if (typeof title === 'string') {
      return title;
    }
    return Array.isArray(value) ? `${value.length} items` : undefined;
  }
  // the width decides how much shows; this only bounds a pasted essay
  let text = String(value);
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

function valueAtPath(card: unknown, path: string): unknown {
  let value: any = card;
  for (let part of path.split(/[.[\]]+/).filter(Boolean)) {
    if (value == null) {
      return undefined;
    }
    value = value[/^\d+$/.test(part) ? Number(part) : part];
  }
  return value;
}

// A realm URL as the reader thinks of it: the path inside the realm, not the
// server and the owner.
function shortPath(url: string | undefined): string {
  if (!url) {
    return '';
  }
  try {
    let segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.length > 2
      ? segments.slice(2).join('/')
      : segments.join('/');
  } catch {
    return url;
  }
}

// Realm cards a tool hands back as its own record, not as something it made
// for the reader: a Realm Runner run reads as the row's progress and lines.
const INTERMEDIATE_REALM_CARDS = new Set([
  'Assistant Realm Run',
  'Assistant Realm Result',
  'Realm Script Result',
]);

// Whether a card's class gives it an embedded view of its own. A class that
// leaves `embedded` alone inherits CardDef's default, which shows only a
// placeholder thumbnail and the card's title. `isCardDef` is declared on
// CardDef itself, so the class that declares `embedded` is CardDef exactly
// when it also declares `isCardDef`.
function hasOwnEmbeddedView(card: CardDef): boolean {
  let klass: object | null = card.constructor;
  while (klass && !Object.hasOwn(klass, 'embedded')) {
    klass = Object.getPrototypeOf(klass);
  }
  return !!klass && !Object.hasOwn(klass, 'isCardDef');
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomResource: RoomResource;
    messageTool: MessageTool;
    roomId: string;
    runCommand: () => void;
    // Declines a call ai-bot holds for the user's approval.
    declineCommand?: () => void;
    isError?: boolean;
    isPending?: boolean;
    isCompact?: boolean;
    isStreaming: boolean;
    monacoSDK: MonacoSDK;
    // A failed call the assistant has since retried with a call that
    // succeeded: it settles to "retried below" instead of staying red.
    isSuperseded?: boolean;
    // the row stands for this many identical finished calls in a row
    foldCount?: number;
  };
}

export default class RoomMessageTool extends Component<Signature> {
  @service declare private toolService: ToolService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service('assistant-quick-look')
  declare private quickLook: AssistantQuickLookService;
  @service declare private store: StoreService;
  @service declare private network: NetworkService;

  @consume(CardContextName) declare private cardContext: CardContext;

  // The reader opened a failure's full message.
  @tracked private showFailureDetails = false;
  @tracked private showAllLines = false;

  private toggleFailureDetails = () => {
    this.showFailureDetails = !this.showFailureDetails;
  };

  // A tool's result card can show what the tool produced from the room's
  // media, such as an image it captured.
  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): CardContext {
    return {
      ...this.cardContext,
      loadRoomMedia: this.matrixService.loadRoomMedia,
    };
  }

  // How much of the call's arguments has arrived. On the element as a plain
  // data attribute so anything watching a session (the eval runner, and later
  // a deployed monitor) can tell a long tool call that is still streaming
  // from a stalled one, even while the box is collapsed.
  private get argumentsLength() {
    return (
      this.args.messageTool.argumentsText ??
      JSON.stringify(this.args.messageTool.arguments ?? {})
    ).length;
  }

  // While the arguments are still streaming they are not valid JSON yet, so
  // show the raw text received so far as it is.
  private get previewCommandCode() {
    let { name, arguments: payload, argumentsText } = this.args.messageTool;
    if (argumentsText) {
      return argumentsText;
    }
    return JSON.stringify({ name, payload }, null, 2);
  }

  @cached
  private get applyButtonState(): ApplyButtonState {
    if (this.failedToolState) {
      return 'failed';
    }
    if (this.didFailCorrectnessCheck) {
      return 'applied-with-error';
    }
    let status = this.args.messageTool?.status;
    // Mirror the Accept All bar fix: for any command the host will
    // auto-execute (checkCorrectness, requiresApproval=false, LLM mode
    // 'act'), present the applying spinner immediately on message-landed
    // instead of the clickable Run button. Without this, the per-command
    // Apply button flashes through 'ready' for the ~100ms debounce window
    // before tool-service starts the run. If validation later fails
    // in the drain, tool-service dispatches an `invalid` commandResult
    // event and the button transitions to its invalid state — no risk of
    // the spinner sticking.
    if ((status === 'ready' || status === undefined) && this.willAutoExecute) {
      // A stop keeps a tool that has not started from ever starting; one
      // already running finishes, and reads as applying until its result
      // lands.
      let { roomResource, messageTool } = this.args;
      if (
        roomResource.wasEverStopped(messageTool.eventId) &&
        !this.toolService.currentlyExecutingToolRequestIds.has(messageTool.id!)
      ) {
        return 'canceled';
      }
      return 'applying';
    }
    return status ?? 'ready';
  }

  private get willAutoExecute() {
    let activeMode = this.args.roomResource.getActiveLLMModeForMessage(
      this.args.messageTool.eventId,
    );
    let isOwnedByCurrentAgent =
      this.args.messageTool.message.agentId === this.matrixService.agentId;
    return isAutoExecutableTool(
      this.args.messageTool,
      activeMode,
      isOwnedByCurrentAgent,
    );
  }

  // The result card is the live store instance when the result doc names a
  // saved card. Holding a store reference for as long as this component
  // renders it keeps the instance out of the store's GC sweep and subscribed
  // to realm invalidation; otherwise a sweep could evict it mid-render and the
  // next `store.get` would mint a second instance for the same id.
  @use private toolResultCard = resource(({ on }) => {
    let initialState = { card: undefined, isRealmCard: false } as {
      card: CardDef | undefined;
      isRealmCard: boolean;
    };
    let state = new TrackedObject(initialState);
    let referencedId: string | undefined;
    let isTornDown = false;
    let isLoading = false;
    on.cleanup(() => {
      isTornDown = true;
      if (isLoading && isTesting()) {
        // Every re-run of this resource starts the result card's load over,
        // so a run torn down mid-load delays the card. Logged so a test that
        // times out waiting for the card shows whether loads kept restarting.
        console.log(
          `[tool-result-card] discarded an in-flight result card load for tool call ${this.args.messageTool.toolRequest.id}`,
        );
      }
      if (referencedId) {
        this.store.dropReference(referencedId);
      }
    });
    if (this.args.messageTool.toolResultFileDef) {
      isLoading = true;
      this.args.messageTool.getCommandResultCard().then((result) => {
        isLoading = false;
        if (!result && isTesting()) {
          console.log(
            `[tool-result-card] result card load for tool call ${this.args.messageTool.toolRequest.id} produced no card`,
          );
        }
        if (isTornDown || !result) {
          return;
        }
        let { card, isRealmCard } = result;
        if (card.id) {
          referencedId = card.id;
          this.store.addReference(card.id);
        }
        state.isRealmCard = isRealmCard;
        state.card = card;
      });
    }
    return state;
  });

  private get isDisplayingCode() {
    return this.args.roomResource.isDisplayingCode(
      this.args.messageTool.toolRequest as ToolRequest,
    );
  }

  private toggleViewCode = () => {
    this.args.roomResource.toggleViewCode(
      this.args.messageTool.toolRequest as ToolRequest,
    );
  };

  // A realm file shown as an image: the realm needs the user's credentials,
  // so the bytes come through an authed fetch and show as a blob URL.
  private authedImage = modifier(
    (
      img: HTMLImageElement,
      [url, roomMedia]: [string | undefined, boolean | undefined],
    ) => {
      let objectUrl: string | undefined;
      let gone = false;
      let show = (loaded: string) => {
        if (gone) {
          URL.revokeObjectURL(loaded);
          return;
        }
        objectUrl = loaded;
        img.src = loaded;
      };
      if (url && roomMedia) {
        // a capture lives in the room's media, which loads through Matrix
        this.matrixService
          .loadRoomMedia(url)
          .then(show)
          .catch(() => undefined);
      } else if (url) {
        this.network
          .authedFetch(url)
          .then((response) => (response.ok ? response.blob() : undefined))
          .then((blob) => {
            if (blob) {
              show(URL.createObjectURL(blob));
            }
          })
          .catch(() => undefined);
      }
      return () => {
        gone = true;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    },
  );

  private scrollBottomIntoView = modifier((element: HTMLElement) => {
    // Consume the toggle flag so this re-runs when the code area opens or
    // closes. The code block sizes to its content on its own — the Monaco
    // modifier sets the editor's height and CSS caps it — so there is no inline
    // height to stamp or clear; collapsing the editor lets the block shrink
    // back to its header. When the code opens, bring it into view.
    if (!this.isDisplayingCode) {
      return;
    }
    this.scrollIntoView(element.parentElement as HTMLElement);
  });

  private scrollIntoView(element: HTMLElement) {
    let { top, bottom } = element.getBoundingClientRect();
    let isVerticallyInView = top >= 0 && bottom <= window.innerHeight;

    if (!isVerticallyInView) {
      element.scrollIntoView({ block: 'end' });
    }
  }

  private get headerTitle() {
    if (this.toolResultCard.card) {
      return cardTypeDisplayName(this.toolResultCard.card);
    }
    return '';
  }

  // Most result cards are data a tool hands back to the model, with nothing
  // in them for the user to look at. The chat shows one only when it is a
  // realm card the user may want to open, or when its type has a view of its
  // own and this result has something in it for that view to show; the
  // tool's status row stands for the rest.
  private get shouldDisplayResultCard() {
    let { card, isRealmCard } = this.toolResultCard;
    if (!card) {
      return false;
    }
    if (isRealmCard) {
      return true;
    }
    return hasOwnEmbeddedView(card) && !card[hasNothingToShow];
  }

  // What a finished check found: each error as a line, or one line saying
  // the file is clean. Undefined for any other call, and while it runs.
  private get checkOutcome():
    | { text: string; tone: 'failed' | 'done'; glyph: string }[]
    | undefined {
    if (this.args.messageTool.name !== 'checkCorrectness') {
      return undefined;
    }
    let card = this.toolResultCard.card as
      | { errors?: unknown[]; correct?: boolean }
      | undefined;
    if (!card) {
      return undefined;
    }
    let errors = (Array.isArray(card.errors) ? card.errors : [])
      .filter(Boolean)
      .map((error) =>
        typeof error === 'string'
          ? error
          : ((error as { message?: string }).message ?? String(error)),
      );
    if (errors.length) {
      return errors.map((text) => ({ text, tone: 'failed', glyph: 'failed' }));
    }
    let target = this.args.messageTool.arguments?.attributes?.targetRef;
    let file = typeof target === 'string' ? target.split('/').pop() : 'it';
    return [{ text: `No errors in ${file}`, tone: 'done', glyph: 'done' }];
  }

  private get didFailCorrectnessCheck() {
    if (this.args.messageTool.name !== 'checkCorrectness') {
      return false;
    }
    let card = this.toolResultCard.card as
      | { correct?: boolean; errors?: unknown[] }
      | undefined;
    if (!card) {
      return false;
    }
    let hasErrors =
      Array.isArray(card.errors) && card.errors.filter(Boolean).length > 0;
    let isMarkedIncorrect = card.correct === false;
    return hasErrors || isMarkedIncorrect;
  }

  private get moreOptionsMenuItems() {
    let menuItems =
      this.toolResultCard.card?.[getMenuItems]?.({
        canEdit: false,
        cardCrudFunctions: {},
        menuContext: 'ai-assistant',
        menuContextParams: {
          activeRealmURL: this.activeRealmURL,
          canEditActiveRealm: this.canEditActiveRealm,
        },
        toolContext: this.toolService.toolContext,
      }) ?? [];
    return cardMenuEntries(menuItems);
  }

  private get canEditActiveRealm() {
    let activeRealmURL = this.activeRealmURL;
    return activeRealmURL ? this.realm.canWrite(activeRealmURL) : false;
  }

  private get activeRealmURL() {
    return this.operatorModeStateService.realmURL;
  }

  private get commandResultCardForRendering(): CardDef {
    if (!this.toolResultCard.card) {
      throw new Error('Command result card is not available');
    }
    return this.toolResultCard.card;
  }

  @cached
  private get failedToolState() {
    let toolRequest = this.args.messageTool.toolRequest as ToolRequest;
    if (!toolRequest.id) {
      return undefined;
    }
    return this.matrixService.failedToolState.get(toolRequest.id);
  }

  // Execution failure reported through a room event (as opposed to
  // failedToolState, which is this tab's in-memory state for a failure it
  // produced itself).
  private get failedToolCallState() {
    return this.args.messageTool.status === 'failed' && !this.failedToolState;
  }

  // "Try Anyway" re-runs a host tool; a call ai-bot runs has nothing on the
  // host to retry, so its failure reason shows without the action.
  private get invalidToolCallState() {
    return (
      this.args.messageTool.status === 'invalid' &&
      !!this.args.messageTool.failureReason &&
      !this.args.messageTool.isBotExecuted
    );
  }

  // Why the assistant wants a call held for approval, in its own words: a
  // bot tool that asks for approval takes a `reason` argument.
  private get approvalReason() {
    let reason = this.args.messageTool.toolRequest.arguments?.reason;
    return typeof reason === 'string' && reason.trim() ? reason.trim() : '';
  }

  // A script that deletes or removes something can't be taken back: its
  // gate says so, in Pret UI's destructive form, with no "always" answer.
  private get isDestructive() {
    return this.clickReasons.some((reason) =>
      DESTRUCTIVE_CALL.test(reason.call),
    );
  }

  // Why this call waits for the user's click, shown above the code while
  // this tab offers the click that runs it (Run, Retry or Try Anyway), so the
  // user knows what the click allows. A call another agent sent is run from
  // that agent's tab, not this one.
  @cached
  private get clickReasons() {
    let { messageTool } = this.args;
    if (messageTool.message.agentId !== this.matrixService.agentId) {
      return [];
    }
    let offersClick =
      this.applyButtonState === 'ready' ||
      Boolean(this.failedToolState) ||
      this.failedToolCallState ||
      this.invalidToolCallState;
    return offersClick ? messageTool.clickReasons : [];
  }

  // Until its command is resolved a call can't say how it will run (its
  // action verb, whether it waits for approval), so it shows as preparing, the
  // same as while its request streams in. A call already answered shows its
  // result.
  private get isPreparing() {
    if (this.args.isStreaming) {
      return true;
    }
    let { messageTool } = this.args;
    return (
      messageTool.isResolving &&
      (messageTool.status === 'ready' || messageTool.status === undefined)
    );
  }

  private get commandDescription() {
    return this.args.messageTool.description ?? 'Preparing tool call...';
  }

  // The row's title: what the call does, in the assistant's words.
  // The skill a read call opened, by name: "workspace cardinal rules" for
  // a read of …/boxel-workspace-cardinal-rules/SKILL.md
  private get skillRead(): string | undefined {
    if (!READ_NAME.test(this.baseName) || this.isPreparing) {
      return undefined;
    }
    let attributes = this.args.messageTool.arguments?.attributes ?? {};
    for (let value of [
      ...Object.values(attributes),
      this.args.messageTool.description,
    ]) {
      let dir =
        typeof value === 'string' ? value.match(SKILL_FILE)?.[1] : undefined;
      if (dir) {
        return dir.replace(/^boxel-/, '').replace(/[-_]+/g, ' ');
      }
    }
    return undefined;
  }

  private get rowTitle() {
    if (this.isAskUser && this.askQuestion && !this.isPreparing) {
      // the question itself shows in full in the gate, asked or answered,
      // so the title says what the pick is for, in the assistant's words
      let description = this.args.messageTool.description;
      return description && description.trim() !== this.askQuestion.trim()
        ? plainTitle(description)
        : 'Your pick';
    }
    if (this.args.foldCount && this.args.foldCount > 1) {
      return `${humanizeToolName(this.baseName)} ×${this.args.foldCount}`;
    }
    // a check names the file it checked, as the board does: "Checked
    // relaunch.gts", not the tool's sentence about a path
    if (this.baseName === 'checkCorrectness' && !this.isPreparing) {
      let target = this.args.messageTool.arguments?.attributes?.targetRef;
      let file =
        typeof target === 'string' ? target.split('/').pop() : undefined;
      if (file) {
        return this.didFailCorrectnessCheck
          ? `Checked ${file} · errors`
          : `Checked ${file}`;
      }
    }
    // reading a skill's instructions is housekeeping: the row names the
    // skill in a few words, not its file path
    let skill = this.skillRead;
    if (skill) {
      return this.isRunning
        ? `Reading the ${skill} skill`
        : `Read the ${skill} skill`;
    }
    let description = this.isPreparing
      ? this.commandDescription
      : this.args.messageTool.description;
    if (!description) {
      return this.toolName;
    }
    // once it has done it, the row says what it did, in the past tense and
    // without the why, as the design board titles settled rows
    let state = this.rowState;
    if (state === 'completed' || state === 'delivered') {
      // a change it did not make stays in the words it was asked in
      if (this.claimedChangeNotMade) {
        return plainTitle(description);
      }
      return settledTitle(description, this.verb);
    }
    return plainTitle(description);
  }

  // The apply button's state in the shared agent-work vocabulary, so the row
  // speaks it in words: a call waiting on the reader reads "needs you", a
  // correctness check that found errors reads as invalid.
  private get rowState(): string {
    if (this.isPreparing) {
      return 'streaming';
    }
    // the reader's own stop outranks a later retry: it is what happened to
    // this call
    if (this.isStopped) {
      return 'stopped';
    }
    if (this.scriptAsk) {
      return 'ask';
    }
    if (this.isSuperseded) {
      return 'superseded';
    }
    let runState = this.runRowState;
    if (runState) {
      return runState;
    }
    // a tool that reports its own failure in its result, instead of
    // throwing, still failed: the row must not say done over it
    if (this.resultSaysFailed) {
      return 'failed';
    }
    if (this.isDeclined) {
      return 'canceled';
    }
    let state = this.applyButtonState;
    if (state === 'ready' && this.args.messageTool.awaitsApproval) {
      return 'awaiting-approval';
    }
    switch (state) {
      case 'applied':
        return 'completed';
      case 'applied-with-error':
        return 'invalid';
      case 'preparing':
        return 'streaming';
      default:
        return state;
    }
  }

  // How long a settled call took, from its request to its result. A run
  // says where it stands instead, and a call that waited on the reader has
  // no meaningful time.
  private get duration(): number | undefined {
    if (this.rowState !== 'completed' || this.runCard) {
      return undefined;
    }
    return this.args.messageTool.durationSeconds;
  }

  // The diffs the row draws: a card's own JSON is told by the change table.
  private get shownDiffs(): FileDiff[] {
    let tabled = this.cardChangeTable?.ids;
    return tabled
      ? this.fileDiffs.filter(
          (diff) => !tabled!.has(diff.url.replace(/\.json$/, '')),
        )
      : this.fileDiffs;
  }

  // A script's card writes, one line per card, for ToolChangeTable: the
  // card by its title and what changed on it, old → new. When every card
  // changed the same one field, that field heads the column.
  @cached
  private get cardChangeTable():
    | { rows: ToolChangeRow[]; changeLabel: string; ids: Set<string> }
    | undefined {
    if (this.isRunning) {
      return undefined;
    }
    let card = this.toolResultCard.card as Record<string, any> | undefined;
    if (!card || cardTypeDisplayName(card as CardDef) !== 'Realm Code Result') {
      return undefined;
    }
    let entries: { id: string; changes: CardFieldChange[] }[] = [];
    for (let file of card.files ?? []) {
      let changes = resultCardChanges(file);
      if (changes?.length && typeof file.fileUrl === 'string') {
        entries.push({ id: file.fileUrl.replace(/\.json$/, ''), changes });
      }
    }
    if (!entries.length) {
      return undefined;
    }
    let fields = new Set(
      entries.flatMap((entry) => entry.changes.map((c) => c.field)),
    );
    let oneField = fields.size === 1 ? [...fields][0] : undefined;
    let fromTo = (c: CardFieldChange) => ({
      from: c.before ?? '—',
      to: c.after ?? '—',
    });
    return {
      ids: new Set(entries.map((entry) => entry.id)),
      changeLabel: oneField ? fieldLabel(oneField) : 'Change',
      // one field: its old and new values, the table draws the arrow;
      // several: each said in words on one line
      rows: entries.map((entry) =>
        oneField
          ? { card: this.cardTitleFor(entry.id), ...fromTo(entry.changes[0]!) }
          : {
              card: this.cardTitleFor(entry.id),
              change: entry.changes
                .map((c) => {
                  let { from, to } = fromTo(c);
                  return `${fieldLabel(c.field)}: ${from} to ${to}`;
                })
                .join(' · '),
            },
      ),
    };
  }

  // A card's title as the store holds it, else its file name.
  private cardTitleFor(id: string): string {
    let instance = this.store.peek(id);
    let found = isCardInstance(instance) ? (instance as CardDef) : undefined;
    let slug = id.split('/').pop() ?? id;
    return (
      found?.cardTitle ||
      humanizeToolName(decodeURIComponent(slug).replace(/[-_]/g, ' '))
    );
  }

  // The cards the call wrote, created or changed, as CardPills: each opens
  // on the stack. Read from the result (card files a script wrote, cards a
  // research run created, the card an update tool changed).
  @cached
  private get touchedCards(): CardPillItem[] {
    if (this.isRunning) {
      return [];
    }
    let card = this.toolResultCard.card as Record<string, any> | undefined;
    if (!card) {
      return [];
    }
    let ids = new Set<string>();
    let tabled = this.cardChangeTable?.ids;
    for (let file of card.files ?? []) {
      let id = String(file?.fileUrl ?? '').replace(/\.json$/, '');
      if (
        file?.status !== 'deleted' &&
        CARD_FILE.test(file?.fileUrl ?? '') &&
        !tabled?.has(id)
      ) {
        ids.add(id);
      }
    }
    for (let id of (card.createdCardIds ?? []) as string[]) {
      ids.add(id.replace(/\.json$/, ''));
    }
    if (typeof card.cardId === 'string' && this.fieldChanges?.length) {
      ids.add(card.cardId.replace(/\.json$/, ''));
    }
    return [...ids].map((id) => {
      let instance = this.store.peek(id);
      let found = isCardInstance(instance) ? (instance as CardDef) : undefined;
      let slug = id.split('/').pop() ?? id;
      return {
        id,
        title:
          found?.cardTitle ||
          humanizeToolName(decodeURIComponent(slug).replace(/[-_]/g, ' ')),
        kind: found ? cardTypeDisplayName(found) : undefined,
      };
    });
  }

  // where a touched card's Quick Look comes out of and goes back to
  private pillKey = (id: string) =>
    `ql:${this.args.messageTool.toolRequest.id ?? 'tool'}:${id}`;

  // Each pill publishes its box as a beacon under its card's key, as the
  // reply's cards and the attachments do, so Quick Look grows out of the
  // pill that opened it. The pills are Pret UI's; they come in the cards'
  // order.
  private publishPillBeacons = modifier(
    (element: HTMLElement, [cards]: [CardPillItem[]]) => {
      let pills = [
        ...element.querySelectorAll<HTMLElement>('[data-card-pill]'),
      ];
      let offs = pills.map((pill, index) => {
        let id = cards[index]?.id;
        return id ? registerBeacon(this.pillKey(id), pill) : undefined;
      });
      return () => offs.forEach((off) => off?.());
    },
  );

  // A file or workspace a line names never takes the app's place: a file
  // in a realm opens in Quick Look, a workspace the run made opens as the
  // workspace, and anything else opens in a new window. A modified click is
  // the reader's own choice.
  private openLineLink = (line: ResultLine, event: MouseEvent) => {
    let href = line.href;
    if (
      !href ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (line.hook === 'created-workspace') {
      this.operatorModeStateService.openWorkspace(href);
      return;
    }
    if (!this.realm.url(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    let { pathname } = new URL(href);
    let isCard =
      !LINK_FILE_EXTENSION.test(pathname) || pathname.endsWith('.json');
    let id = isCard ? href.replace(/\.json$/, '') : href;
    this.quickLook.open({
      kind: isCard ? 'card' : 'file',
      id,
      sourceKey: `ql:tool-line:${id}`,
      trigger:
        event.currentTarget instanceof HTMLElement
          ? event.currentTarget
          : undefined,
    });
  };

  // A touched card opens on the stack beside the panel.
  // A card the call changed opens in Quick Look first, as every card the
  // transcript names does; Open in the sheet puts it on the stack.
  private openTouchedCard = (card: CardPillItem) => {
    if (!card.id) {
      return;
    }
    let pressed = document.activeElement;
    this.quickLook.open({
      kind: 'card',
      id: card.id,
      sourceKey: this.pillKey(card.id),
      trigger: pressed instanceof HTMLElement ? pressed : undefined,
    });
  };

  // The call's particulars for ToolMeta, in reading order.
  // the call's particulars, as the showcase's meta line reads them: the
  // call by its own name, the workspace it ran in, what it read, how long
  private get metaItems(): (string | undefined)[] {
    let seconds = this.args.messageTool.durationSeconds;
    return [
      this.baseName,
      this.workspaceName,
      this.readSize,
      typeof seconds === 'number' ? formatToolDuration(seconds) : undefined,
    ];
  }

  // "ctse/riverside" from the realm the call names
  private get workspaceName(): string | undefined {
    let realm = this.args.messageTool.arguments?.attributes?.realm;
    if (typeof realm !== 'string') {
      return undefined;
    }
    try {
      return new URL(realm).pathname.split('/').filter(Boolean).join('/');
    } catch {
      return undefined;
    }
  }

  // "Read 2 files · 13 KB" from the script's record, for the meta line
  private get readSize(): string | undefined {
    let activity = (this.toolResultCard.card as { activity?: string[] })
      ?.activity;
    let line = activity?.find((entry) => READ_SIZE_LINE.test(entry));
    return line?.replace(/^Read /, 'read ');
  }

  private get toolName() {
    return this.args.messageTool.name ?? 'tool';
  }

  private decline = () => {
    this.args.declineCommand?.();
  };

  private allowAlways = () => {
    this.toolService.allowAlways(
      this.args.messageTool.message.roomId,
      this.args.messageTool.clickReasons.map((reason) => reason.call),
    );
    this.args.runCommand();
  };

  private deny = () => {
    this.toolService.denyTool(this.args.messageTool);
  };

  // The gate's answers, most likely first: run the call (once, for a
  // script that names risky calls), allow those calls for the session
  // (never for one that can't be undone), or turn it down
  private get gateActions(): ToolGateAction[] {
    let named = this.clickReasons.length > 0;
    let actions: ToolGateAction[] = [
      {
        id: 'apply',
        label: named ? 'Allow once' : this.args.messageTool.actionVerb,
        kind: 'primary',
        onAct: () => this.args.runCommand(),
      },
    ];
    if (named) {
      if (!this.isDestructive) {
        actions.push({
          id: 'always',
          label: 'Always for this session',
          always: true,
          onAct: this.allowAlways,
        });
      }
      actions.push({
        id: 'deny',
        label: 'Deny',
        kind: 'quiet',
        onAct: this.deny,
      });
    }
    if (this.showDenyAsDecline) {
      actions.push({ id: 'deny', label: 'Decline', onAct: this.deny });
    }
    if (this.showDecline) {
      actions.push({ id: 'decline', label: 'Decline', onAct: this.decline });
    }
    return actions;
  }

  // The failure line and its Details: not once a later call retried it
  private get showsFailure() {
    return Boolean(this.failureMessage) && !this.isSuperseded;
  }

  // The reader declined a call ai-bot held for approval: the call didn't
  // run, which is a decision, not an error, so the row reads declined.
  private get isDeclined() {
    return this.args.messageTool.approvalAnswer?.verdict === 'decline';
  }

  // The reader denied this call at its gate.
  private get isDenied() {
    return Boolean(
      this.args.messageTool.failureReason?.startsWith(DENIED_BY_USER),
    );
  }

  private get showDenyAsDecline() {
    return (
      this.needsClick &&
      !this.args.messageTool.awaitsApproval &&
      !this.clickReasons.length &&
      this.applyButtonState === 'ready'
    );
  }

  private get showDecline() {
    return (
      this.args.messageTool.awaitsApproval &&
      this.args.declineCommand &&
      this.applyButtonState === 'ready'
    );
  }

  // A tool that records its failure in its result instead of throwing (the
  // Realm Runner POC's script tool sets `ok: false`).
  private get resultSaysFailed() {
    let card = this.toolResultCard.card as { ok?: boolean } | undefined;
    return Boolean(
      card &&
      cardTypeDisplayName(card as CardDef) === 'Realm Script Result' &&
      card.ok === false,
    );
  }

  private get isSuperseded() {
    return Boolean(this.args.isSuperseded) && this.hasFailedState;
  }

  private get hasFailedState() {
    return !!(
      this.failedToolState ||
      this.failedToolCallState ||
      this.didFailCorrectnessCheck ||
      this.resultSaysFailed
    );
  }

  // ── v3: one call is one item ───────────────────────────────────────────

  // The tool's name without a skill's runtime hash or a `Tool` suffix:
  // `ResearchTool_3f9a1c` is `Research`.
  private get baseName() {
    return (
      this.toolName
        // a skill's tool names carry a short hash (`SetViewTool_be46`)
        .replace(/_[0-9a-f]{4,}$/i, '')
        .replace(/Tool$/, '')
        .trim()
    );
  }

  // How much of the transcript the call claims. Set by what the tool is,
  // never by the message: a run works in the background, a script is a
  // Realm Runner program, an action writes, a step reads or moves the UI.
  private get density(): ToolDensity {
    let name = this.baseName.toLowerCase();
    if (this.isAskUser) {
      return 'action';
    }
    if (this.runCard || /research|background|(^|[-_ ])run$/.test(name)) {
      return 'run';
    }
    if (/realm.?code|realm.?script/.test(name)) {
      return 'script';
    }
    if (/set.?view|switch|open|show|preview|view/.test(name)) {
      return 'step';
    }
    if (
      /patch|update|set|create|write|copy|delete|apply|replace|batch|save|upload|install|remix|send|publish|generate/.test(
        name,
      )
    ) {
      return 'action';
    }
    return 'step';
  }

  // Steps stay plain rows; the rest are boxed. An answered question keeps
  // its box, as the showcase draws it: the pick in the title, the question
  // and its answer in the gate.
  private get isFramed() {
    return this.density !== 'step';
  }

  // the reader's pick, beside the title once a question is answered
  private get rowChoice(): string | undefined {
    if (this.isAskUser) {
      return this.rowState === 'completed' ? this.answeredLabel : undefined;
    }
    // a script that asked: the reader's last pick, which the row keeps as
    // its own history, folded or not
    let entries: string[] =
      (this.toolResultCard.card as { activity?: string[] } | undefined)
        ?.activity ??
      this.liveProgress?.lines ??
      [];
    let picks = entries
      .map((entry) => askedLine(entry))
      .filter((asked) => asked !== undefined);
    return picks[picks.length - 1]?.answer;
  }

  // The row's state in words, where its duration would go.
  // The reader's decisions are the transcript's history: a row they ran or
  // turned down says so where its time would go, and keeps saying it once
  // the row folds.
  private get rowStatus(): string | undefined {
    if (this.isDenied) {
      return 'you declined';
    }
    if (this.isDeclined) {
      let name = this.args.messageTool.approvalAnswer?.name;
      return name ? `declined · ${name}` : 'declined';
    }
    if (this.rowState === 'paused') {
      return 'paused';
    }
    if (this.isAskUser && this.rowState === 'completed') {
      return 'done';
    }
    if (this.claimedChangeNotMade) {
      return 'no changes';
    }
    if (this.ranOnReadersClick) {
      return 'you ran it';
    }
    return undefined;
  }

  // a call that ran because the reader clicked, on whichever of their
  // clients: one that would not have run on its own in its message's mode
  private get ranOnReadersClick(): boolean {
    let tool = this.args.messageTool;
    if (
      this.rowState !== 'completed' ||
      this.isAskUser ||
      tool.isBotExecuted ||
      tool.approvalAnswer
    ) {
      return false;
    }
    let mode = this.args.roomResource.getActiveLLMModeForMessage(tool.eventId);
    return (
      !isAutoExecutableTool(tool, mode, true) || tool.clickReasons.length > 0
    );
  }

  // A script whose title says it changes something ("Remove Nomad Coffee
  // from favorites") that finished without writing anything: often the
  // look before the edit. The row must not read as the change done.
  private get claimedChangeNotMade(): boolean {
    if (this.density !== 'script' || this.rowState !== 'completed') {
      return false;
    }
    let files = (this.toolResultCard.card as { files?: unknown[] } | undefined)
      ?.files;
    if (files?.length || this.fieldChanges?.length || this.tabEdits?.length) {
      return false;
    }
    return CHANGE_VERB.test(this.args.messageTool.description ?? '');
  }

  // The verb that leads the row: the first word of the tool's name, so a
  // column of rows scans by what the assistant did.
  private get verb() {
    // The verb is the row's only label, so a script says it is one: an
    // edit when it wrote files, a script otherwise.
    if (this.density === 'script') {
      let files = (
        this.toolResultCard.card as { files?: unknown[] } | undefined
      )?.files;
      return files?.length ? 'Edit' : 'Script';
    }
    if (this.isAskUser) {
      return 'Ask';
    }
    // a call that changes what the reader sees says so, whatever its tool
    // is called ("Set view", "Show card"): the title says what it showed
    if (UI_MOVE.test(this.baseName)) {
      return 'View';
    }
    let words = humanizeToolName(this.baseName).split(' ');
    return words[0] ?? '';
  }

  // What the running call has reported so far: its step and its lines. Only
  // this tab sees them, because only this tab runs the call; the result
  // carries the finished record.
  private get liveProgress() {
    let id = this.args.messageTool.toolRequest.id;
    return id ? this.toolService.toolProgress.get(id) : undefined;
  }

  private get isRunning() {
    return this.applyButtonState === 'applying';
  }

  private get progress(): ToolProgress | undefined {
    let run = this.run;
    if (run && run.status === 'running' && run.progressTotal) {
      return {
        step: Math.max(1, run.progressCurrent ?? 1),
        of: run.progressTotal,
        label: stepless(run.currentActivity ?? undefined),
      };
    }
    let live = this.isRunning ? this.liveProgress?.progress : undefined;
    return live
      ? { step: live.step, of: live.of, label: stepless(live.label) }
      : undefined;
  }

  // The steps a running script named with realm.plan, as a checklist:
  // before the current step done, the current one under way (with its
  // count inside the step), the rest still to come.
  private get planSteps(): ToolPlanStep[] | undefined {
    let progress = this.isRunning ? this.liveProgress?.progress : undefined;
    let plan = progress?.plan;
    if (!progress || !plan?.length) {
      return undefined;
    }
    let current = progress.step;
    return plan.map((label, i) => {
      let step = i + 1;
      if (step < current) {
        return { label, state: 'done' as const };
      }
      if (step === current) {
        return {
          label,
          state: 'current' as const,
          note:
            progress!.count !== undefined && progress!.countOf !== undefined
              ? `${progress!.count} of ${progress!.countOf}`
              : undefined,
        };
      }
      return { label, state: 'next' as const };
    });
  }

  // A running script that named no plan still reports its steps ("Step 2 of
  // 5 · Searching Brooklyn"). Those become the checklist: a step before the
  // latest is done, the latest is under way, and what each step did nests
  // under it, small, instead of each line taking a mark of its own.
  private get reportedSteps(): ToolPlanStep[] | undefined {
    if (this.planSteps) {
      return undefined;
    }
    // a run cut short keeps its steps, settled: what it finished checked,
    // the step it was on struck
    let cutShort =
      !this.isRunning && !this.toolResultCard.card && !!this.failureMessage;
    if (!this.isRunning && !cutShort) {
      return undefined;
    }
    if (this.isSuperseded) {
      return undefined;
    }
    let steps: { label: string; details: string[] }[] = [];
    // this tab's own record, or, after a reload or on another reader's
    // screen, the steps the run's report lists
    let lines = this.liveProgress?.lines?.length
      ? this.liveProgress.lines
      : cutShort
        ? reportedCalls(this.failureMessage)
        : [];
    for (let text of lines) {
      if (PLAN_LINE.test(text) || READ_SIZE_LINE.test(text)) {
        continue;
      }
      if (cutShort && STOP_NOTE.test(text)) {
        continue;
      }
      let step = text.match(STEP_LINE);
      if (step) {
        let label = stepless(text) ?? `Step ${step[1]}`;
        if (steps[steps.length - 1]?.label !== label) {
          steps.push({ label, details: [] });
        }
        continue;
      }
      steps[steps.length - 1]?.details.push(briefDetail(text));
    }
    if (!steps.length) {
      return undefined;
    }
    let progress = this.liveProgress?.progress;
    return steps.map(({ label, details }, i) => {
      let current = i === steps.length - 1;
      return {
        label,
        details: cutShort
          ? details.map((detail) => detail.replace(STOPPED_CALL, ' · stopped'))
          : details,
        state: !current
          ? ('done' as const)
          : cutShort
            ? ('skipped' as const)
            : ('current' as const),
        note:
          current &&
          !cutShort &&
          progress?.count !== undefined &&
          progress?.countOf !== undefined
            ? `${progress.count} of ${progress.countOf}`
            : undefined,
      };
    });
  }

  private get liveLines(): {
    glyph: string;
    tone: LineTone;
    text: string;
    answer?: string;
  }[] {
    // a failure the assistant retried folds to its header ("retried
    // below"): its steps and its error are history the retry replaced
    if (this.isSuperseded) {
      return [];
    }
    // a call that ended without a result keeps what it reported on the way,
    // settled: the reader still sees which page refused before the stop
    if (!this.isRunning && !this.toolResultCard.card && this.failureMessage) {
      // its plan line is the script's own bookkeeping, not a step it took;
      // with its steps shown, a line says only what came before them, and
      // the stop itself
      let entries = this.liveProgress?.lines ?? [];
      if (this.reportedSteps) {
        let first = entries.findIndex((text) => STEP_LINE.test(text));
        entries = [
          ...entries.slice(0, first),
          ...entries.slice(first).filter((text) => STOP_NOTE.test(text)),
        ];
      }
      return entries
        .filter((entry) => !PLAN_LINE.test(entry))
        .map((entry) => {
          let text = briefActivity(stepless(entry) ?? entry);
          // the call a stop cut short did not fail: it was stopped
          if (this.isStopped && /the run has ended/i.test(text)) {
            return {
              text: text.replace(/\s*failed:.*$/i, ' · stopped'),
              glyph: 'stop',
              tone: 'muted' as LineTone,
            };
          }
          let asked = askedLine(text);
          if (asked) {
            return {
              text: asked.question,
              answer: asked.answer,
              glyph: 'done',
              tone: 'done' as LineTone,
            };
          }
          let mark = activityMark(text);
          return { text, glyph: mark.glyph, tone: mark.tone };
        });
    }
    if (!this.isRunning) {
      return [];
    }
    // with a plan on screen, its checklist says the steps: the step lines
    // the run reported would only repeat it
    let lines = this.liveProgress?.lines ?? [];
    if (this.planSteps) {
      lines = lines.filter((text) => !PLAN_OR_STEP_LINE.test(text));
    } else if (this.reportedSteps) {
      // the steps say everything from the first one on; what the script
      // said before it stays a line of its own
      let first = lines.findIndex((text) => STEP_LINE.test(text));
      lines = lines.slice(0, first).filter((text) => !PLAN_LINE.test(text));
    }
    return lines.map((text) => {
      let mark = activityMark(text);
      return {
        text,
        glyph: mark.glyph === 'note' ? 'current' : mark.glyph,
        tone:
          mark.tone === 'muted' && mark.glyph === 'note' ? 'live' : mark.tone,
      };
    });
  }

  // The closing line of a call: what a settled write changed. A running call needs no line to say it
  // can be stopped: the composer's Stop says so.
  private get receipt(): string | undefined {
    if (this.isStopping) {
      return 'Stopping after the current call…';
    }
    if (this.rowState === 'stopped' || this.rowState === 'failed') {
      let saved = this.tabEdits?.length;
      return saved
        ? `${saved} file${saved === 1 ? '' : 's'} changed before it ended`
        : undefined;
    }
    if (this.rowState !== 'completed') {
      return undefined;
    }
    let changes = this.fieldChanges;
    if (changes?.length) {
      return `${changes.length} field${changes.length === 1 ? '' : 's'} changed`;
    }
    let files = this.resultFiles;
    if (files.length) {
      // written and deleted are counted apart: a delete wrote nothing
      let written = files.filter((file) => file.status !== 'deleted').length;
      let deleted = files.length - written;
      let counts = [
        written ? `${written} file${written === 1 ? '' : 's'} written` : '',
        deleted ? `${deleted} deleted` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      // the run's id is for the curious: it sits in the meta line
      return counts;
    }
    return undefined;
  }

  // A Realm Runner research run hands back its run card. It is the run's
  // own record, so it reads as the row's progress and lines, never as a
  // finished card.
  private get runCard() {
    let card = this.toolResultCard.card as
      | (CardDef & {
          status?: string;
          progressCurrent?: number;
          progressTotal?: number;
          currentActivity?: string;
        })
      | undefined;
    if (!card) {
      return undefined;
    }
    return cardTypeDisplayName(card) === 'Assistant Realm Run'
      ? card
      : undefined;
  }

  // A Realm Runner tool's receipt of what it did: shown unwrapped, as a
  // tool's own record, never as a card the call made for the reader.
  private get isIntermediateResult() {
    let card = this.toolResultCard.card;
    return card
      ? INTERMEDIATE_REALM_CARDS.has(cardTypeDisplayName(card))
      : false;
  }

  // A realm card the call made or changed is the one thing the call leaves
  // the reader; it renders as a card. Anything else a tool hands back is
  // data for the model and renders unwrapped, in the panel's own colors.
  private get showsFinalCard() {
    return (
      this.shouldDisplayResultCard &&
      this.toolResultCard.isRealmCard &&
      !this.isIntermediateResult
    );
  }

  // A tool's own record of what it did, as rail lines in the panel's
  // colors: read from the result's fields, so it does not depend on a
  // result type's embedded template (or on which base the realm server runs).
  @cached
  // A long run of finished steps shows its first few and folds the rest
  // behind one "N more" line; a line that failed or needs the reader never
  // folds away.
  private get shownResultLines(): ResultLine[] {
    let lines = this.resultLines ?? [];
    if (this.showAllLines || lines.length <= FOLD_AFTER + 2) {
      return lines;
    }
    let kept = lines.slice(0, FOLD_AFTER);
    let rest = lines.slice(FOLD_AFTER);
    return [...kept, ...rest.filter((line) => line.tone === 'failed')];
  }

  private get foldedLineCount(): number {
    let lines = this.resultLines ?? [];
    return lines.length - this.shownResultLines.length;
  }

  private showFoldedLines = () => {
    this.showAllLines = true;
  };

  private get resultLines(): ResultLine[] | undefined {
    let card = this.toolResultCard.card as Record<string, any> | undefined;
    if (!card) {
      return undefined;
    }
    let type = cardTypeDisplayName(card as CardDef);
    let lines: ResultLine[] = [];
    if (type === 'Realm Code Result') {
      // a file shown as a diff is named by the diff's own header
      let diffed = new Set(this.fileDiffs.map((diff) => diff.url));
      // the file the run opened is named once, as opened
      let shown =
        typeof card.shownCard === 'string'
          ? card.shownCard.replace(/\.json$/, '')
          : undefined;
      let shownIsFile = (card.files ?? []).some(
        (file: { fileUrl?: string }) =>
          file.fileUrl?.replace(/\.json$/, '') === shown,
      );
      for (let file of card.files ?? []) {
        if (diffed.has(file.fileUrl)) {
          continue;
        }
        let deleted = file.status === 'deleted';
        // a card the run wrote is named by its pill, under the lines
        if (!deleted && CARD_FILE.test(file.fileUrl ?? '')) {
          continue;
        }
        lines.push({
          glyph: deleted ? 'skipped' : 'done',
          tone: deleted ? 'muted' : 'done',
          struck: deleted,
          thumb:
            !deleted && IMAGE_FILE.test(file.fileUrl ?? '')
              ? file.fileUrl
              : undefined,
          text: shortPath(file.fileUrl),
          // ✓ already says it was saved; the line names only an exception
          sub:
            shownIsFile && file.fileUrl?.replace(/\.json$/, '') === shown
              ? 'opened'
              : file.status === 'saved'
                ? undefined
                : file.status,
          mono: true,
          href: file.fileUrl,
          hook: 'file',
          hookValue: file.fileUrl,
        });
      }
      // a workspace the run made or removed changes what the reader has:
      // the row says so, by its address
      for (let url of card.createdWorkspaces ?? []) {
        lines.push({
          glyph: 'add',
          tone: 'done',
          text: `Created ${url}`,
          mono: true,
          href: url,
          hook: 'created-workspace',
          hookValue: url,
        });
      }
      for (let url of card.deletedWorkspaces ?? []) {
        lines.push({
          glyph: 'skipped',
          tone: 'muted',
          text: `Deleted ${url}`,
          mono: true,
          struck: true,
          hook: 'deleted-workspace',
          hookValue: url,
        });
      }
      // what the run looked at with realm.capture, small under its line
      for (let capture of card.captures ?? []) {
        if (!capture?.url) {
          continue;
        }
        lines.push({
          glyph: 'done',
          tone: 'done',
          text: capture.name ? `Captured ${capture.name}` : 'Captured the view',
          thumb: capture.url,
          roomMedia: true,
          hook: 'capture',
        });
      }
      for (let ui of card.uiActions ?? []) {
        lines.push({
          glyph: 'action',
          text: uiActionText(ui.action, ui.target),
          sub:
            [ui.status === 'done' ? undefined : ui.status, ui.detail]
              .filter(Boolean)
              .join(' · ') || undefined,
          hook: 'ui-action',
          hookValue: ui.action,
        });
      }
      // what the run changed in the room is said in the thread, below the
      // row (roomChangeLines), not inside it
      // The result's own record of the run's steps. Until the realm server's
      // base has the field, the tab that ran the call keeps the steps it
      // reported live, and the settled row shows those.
      // A long run of written files reads as one line; the names go under it.
      let fileCount = lines.filter((line) => line.hook === 'file').length;
      if (fileCount > 5) {
        let files = lines.splice(0, fileCount);
        // a deleted file is counted as deleted, never as saved
        let deleted = files.filter((line) => line.struck).length;
        let saved = files.length - deleted;
        let fileWord = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
        lines.unshift({
          glyph: saved ? 'done' : 'skipped',
          tone: saved ? 'done' : 'muted',
          text: [
            saved ? `Saved ${fileWord(saved)}` : undefined,
            deleted
              ? `${saved ? 'deleted' : 'Deleted'} ${fileWord(deleted)}`
              : undefined,
          ]
            .filter(Boolean)
            .join(', '),
          sub: `${files
            .slice(0, 3)
            .map((line) => line.text.split('/').pop())
            .join(', ')} and ${files.length - 3} more`,
          hook: 'files',
        });
      }
      let activity: string[] = card.activity?.length
        ? [...card.activity]
        : (this.liveProgress?.lines ?? []);
      for (let entry of activity) {
        // the plan is drawn as the steps it ticked; the read tally goes to
        // the row's meta line
        if (PLAN_LINE.test(entry) || READ_SIZE_LINE.test(entry)) {
          continue;
        }
        let text = briefActivity(stepless(entry) ?? entry);
        let asked = askedLine(text);
        if (asked) {
          lines.push({
            glyph: 'done',
            tone: 'done',
            text: asked.question,
            answer: asked.answer,
          });
          continue;
        }
        let mark = activityMark(text);
        lines.push({
          ...(mark.glyph === 'note' && text !== entry
            ? { glyph: 'done', tone: 'done' as LineTone }
            : mark),
          text,
        });
      }
      if (card.shownCard && !shownIsFile) {
        lines.push({
          glyph: 'open',
          text: `Opened ${shortPath(card.shownCard)}`,
          href: card.shownCard,
          hook: 'shown-card',
        });
      }
      if (card.showError) {
        lines.push({
          glyph: 'failed',
          tone: 'failed',
          text: card.showError,
          hook: 'show-error',
        });
      }
      return lines;
    }
    if (type === 'Realm Script Result') {
      // the Realm Runner POC's record: `ok`, and the error when it failed
      let failed = this.resultSaysFailed;
      lines.push({
        glyph: failed ? 'failed' : 'done',
        tone: failed ? 'failed' : 'done',
        text: failed ? 'The script failed' : 'The script ran',
      });
      let detail = String(card.error ?? '')
        .split('\n')
        .find((line) => line.trim());
      if (detail) {
        lines.push({ glyph: 'note', tone: 'muted', text: detail.trim() });
      }
      return lines;
    }
    // a delivered run says so in one line (its runLines); the answer
    // follows in the transcript
    // and a run still under way (or paused) says where it is in its
    // progress line; its current step is no finished line
    if (
      type === 'Assistant Realm Run' &&
      (this.runRowState === 'delivered' || this.run?.status === 'running')
    ) {
      return [];
    }
    if (type === 'Assistant Realm Result' || type === 'Assistant Realm Run') {
      let summary =
        (card.resultSummary as string | undefined) ??
        (card.currentActivity as string | undefined);
      if (summary) {
        lines.push({
          glyph: 'done',
          tone: 'done',
          // a realm URL reads as its path inside the realm
          text: briefActivity(summary.split('\n')[0]!)
            .replace(/https?:\/\/[^\s)]+/g, (url) => shortPath(url))
            .slice(0, 200),
        });
      }
      let urls = (card.resultUrls ?? []) as string[];
      if (urls.length) {
        lines.push({
          glyph: 'note',
          tone: 'muted',
          text: `${urls.length} ${urls.length === 1 ? 'result' : 'results'}`,
        });
      }
      let created = (card.createdCardIds ?? []) as string[];
      if (created.length) {
        lines.push({
          glyph: 'add',
          tone: 'done',
          text: `Created ${created.length} ${created.length === 1 ? 'card' : 'cards'}`,
        });
      }
      return lines;
    }
    return undefined;
  }

  // A card update's result names the paths it touched. The reader wants the
  // values: each field's label and what it is now, read from the card, and
  // what it was when the tool reports it.
  @cached
  private get fieldChanges(): FieldChange[] | undefined {
    let result = this.toolResultCard.card as
      | {
          paths?: string[];
          cardId?: string;
          changes?: { path?: string; before?: unknown; after?: unknown }[];
        }
      | undefined;
    if (!result || !Array.isArray(result.paths) || !result.paths.length) {
      return undefined;
    }
    let reported = new Map(
      (Array.isArray(result.changes) ? result.changes : [])
        .filter((c) => typeof c?.path === 'string')
        .map((c) => [c.path!.replace(/^\./, ''), c]),
    );
    let target = result.cardId ? this.store.peek(result.cardId) : undefined;
    return result.paths.map((raw) => {
      let path = raw.replace(/^\./, '');
      let change = reported.get(path);
      let now =
        change && 'after' in change
          ? change.after
          : target && isCardInstance(target)
            ? valueAtPath(target, path)
            : undefined;
      return {
        label: fieldLabel(path),
        // an empty field had no value to strike through
        from:
          change && displayValue(change.before) !== '—'
            ? displayValue(change.before)
            : undefined,
        to: displayValue(now),
      };
    });
  }

  // What a call waiting for approval would change: its `fields` (an object,
  // or JSON of one), each with the card's value now. Undefined for a call
  // that names no fields.
  private get proposedChanges(): FieldChange[] | undefined {
    let attributes = this.args.messageTool.arguments?.attributes as
      | { fields?: unknown; cardId?: unknown }
      | undefined;
    let fields = attributes?.fields;
    if (typeof fields === 'string') {
      try {
        fields = JSON.parse(fields);
      } catch {
        return undefined;
      }
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return undefined;
    }
    let target =
      typeof attributes?.cardId === 'string'
        ? this.store.peek(attributes.cardId)
        : undefined;
    let entries = Object.entries(fields as Record<string, unknown>);
    if (!entries.length) {
      return undefined;
    }
    return entries.map(([path, value]) => {
      let before =
        target && isCardInstance(target)
          ? displayValue(valueAtPath(target, path))
          : '—';
      return {
        label: fieldLabel(path),
        from: before !== '—' ? before : undefined,
        to: displayValue(value),
      };
    });
  }

  // ── what a write changed, as diffs, and putting it back ───────────────

  private get toolCallId(): string | undefined {
    return this.args.messageTool.toolRequest.id ?? undefined;
  }

  // The files this call changed, as the tab that ran it recorded them: full
  // texts before and after. Every other tab, and this one after a reload,
  // reads the result's compact diffs instead.
  private get tabEdits() {
    let id = this.toolCallId;
    return id ? this.toolService.toolEdits.get(id) : undefined;
  }

  private get resultFiles(): {
    fileUrl: string;
    status?: string;
    diff?: string;
  }[] {
    let card = this.toolResultCard.card as
      | {
          files?: {
            fileUrl?: string;
            status?: string;
            diff?: string;
            detail?: string;
          }[];
        }
      | undefined;
    return (card?.files ?? []).flatMap((file) =>
      typeof file?.fileUrl === 'string'
        ? [
            {
              fileUrl: file.fileUrl,
              status: file.status,
              diff: resultDiff(file),
            },
          ]
        : [],
    );
  }

  // Each source file the call wrote, as an inline diff under its rows.
  @cached
  private get fileDiffs(): FileDiff[] {
    if (this.isRunning) {
      return [];
    }
    let tab = this.tabEdits;
    if (tab) {
      return tab
        .filter(
          (edit) =>
            isDiffable(edit.url) &&
            !edit.binarySha256 &&
            !edit.irreversible &&
            !edit.copiedFrom,
        )
        .map((edit) => ({
          url: edit.url,
          path: shortPath(edit.url),
          before: edit.before,
          after: edit.after,
        }));
    }
    return this.resultFiles.flatMap((file) => {
      if (!file.diff || !isDiffable(file.fileUrl)) {
        return [];
      }
      let { lines, complete } = parseCompactDiff(file.diff);
      // a whole diff that only adds, with no line kept, is a new file
      let status: FileDiff['status'] =
        file.status === 'deleted'
          ? 'deleted'
          : complete && lines.every((line) => line.op === 'add')
            ? 'added'
            : 'modified';
      return [
        { url: file.fileUrl, path: shortPath(file.fileUrl), lines, status },
      ];
    });
  }

  // ── Stop ───────────────────────────────────────────────────────────────

  // A running Realm Runner call in the tab that runs it can be stopped.
  // a question waiting on the reader's pick has no Stop of its own: its
  // gate is the decision, and the cap stops the turn
  private get canStop() {
    let id = this.toolCallId;
    return Boolean(
      id &&
      this.isRunning &&
      !this.scriptAsk &&
      !this.isAskingUser &&
      this.toolService.canStopTool(id),
    );
  }

  private get isStopping() {
    let id = this.toolCallId;
    return Boolean(
      id && this.isRunning && this.toolService.stoppedToolRequestIds.has(id),
    );
  }

  private stopCall = () => {
    let id = this.toolCallId;
    if (id) {
      this.toolService.stopTool(id);
    }
  };

  // The reader stopped this call: it reads gray, as stopped, never as a
  // failure waiting on them.
  private get isStopped() {
    return Boolean(this.failureMessage?.startsWith(STOPPED_BY_USER));
  }

  // ── background runs: progress, reconnecting, delivery ─────────────────

  // The run card's state as this tab last fetched it after a reload, until
  // the store's own copy catches up.
  @tracked private fetchedRun: RunState | undefined;
  @tracked private reconnectSettled = false;

  // The run's state: the store's copy, unless a fetch after a reload saw it
  // further along.
  private get run(): RunState | undefined {
    let card = this.runCard;
    if (!card) {
      return undefined;
    }
    let fetched = this.fetchedRun;
    let terminal = (status?: string) =>
      status === 'completed' || status === 'failed' || status === 'canceled';
    if (fetched && !terminal(card.status) && terminal(fetched.status)) {
      return fetched;
    }
    if (
      fetched &&
      card.status === 'running' &&
      (fetched.progressCurrent ?? 0) > (card.progressCurrent ?? 0)
    ) {
      return fetched;
    }
    return card;
  }

  // This tab started the run: it is the page doing the work.
  private get launchedHere() {
    let id = this.toolCallId;
    return Boolean(
      id &&
      (this.toolService.executedToolRequestIds.has(id) ||
        this.toolService.currentlyExecutingToolRequestIds.has(id)),
    );
  }

  // A running run in a tab that did not start it (this page was reloaded,
  // or another tab started it) reads as reconnecting until the run's
  // current state has been fetched.
  private get needsReconnect() {
    return (
      this.runCard?.status === 'running' &&
      !this.launchedHere &&
      !this.reconnectSettled
    );
  }

  private reconnect = (needed: unknown) => {
    let id = this.runCard?.id;
    if (!needed || !id) {
      return;
    }
    // past any cache: the run's state as the realm holds it now
    this.network
      .authedFetch(`${id}.json?_runState=${Date.now()}`, {
        headers: { Accept: 'application/vnd.card+json' },
        cache: 'no-store',
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`run state fetch answered ${response.status}`);
        }
        let doc = (await response.json()) as {
          data?: { attributes?: RunState };
        };
        if (!this.isDestroying && !this.isDestroyed) {
          this.fetchedRun = doc.data?.attributes;
          this.reconnectSettled = true;
        }
      })
      .catch((e) => {
        // the row goes on from the store's copy, which updates as the run
        // saves, rather than saying it is reconnecting for good
        console.warn(`could not fetch the state of run ${id}`, e);
        if (!this.isDestroying && !this.isDestroyed) {
          this.reconnectSettled = true;
        }
      });
  };

  private get isRunDelivered() {
    let id = this.runCard?.id;
    if (!id) {
      return false;
    }
    let deliveryId = runDeliveryId(id);
    return this.args.roomResource.messages.some(
      (message) => message.clientGeneratedId === deliveryId,
    );
  }

  // The row's state while it stands for a background run.
  private get runRowState(): string | undefined {
    let run = this.run;
    if (!run || this.applyButtonState !== 'applied') {
      return undefined;
    }
    if (this.needsReconnect) {
      return 'reconnecting';
    }
    switch (run.status) {
      case 'running':
        if (this.isRunPaused) {
          return 'paused';
        }
        return run.progressCurrent ? 'running' : 'starting';
      case 'completed':
        return this.isRunDelivered ? 'delivered' : 'completed';
      case 'failed':
        return 'failed';
      case 'canceled':
        return 'canceled';
      default:
        return undefined;
    }
  }

  // A run this page did not start, whose saved state has not moved for a
  // few minutes, has no page working on it: it is paused, not running.
  private get isRunPaused() {
    let due = this.pausedAt;
    return due !== undefined && this.now >= due;
  }

  // When a run this page did not start counts as paused, if its saved
  // state does not move before then.
  private get pausedAt() {
    if (
      this.launchedHere ||
      !this.reconnectSettled ||
      this.run?.status !== 'running'
    ) {
      return undefined;
    }
    let activity = (this.runCard as { activity?: { at?: unknown }[] })
      ?.activity;
    let last = Math.max(
      0,
      ...(activity ?? []).map(
        (entry) => new Date(entry?.at as string).getTime() || 0,
      ),
    );
    return last > 0 ? last + RUN_IDLE_MS : undefined;
  }

  // The clock isRunPaused reads, moved on when a run is due to pause.
  @tracked private now = Date.now();
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;

  // runs inside render, so the clock moves only from the timer
  private watchPause = (due: unknown) => {
    clearTimeout(this.pauseTimer);
    if (typeof due !== 'number') {
      return;
    }
    this.pauseTimer = setTimeout(
      () => {
        if (!this.isDestroying && !this.isDestroyed) {
          this.now = Date.now();
        }
      },
      Math.max(0, due - Date.now()),
    );
  };

  // What the run's row says beyond its progress: that the page reloaded,
  // that the run's result was posted to the room.
  private get runLines(): ResultLine[] {
    let state = this.runRowState;
    if (state === 'reconnecting') {
      return [
        {
          glyph: '',
          tone: 'muted',
          text: 'Page reloaded · fetching the run state',
        },
      ];
    }
    if (state === 'paused') {
      return [
        {
          glyph: '',
          tone: 'muted',
          text: 'Paused · the page that ran it was reloaded',
        },
      ];
    }
    if (state === 'running' && !this.launchedHere && this.reconnectSettled) {
      // the run's own record says whether a page took it over; until then
      // the row says where it stands, never that it resumed
      let activity = (this.runCard as { activity?: { kind?: string }[] })
        ?.activity;
      let resumed = activity?.some((entry) => entry?.kind === 'host-worker');
      return [
        resumed
          ? {
              glyph: '↺',
              tone: 'muted',
              text: 'Picked up by this page after the reload',
            }
          : {
              glyph: '',
              tone: 'muted',
              text: 'Run state fetched · the page that ran it was reloaded',
            },
      ];
    }
    if (state === 'delivered') {
      if (this.deliveredResult) {
        // the result card under the row says what it found
        return [];
      }
      let count = (
        (this.runCard as { resultUrls?: unknown[] })?.resultUrls ?? []
      ).length;
      return [
        {
          glyph: 'done',
          tone: 'done',
          text: count
            ? `Finished · ${count} ${count === 1 ? 'source' : 'sources'} · result posted here`
            : 'Finished · result posted here',
        },
      ];
    }
    return [];
  }

  // A delivered run settles into what it found, as Pret UI's ResultCard: the
  // summary's first sentence as the title, then the next one and how many
  // sources it read. The full answer still follows in the transcript.
  // What the run's searches found, best first (realm.entries.search)
  private get foundEntries() {
    let id = this.args.messageTool.toolRequest.id;
    return id ? this.toolService.toolFound.get(id) : undefined;
  }

  private get deliveredResult():
    | { title: string; lines: string[] }
    | undefined {
    if (this.runRowState !== 'delivered') {
      return undefined;
    }
    let card = this.runCard as
      | { resultSummary?: string; resultUrls?: unknown[] }
      | undefined;
    // the summary's prose only: a markdown table is the posted answer's to
    // draw, so the row says how big it is instead of printing its pipes
    let markdown = card?.resultSummary ?? '';
    let tableRows = markdown
      .split('\n')
      .filter((line) => TABLE_ROW.test(line) && !TABLE_RULE.test(line));
    let prose = markdown
      .split('\n')
      .filter((line) => !TABLE_ROW.test(line))
      .join('\n');
    let summary = plainText(prose);
    if (!summary) {
      return undefined;
    }
    let sentences = summary.split(SENTENCE_END).filter(Boolean);
    let clip = (text: string) =>
      text.length > 160 ? text.slice(0, 157).trimEnd() + '…' : text;
    let count = (card?.resultUrls ?? []).length;
    // a table's first row is its header
    let rows = Math.max(0, tableRows.length - 1);
    let lines = [
      ...(sentences[1] ? [clip(sentences[1])] : []),
      ...(rows ? [`A table of ${rows} ${rows === 1 ? 'row' : 'rows'}`] : []),
      ...(count ? [`${count} ${count === 1 ? 'source' : 'sources'}`] : []),
    ];
    return { title: clip(sentences[0]!), lines };
  }

  // Whether this tab watched the run while it was running: a tab that saw it
  // finish posts it, as does the tab that started it. Plain, not tracked:
  // it is read when the run's status changes, which is what re-runs the
  // check.
  private watchedRunning = false;

  private noteRunStatus = (status: unknown) => {
    if (status === 'running') {
      this.watchedRunning = true;
    }
  };

  // A tab that started the run, or watched it finish, posts its result once
  // the run is done and the assistant is not mid-turn, so the result arrives
  // as its own turn.
  private get deliveryReady() {
    let run = this.run;
    let card = this.runCard;
    if (
      !card ||
      run?.status !== 'completed' ||
      !(this.launchedHere || this.watchedRunning) ||
      this.isRunDelivered
    ) {
      return false;
    }
    let messages = this.args.roomResource.messages;
    let last = messages[messages.length - 1];
    return Boolean(
      last &&
      last.author.userId === this.matrixService.aiBotUserId &&
      last.isStreamingFinished &&
      // a reply that ends in tool calls is mid-turn: the assistant goes on
      // once their results are in, and a delivery now would cancel it
      !last.tools?.length &&
      this.toolService.currentlyExecutingToolRequestIds.size === 0,
    );
  }

  // A run still working keeps its turn open: the transcript must not fold
  // its progress away.
  private get isLiveRun() {
    let state = this.runRowState;
    return (
      state === 'running' || state === 'starting' || state === 'reconnecting'
    );
  }

  // The call's source changes, counted, for the turn's diff chip.
  private get diffStats() {
    let diffs = this.fileDiffs;
    if (!diffs.length) {
      return undefined;
    }
    let added = 0;
    let removed = 0;
    let perFile: ChangedFile[] = [];
    for (let diff of diffs) {
      let lines =
        diff.lines ?? lineDiff(diff.before, diff.after, { context: 0 });
      let fileAdded = 0;
      let fileRemoved = 0;
      for (let line of lines) {
        if (line.op === 'add') {
          fileAdded++;
        } else if (line.op === 'del') {
          fileRemoved++;
        }
      }
      added += fileAdded;
      removed += fileRemoved;
      perFile.push({
        url: diff.url,
        path: diff.path,
        added: fileAdded,
        removed: fileRemoved,
        status:
          diff.status ??
          (diff.before === undefined && !diff.lines
            ? 'added'
            : diff.after === undefined && !diff.lines
              ? 'deleted'
              : 'modified'),
        // a reverted call shows no diffs, so a counted file was kept
        state: 'kept',
      });
    }
    return { files: diffs.length, added, removed, perFile };
  }

  private get diffStatsKey() {
    let stats = this.diffStats;
    return stats ? `${stats.files}:${stats.added}:${stats.removed}` : '';
  }

  private reportDiffStats = (key: unknown) => {
    let id = this.toolCallId;
    if (!id) {
      return;
    }
    let stats = key ? this.diffStats : undefined;
    schedule('afterRender', () => {
      if (stats) {
        this.toolService.toolDiffStats.set(id!, stats);
      } else {
        this.toolService.toolDiffStats.delete(id!);
      }
    });
  };

  // After render: the room reads the set while it renders this row.
  private reportLiveRun = (live: unknown) => {
    let id = this.toolCallId;
    if (!id) {
      return;
    }
    schedule('afterRender', () => {
      if (live && !this.isDestroying && !this.isDestroyed) {
        this.toolService.liveRunToolIds.add(id!);
      } else {
        this.toolService.liveRunToolIds.delete(id!);
      }
    });
  };

  willDestroy() {
    super.willDestroy();
    clearTimeout(this.pauseTimer);
    let id = this.toolCallId;
    if (id && this.toolService.liveRunToolIds.has(id)) {
      schedule('afterRender', () => this.toolService.liveRunToolIds.delete(id));
    }
  }

  // The turn must stay settled for a moment before the result goes in: an
  // assistant between two steps of its turn looks settled for an instant,
  // and a delivery then cancels the reply it was about to write.
  private deliver = (ready: unknown) => {
    if (!ready || !this.runCard) {
      return;
    }
    later(
      this,
      () => {
        let card = this.runCard;
        if (!isDestroyed(this) && this.deliveryReady && card) {
          this.toolService.deliverRunResult(
            this.args.roomId,
            card,
            this.rowTitle,
          );
        }
      },
      this.launchedHere ? DELIVERY_SETTLE_MS : WATCHER_DELIVERY_MS,
    );
  };

  // A script's changes to the room (its model, its skills), as the thread's
  // own system lines.
  private get roomChangeLines(): string[] {
    let card = this.toolResultCard.card as
      | { roomChanges?: string[] }
      | undefined;
    return (card?.roomChanges ?? []).filter(Boolean).map(roomChangeLine);
  }

  private get failureHeadline() {
    let message = this.failureMessage;
    return message ? failureHeadline(message) : undefined;
  }

  private get failureHasDetails() {
    let message = this.failureMessage;
    return Boolean(message && message.trim() !== this.failureHeadline);
  }

  // A tool's own record shows unwrapped; a script's steps show even when its
  // result card has nothing else in it.
  private get showsUnwrappedResult() {
    // a run's card is its record, said in the row's lines and progress;
    // with no line to say, the row says nothing more, never the card
    if (this.runCard) {
      return Boolean(this.resultLines?.length);
    }
    // a realm code result is said in the row's own lines (its room changes
    // in the thread below), so with none to say there is no card to show
    let card = this.toolResultCard.card as CardDef | undefined;
    if (
      card &&
      cardTypeDisplayName(card) === 'Realm Code Result' &&
      !this.resultLines?.length &&
      !this.fieldChanges?.length
    ) {
      return false;
    }
    if (this.shouldDisplayResultCard && !this.showsFinalCard) {
      return true;
    }
    return (
      !this.showsFinalCard &&
      Boolean(this.toolResultCard.card) &&
      Boolean(this.resultLines?.length || this.fieldChanges?.length)
    );
  }

  // The call is waiting on this tab's click: the decision moves into the
  // row's gate, with the reason the assistant gave.
  // ── ask-user: the assistant waits on the user's pick ──────────────────

  private get isAskUser() {
    return isAskUserTool(this.args.messageTool);
  }

  // The picker shows while the question is open; once picked, the row's
  // title says what was chosen.
  // A running script's question (realm.ask), waiting on this tab's reader.
  private get scriptAsk() {
    let id = this.toolCallId;
    return id ? this.toolService.scriptAsks.get(id) : undefined;
  }

  private answerScriptAsk = (value: string) => {
    this.scriptAsk?.answer(value);
  };

  private get isAskingUser() {
    return (
      this.isAskUser &&
      !this.isPreparing &&
      (this.applyButtonState === 'ready' || this.isRunning)
    );
  }

  private get askAttributes(): Record<string, unknown> {
    return (this.args.messageTool.arguments?.attributes ?? {}) as Record<
      string,
      unknown
    >;
  }

  // an ask-user call the reader has answered keeps its question, checked
  private get answeredAskUser(): boolean {
    return this.isAskUser && Boolean(this.rowChoice);
  }

  private get askQuestionText(): string {
    return this.askQuestion ?? '';
  }

  private get askQuestion() {
    let q = this.askAttributes.question;
    return typeof q === 'string' ? q : undefined;
  }

  private get askKind() {
    let kind = this.askAttributes.kind;
    return typeof kind === 'string' ? kind : undefined;
  }

  private get askOptions(): AskUserOptionData[] {
    let options = this.askAttributes.options;
    return Array.isArray(options) ? (options as AskUserOptionData[]) : [];
  }

  private get askAllowOther() {
    return this.askAttributes.allowOther === true;
  }

  private get answeredLabel() {
    let card = this.toolResultCard.card as
      | { label?: string; answer?: string }
      | undefined;
    return card?.label ?? card?.answer;
  }

  private answer = (value: string) => {
    this.toolService.run
      .unlinked()
      .perform(this.args.messageTool, { answer: value });
  };

  // A question or an approval waits on the reader in this row.
  // A question, an approval or a click the call waits on: one decision,
  // asked here while the row is on screen and docked only when it is not.
  private get hasOpenGate() {
    return this.isAskingUser || this.needsClick || Boolean(this.scriptAsk);
  }

  // the gate's one question
  private get gatePrompt(): string {
    if (this.approvalReason) {
      return this.approvalReason;
    }
    if (this.args.messageTool.awaitsApproval) {
      return 'The assistant asks for your approval to do this.';
    }
    // a script held for a click, with nothing risky in it to name
    if (this.density === 'script' && !this.clickReasons.length) {
      return 'Run this script?';
    }
    // what the click does, in the call's own verb
    let verb = this.args.messageTool.actionVerb;
    let changes = this.proposedChanges?.length;
    return changes
      ? `${verb} ${changes} field${changes === 1 ? '' : 's'}?`
      : `${verb} this call?`;
  }

  // what running a held script does, under its question
  private get gateDetail(): string | undefined {
    if (this.density !== 'script' || this.clickReasons.length) {
      return undefined;
    }
    return this.workspaceName
      ? `It writes to ${this.workspaceName}. Nothing runs until you click.`
      : 'Nothing runs until you click.';
  }

  // the held call's answer, as the reaction it was given
  private get answerReactions(): Reaction[] | undefined {
    let answer = this.args.messageTool.approvalAnswer;
    // a decline is said in the row's status; a thumbs-down beside it would
    // read as a verdict on the work
    if (!answer || answer.verdict === 'decline') {
      return undefined;
    }
    return [
      {
        key: answer.verdict === 'approve' ? '👍' : '👎',
        by: [answer.name],
      },
    ];
  }

  private get needsClick() {
    return (
      !this.isAskUser && !this.isPreparing && this.applyButtonState === 'ready'
    );
  }

  // What the row says about a failure. A stop says only that, and what it
  // left: the guidance in the result is for the model, and the research log
  // is already on the row's lines.
  private get shownFailureMessage() {
    let message = this.failureMessage;
    if (!message) {
      return message;
    }
    if (!this.isStopped) {
      // the list of research calls already made is for the model's retry,
      // not the reader: the row's lines already show each one
      return message.replace(/ Research calls this run made: .*$/s, '');
    }
    let saved = message.match(/Files already saved by this run: [^.]*/)?.[0];
    return saved
      ? `${STOPPED_BY_USER} · ${saved}`
      : `${STOPPED_BY_USER} · nothing was saved`;
  }

  private get failureMessage() {
    if (this.failedToolState) {
      return this.failedToolState.message;
    }
    if (this.failedToolCallState) {
      return this.args.messageTool.failureReason ?? 'Tool call failed.';
    }
    if (this.invalidToolCallState) {
      return this.args.messageTool.failureReason;
    }
    return undefined;
  }

  <template>
    {{! data-scroll-anchor: a candidate for the transcript's anchor
        (Pret UI's StickToBottom) }}
    <div
      data-scroll-anchor
      class={{cn
        'room-message-tool'
        is-pending=@isPending
        is-error=@isError
        is-failed=(bool this.hasFailedState)
        compact=@isCompact
        is-framed=this.isFramed
      }}
      {{! a participant in its message's motion region (motion/README.md) }}
      {{motion id=@messageTool.toolRequest.id role='row'}}
      data-tool-call-id={{@messageTool.toolRequest.id}}
      data-gate-open={{if this.hasOpenGate @messageTool.toolRequest.id}}
      data-plan-live={{if this.planSteps @messageTool.toolRequest.id}}
      data-test-tool-call-id={{@messageTool.toolRequest.id}}
      data-tool-name={{@messageTool.name}}
      data-tool-arguments-length={{this.argumentsLength}}
      {{whenChanged this.reconnect this.needsReconnect}}
      {{whenChanged this.watchPause this.pausedAt}}
      {{whenChanged this.noteRunStatus this.run.status}}
      {{whenChanged this.deliver this.deliveryReady}}
      {{whenChanged this.reportLiveRun this.isLiveRun}}
      {{whenChanged this.reportDiffStats this.diffStatsKey}}
      ...attributes
    >
      {{! One tool call is one Pret UI ToolRow that grows: what happened in
          its rows, the code behind its disclosure, the decision it waits on
          in its gate, and the card it made as its result. Nothing about the
          call is stacked outside it. }}
      <ToolRow
        class={{cn 'tool-row' compact=@isCompact}}
        @name={{this.toolName}}
        @title={{this.rowTitle}}
        @state={{this.rowState}}
        @density={{this.density}}
        @status={{this.rowStatus}}
        @choice={{this.rowChoice}}
        @verb={{this.verb}}
        @framed={{this.isFramed}}
        @progress={{this.progress}}
        @duration={{this.duration}}
        @receipt={{this.receipt}}
        @open={{this.isDisplayingCode}}
        @onOpenChange={{this.toggleViewCode}}
        {{! the code view mounts on open and unmounts on close, as Monaco
            should not idle in a collapsed row }}
        @lazy={{false}}
        data-test-tool-code-block
        data-test-tool-call-card-idle={{not
          (eq this.applyButtonState 'applying')
        }}
        {{this.scrollBottomIntoView}}
      >
        <:actions>
          {{! The row's disc and words carry the call's state, so outside the
              gate there is no second status control. The apply state stays
              on the element for tests and monitors only. }}
          {{#unless this.isPreparing}}
            <span
              class='apply-state'
              hidden
              data-test-tool-call-apply={{this.applyButtonState}}
            ></span>
          {{/unless}}
        </:actions>
        <:rows>
          {{#unless this.isPreparing}}
            {{#if this.clickReasons.length}}
              {{#each this.clickReasons as |clickReason|}}
                <ToolLine
                  @tone='attention'
                  @glyph='warning'
                  @mono={{true}}
                  @sub={{clickReason.reason}}
                  data-test-tool-call-click-reason={{clickReason.call}}
                >{{clickReason.call}}</ToolLine>
              {{/each}}
            {{/if}}
            {{#if this.planSteps}}
              <ToolPlan @steps={{this.planSteps}} data-test-tool-call-plan />
            {{else if this.reportedSteps}}
              {{! a long run scrolls inside its own box, newest at the
                  bottom, so the row stops growing }}
              <div class='tool-steps-scroll'>
                <ToolPlan
                  @steps={{this.reportedSteps}}
                  @label='Steps'
                  data-test-tool-call-steps
                />
              </div>
            {{/if}}
            {{#each this.liveLines as |line|}}
              <ToolLine
                @tone={{line.tone}}
                @glyph={{line.glyph}}
              >{{line.text}}{{#if line.answer}}
                  <b>{{line.answer}}</b>{{/if}}</ToolLine>
            {{/each}}
            {{#each this.runLines as |line|}}
              <ToolLine
                @tone={{line.tone}}
                @glyph={{line.glyph}}
                data-test-tool-run-line
              >{{line.text}}{{#if line.answer}}
                  <b>{{line.answer}}</b>{{/if}}</ToolLine>
            {{/each}}
            {{#if this.foundEntries.length}}
              <FoundEntries @entries={{this.foundEntries}} />
            {{/if}}
            {{#if this.showsFailure}}
              {{! The reason on one line, the whole message behind Details;
                  Retry and Details are the receipt's. Once the assistant
                  has retried it with a call that worked, the row says so in
                  gray and the actions go. }}
              <ToolLine
                @tone={{if
                  (or this.isSuperseded this.isStopped)
                  'muted'
                  (if this.invalidToolCallState 'attention' 'failed')
                }}
                @glyph={{if
                  this.isStopped
                  'stop'
                  (if this.invalidToolCallState 'warning' 'failed')
                }}
                data-test-boxel-alert={{if
                  this.invalidToolCallState
                  'warning'
                  'error'
                }}
              ><span
                  class='tool-failure-message'
                  data-open={{if this.showFailureDetails 'true'}}
                  title={{this.failureHeadline}}
                  data-test-alert-message='0'
                >{{this.shownFailureMessage}}</span></ToolLine>
            {{/if}}
            {{#if this.showsUnwrappedResult}}
              {{#if this.fieldChanges}}
                {{#each this.fieldChanges as |change|}}
                  <ToolChange
                    @label={{change.label}}
                    @from={{change.from}}
                    @to={{change.to}}
                    data-test-boxel-tool-call-result
                  />
                {{/each}}
              {{else if (or this.resultLines.length this.fileDiffs.length)}}
                {{#each this.shownResultLines as |line|}}
                  <ToolLine
                    @tone={{if
                      (and this.isSuperseded (eq line.tone 'failed'))
                      'muted'
                      line.tone
                    }}
                    @glyph={{line.glyph}}
                    @sub={{line.sub}}
                    @mono={{line.mono}}
                    data-test-boxel-tool-call-result
                    data-test-realm-code-line={{line.hook}}
                    data-test-realm-code-file={{if
                      (eq line.hook 'file')
                      line.hookValue
                    }}
                    data-test-realm-code-ui-action={{if
                      (eq line.hook 'ui-action')
                      line.hookValue
                    }}
                    data-test-realm-code-shown-card={{if
                      (eq line.hook 'shown-card')
                      true
                    }}
                    data-test-realm-code-show-error={{if
                      (eq line.hook 'show-error')
                      true
                    }}
                    data-test-realm-code-created-workspace={{if
                      (eq line.hook 'created-workspace')
                      true
                    }}
                    data-test-realm-code-deleted-workspace={{if
                      (eq line.hook 'deleted-workspace')
                      true
                    }}
                  >{{#if line.struck}}<del
                        class='tool-line-struck'
                      >{{line.text}}</del>{{else if line.href}}<a
                        class='tool-line-link'
                        href={{line.href}}
                        {{on 'click' (fn this.openLineLink line)}}
                      >{{line.text}}</a>{{else}}{{line.text}}{{#if line.answer}}
                        <b>{{line.answer}}</b>{{/if}}{{/if}}{{#if
                      line.thumb
                    }}<img
                        class='tool-line-thumb'
                        alt=''
                        data-test-realm-code-capture={{if line.roomMedia true}}
                        {{this.authedImage line.thumb line.roomMedia}}
                      />{{/if}}</ToolLine>
                {{/each}}
                {{#if this.foldedLineCount}}
                  <button
                    type='button'
                    class='tool-lines-more'
                    data-test-realm-code-more-lines
                    {{on 'click' this.showFoldedLines}}
                  >{{this.foldedLineCount}} more</button>
                {{/if}}
              {{else}}
                <CardRenderer
                  @card={{this.commandResultCardForRendering}}
                  @format='embedded'
                  @displayContainer={{false}}
                  data-test-boxel-tool-call-result
                />
              {{/if}}
              {{! The result's particulars and its menu (open, open in code mode,
                  copy, debug), as the card header had them, in the row's
                  own voice instead of a light card chrome, after what it says, as the
                  showcase draws a call's meta. }}
              <div
                class='tool-result-meta'
                data-test-tool-result-container
                data-test-tool-result-header
              >
                {{! the call's particulars: tool, what it returned, how
                      long it took (Pret UI's ToolMeta) }}
                <ToolMeta
                  class='tool-result-type'
                  @items={{this.metaItems}}
                  @reveal='always'
                />
                {{#if this.moreOptionsMenuItems.length}}
                  <Menu
                    @items={{this.moreOptionsMenuItems}}
                    @align='end'
                    @label='Result options'
                  >
                    <:trigger as |_open toggle|>
                      <IconButton
                        class='tool-result-options'
                        @label='Result options'
                        @icon={{Ellipsis}}
                        @appearance='plain'
                        @size='xs'
                        data-test-more-options-button
                        {{on 'click' toggle}}
                      />
                    </:trigger>
                  </Menu>
                {{/if}}
              </div>
            {{/if}}
            {{#if this.cardChangeTable}}
              {{! a bulk write, one line per card: what changed on each,
                  folded after a few (Pret UI's ToolChangeTable) }}
              <ToolChangeTable
                class='card-change-table'
                @rows={{this.cardChangeTable.rows}}
                @changeLabel={{this.cardChangeTable.changeLabel}}
                @caption='Cards this call changed'
                @limit={{4}}
                data-test-card-change-table
              />
            {{/if}}
            {{#if this.touchedCards.length}}
              {{! the cards the call wrote or changed, each one press from
                  its card (Pret UI's CardPills) }}
              <CardPills
                class='touched-cards'
                @cards={{this.touchedCards}}
                @layout={{if (gt this.touchedCards.length 6) 'grid' 'pills'}}
                @limit={{6}}
                @onOpen={{this.openTouchedCard}}
                @label='Cards this call changed'
                data-test-touched-cards
                {{this.publishPillBeacons this.touchedCards}}
              />
            {{/if}}
            {{#each this.shownDiffs key='url' as |diff|}}
              {{! A write never whispers: what it changed in each source
                  file, on the row, with the rest one press away. }}
              {{! long lines wrap: a 440px panel cut "from '@cardstac…" }}
              <ToolDiff
                @path={{diff.path}}
                @before={{diff.before}}
                @after={{diff.after}}
                @lines={{diff.lines}}
                @wrap={{true}}
              />
            {{/each}}
          {{/unless}}
        </:rows>
        <:body>
          {{#if this.isDisplayingCode}}
            {{#if this.checkOutcome}}
              {{! a check opens to what it found, never to its call }}
              <div class='check-outcome' data-test-check-outcome>
                {{#each this.checkOutcome as |line|}}
                  <ToolLine
                    @tone={{line.tone}}
                    @glyph={{line.glyph}}
                  >{{line.text}}</ToolLine>
                {{/each}}
              </div>
            {{else}}
              {{! the call as it was made, in Pret UI's code view: highlighted
                by its own small lexer, compact, and scrolling past 6 lines }}
              <PretCodeBlock
                class='tool-code-block'
                @code={{this.previewCommandCode}}
                @language='json'
                @density='compact'
                @maxLines={{6}}
                @label='The call'
              />
            {{/if}}
          {{/if}}
        </:body>
        <:gate>
          {{#if this.answeredAskUser}}
            {{! answered: the question stays, checked, with its answer (a
                script's question is a line in its rows instead) }}
            <AgentQuestion
              @question={{this.askQuestionText}}
              @answered={{this.rowChoice}}
            />
          {{else if this.isAskingUser}}
            {{! the question is answered where it is asked, in the row's
                gate, which already says it needs the reader }}
            <AskUserPicker
              @question={{this.askQuestion}}
              @kind={{this.askKind}}
              @options={{this.askOptions}}
              @allowOther={{this.askAllowOther}}
              @disabled={{this.isRunning}}
              @onAnswer={{this.answer}}
            />
          {{/if}}
          {{#if this.scriptAsk}}
            {{! the script waits on this question: asked in its own row }}
            <AskUserPicker
              @question={{this.scriptAsk.request.question}}
              @kind={{this.scriptAsk.request.kind}}
              @options={{this.scriptAsk.request.options}}
              @allowOther={{this.scriptAsk.request.allowOther}}
              @onAnswer={{this.answerScriptAsk}}
            />
          {{/if}}
          {{#if this.needsClick}}
            {{#if this.proposedChanges}}
              {{! what the approval would change, before it is given: the
                  same rows the settled call shows, from the call's own
                  values and the card as it is now }}
              {{#each this.proposedChanges as |change|}}
                <ToolChange
                  @label={{change.label}}
                  @from={{change.from}}
                  @to={{change.to}}
                  data-test-tool-call-proposed
                />
              {{/each}}
            {{/if}}
            {{! Pret UI's ToolGate: the question, what the click allows and
                the answers, laid out by the kit; the answers are the host's,
                which run and track the call }}
            <ToolGate
              @prompt={{this.gatePrompt}}
              @detail={{this.gateDetail}}
              @destructive={{this.isDestructive}}
              @actions={{this.gateActions}}
              data-test-tool-call-approval
            />

          {{/if}}
        </:gate>
        <:result>
          {{#if this.deliveredResult}}
            <ResultCard
              @eyebrow='Found'
              @title={{this.deliveredResult.title}}
              @lines={{this.deliveredResult.lines}}
              data-test-tool-run-result
            />
          {{/if}}
          {{#if this.showsFinalCard}}
            {{! The one card a call leaves the reader: the realm card it
                made or changed, as a card. }}
            {{! Pret UI's CardEmbed: the card in its own box under a compact
                hat (its type, its icon, the card's menu), not the stack's
                full header }}
            <div data-test-tool-result-container>
              <CardEmbed
                class='tool-result-card-preview'
                @format='embedded'
                @hat={{true}}
                @kind={{this.headerTitle}}
                @icon={{cardTypeIcon this.commandResultCardForRendering}}
                data-test-tool-result-header
              >
                <:actions>
                  {{#if this.moreOptionsMenuItems.length}}
                    <Menu
                      @items={{this.moreOptionsMenuItems}}
                      @align='end'
                      @label='Options'
                    >
                      <:trigger as |_open toggle|>
                        <IconButton
                          @label='Options'
                          @icon={{Ellipsis}}
                          @appearance='plain'
                          @size='xs'
                          data-test-more-options-button
                          {{on 'click' toggle}}
                        />
                      </:trigger>
                    </Menu>
                  {{/if}}
                </:actions>
                <:default>
                  <div class='tool-result-card-body' data-theme='light'>
                    <CardRenderer
                      @card={{this.commandResultCardForRendering}}
                      @format='embedded'
                      @displayContainer={{false}}
                      data-test-boxel-tool-call-result
                    />
                  </div>
                </:default>
              </CardEmbed>
            </div>
          {{/if}}
        </:result>
        <:receipt>
          {{#if this.showsFailure}}
            {{#unless (or this.isSuperseded this.isStopped)}}
              <ToolReceiptAction
                @label={{if this.invalidToolCallState 'Try Anyway' 'Retry'}}
                @onAct={{@runCommand}}
                data-test-alert-action-button={{if
                  this.invalidToolCallState
                  'Try Anyway'
                  'Retry'
                }}
              />
            {{/unless}}
            {{#if (and this.failureHasDetails (not this.isStopped))}}
              <ToolReceiptAction
                @label={{if this.showFailureDetails 'Less' 'Details'}}
                @onAct={{this.toggleFailureDetails}}
                aria-expanded={{if this.showFailureDetails 'true' 'false'}}
                data-test-tool-failure-details
              />
            {{/if}}
          {{/if}}
          {{#if this.canStop}}
            <ToolReceiptAction
              @label='Stop'
              @onAct={{this.stopCall}}
              data-tool-receipt-action='stop'
            />
          {{/if}}
        </:receipt>
      </ToolRow>
      {{#if this.answerReactions}}
        {{! who answered the held call: a reaction on its message, shown as
            one under the row, which keeps its content }}
        <Reactions
          class='tool-call-reactions'
          @reactions={{this.answerReactions}}
          @subject={{@messageTool.description}}
          data-test-tool-call-approval-answer={{@messageTool.approvalAnswer.verdict}}
        />
      {{/if}}
      {{#each this.roomChangeLines as |change|}}
        <SystemLine
          @text={{change}}
          @glyph='retry'
          data-test-thread-system-line
        />
      {{/each}}
    </div>

    <style scoped>
      /* the row and what hangs off it (reactions, a system line): one
         group, the kit's tight 4px */
      .room-message-tool > * + * {
        margin-top: var(--boxel-sp-4xs);
      }
      /* a written image, small under its line; square, inside the row's
         one rounded box */
      .tool-line-thumb {
        display: block;
        max-width: 100%;
        height: 4.5rem;
        margin-top: 0.25rem;
        object-fit: cover;
        background-color: var(--inset);
      }
      .tool-line-struck {
        color: var(--muted-foreground, var(--boxel-450));
        text-decoration-color: color-mix(
          in srgb,
          var(--muted-foreground) 70%,
          transparent
        );
      }
      .tool-line-link {
        color: inherit;
        text-decoration: none;
      }
      .tool-line-link:hover {
        text-decoration: underline;
      }
      /* sits on the text edge of the lines above it */
      .tool-lines-more {
        align-self: flex-start;
        margin-inline-start: calc(
          var(--pretui-toolrow-disc, var(--boxel-sp)) +
            var(--pretui-toolrow-gap, var(--boxel-sp-xs))
        );
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground, var(--boxel-450));
        cursor: pointer;
      }
      .tool-lines-more:hover {
        color: var(--foreground);
        text-decoration: underline;
      }
      /* the result's particulars and its menu: one line in the rows, in
         the row's caption voice, as the study draws a call's meta */
      .tool-result-meta {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }
      .room-message-tool:hover .tool-result-meta,
      .tool-result-options {
        border-radius: 0;
        color: var(--boxel-450);
      }
      /* one line until the reader asks for the rest */
      .tool-failure-message:not([data-open]) {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 1;
        overflow: hidden;
      }
      /* the answer hangs from the row's bottom edge, the way a chat hangs a
         reaction from its message: on the row's text edge, overlapping the
         edge by half its height, on the panel's own ground so the edge
         stops at it */
      .room-message-tool > .tool-call-reactions {
        position: relative;
        z-index: 1;
        margin-top: -0.375rem;
        padding-inline-start: var(--boxel-sp-xl);
      }
      .tool-call-reactions {
        --pretui-reaction-surface: var(--card, var(--boxel-ai-purple));
      }
      /* what a check found: lines in the body, the rows' own 4px apart */
      .check-outcome {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }
      /* a finished row recedes as one: its card pills take the row's
         settled ink instead of standing out bright over a gray row */
      .tool-row {
        --pretui-toolrow-settled-pill-ink: var(
          --pretui-toolrow-settled-ink,
          var(--muted-foreground)
        );
        --pretui-toolrow-settled-pill-weight: 500;
      }
      /* a run's steps stop growing the row past about ten lines: the
         list scrolls in its box, and column-reverse keeps the newest step
         in view as lines arrive */
      .tool-steps-scroll {
        display: flex;
        flex-direction: column-reverse;
        max-height: 12rem;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: color-mix(in oklch, var(--foreground) 24%, transparent)
          transparent;
      }
    </style>
  </template>
}
