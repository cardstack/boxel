import { CardDef, Component, realmURL } from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import ReadTextFileTool from '@cardstack/boxel-host/tools/read-text-file';
import WriteTextFileTool from '@cardstack/boxel-host/tools/write-text-file';
import ShowFileTool from '@cardstack/boxel-host/tools/show-file';
import PackageProposalTool from '@cardstack/boxel-host/tools/package-proposal';
import type Owner from '@ember/owner';

const PACKAGE = 'lib/palette';
const SPECIFIER = 'palette';
const MAP_FILE = 'importmap.json';
// How often the live follower re-asks what the newest version is. The listing
// is a cheap uncached read of one JSON file; the cost of asking is far below
// the cost of showing a pin that moved minutes ago.
const FOLLOW_INTERVAL_MS = 4000;

interface PublishedVersion {
  version: string;
  treeHash: string;
  publishedAt?: string;
}

interface DeltaReason {
  bump: string;
  member: string;
  detail: string;
}

interface Delta {
  bump: string;
  reasons: DeltaReason[];
  blindTo: string;
  comparedWith?: string;
}

interface Proposal {
  id: string;
  version: string;
  treeHash: string;
  body: string;
  proposedBy: string;
  proposedAt: string;
  state: 'open' | 'accepted' | 'withdrawn';
  acceptedBy?: string;
  overrideReason?: string;
  gate: { kind: string; code?: string; detail?: string; reason?: string };
  delta?: Delta;
}

const RANK: Record<string, number> = { patch: 0, minor: 1, major: 2 };

// Declared at module scope rather than inline as `static isolated = class …`:
// a decorator is not valid in a class expression, and this needs `@tracked`.
class VersionLockIsolated extends Component<typeof VersionLock> {
  // What the store says exists, newest first. Discovered, never hardcoded —
  // that is the point of the listing endpoint. Publish a new version to the
  // running server and it appears here without this card being edited.
  @tracked private versions: PublishedVersion[] = [];
  // The pin currently in `importmap.json`, and the intent beside it.
  @tracked private pinnedURL: string | undefined;
  @tracked private follow: string | undefined;
  @tracked private loaded = false;
  @tracked private error: string | undefined;

  // The cutting-room. `draft` is the candidate source; everything else is the
  // state of the conversation about it.
  @tracked private cutting = false;
  @tracked private draft = '';
  @tracked private baseline = '';
  @tracked private claim = '';
  @tracked private changelog = '';
  @tracked private analysis: Delta | undefined;
  @tracked private suggested: string | undefined;
  @tracked private proposals: Proposal[] = [];
  @tracked private refusal: { code: string; detail: string } | undefined;
  @tracked private overrideFor: string | undefined;
  @tracked private overrideReason = '';

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.load.perform();
  }

  private get realm(): string | undefined {
    return this.args.model[realmURL]?.href;
  }

  private get isLive(): boolean {
    return this.follow === 'live';
  }

  // Which version the pin currently resolves to, read out of the URL rather
  // than stored beside it. There is one fact here — what `palette` means —
  // and a second field holding "which version that is" could only disagree.
  private get current(): string | undefined {
    return this.pinnedURL?.match(/palette@([^/]+)\//)?.[1];
  }

  private get newest(): PublishedVersion | undefined {
    return this.versions[0];
  }

  // The identity to display. A Version's real name is its tree hash — the
  // content it seals. A semver is a LABEL pointing at that content, and while
  // following live the label is exactly the thing that keeps moving, so
  // naming the seal is the honest answer to "what am I running right now?".
  private get sealId(): string | undefined {
    return this.versions.find((v) => v.version === this.current)?.treeHash;
  }

  private get shortSeal(): string | undefined {
    return this.sealId?.slice(0, 12);
  }

  private urlFor(version: string): string {
    return `/experiments/_packages/${PACKAGE}@${version}/index.js`;
  }

  private async fetchVersions(): Promise<PublishedVersion[]> {
    if (!this.realm) {
      return [];
    }
    // The package store is served by the realm SERVER, at its origin — it is
    // not inside any realm — so this asks the origin the realm sits on.
    let listing = new URL(`/experiments/_packages/${PACKAGE}`, this.realm).href;
    let response = await fetch(listing, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`${listing} answered ${response.status}`);
    }
    let body = await response.json();
    return Array.isArray(body?.versions) ? body.versions : [];
  }

  private async readMap(): Promise<Record<string, any>> {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.realm) {
      return {};
    }
    try {
      let { content } = await new ReadTextFileTool(commandContext).execute({
        realm: this.realm,
        path: MAP_FILE,
      });
      return JSON.parse(content ?? '{}') ?? {};
    } catch {
      // A realm with no map yet is the ordinary starting state.
      return {};
    }
  }

  private load = restartableTask(async () => {
    this.error = undefined;
    try {
      this.versions = await this.fetchVersions();
    } catch (e: any) {
      this.error = String(e?.message ?? e);
    }
    let map = await this.readMap();
    this.pinnedURL = map?.imports?.[SPECIFIER];
    this.follow = map?.boxel?.dependencies?.[SPECIFIER];
    this.loaded = true;
    await this.refreshProposals();
    if (this.isLive) {
      this.followLive.perform();
    }
  });

  private choose = (version: string) => {
    this.write.perform(version);
  };

  // Read-modify-write, never blind overwrite. The map may carry scopes, an
  // `extends`, or pins for libraries this control knows nothing about, and a
  // switcher that dropped them would silently unpin the rest of the realm.
  //
  // TWO FACTS ARE WRITTEN, and they are not the same fact. `imports` gets a
  // CONCRETE pin, always — resolution must never depend on a marker this card
  // invented, and an import map with `"live"` in it would not be an import
  // map. The vendor key records the INTENT: `live` means "whatever is newest",
  // an exact version means "this one, until I say otherwise". That is Deck's
  // own split — dependencies are ranges, imports are the lock — and it is why
  // a reader that knows nothing about this card still resolves correctly.
  private write = restartableTask(async (version: string) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.realm) {
      this.error = 'No writable realm in context.';
      return;
    }
    this.error = undefined;
    let live = version === 'live';
    let target = live ? this.newest?.version : version;
    if (!target) {
      this.error = 'Nothing is published yet, so there is nothing to follow.';
      return;
    }
    let map = await this.readMap();
    let url = this.urlFor(target);
    map.imports = { ...(map.imports ?? {}), [SPECIFIER]: url };
    map.boxel = {
      ...(map.boxel ?? {}),
      dependencies: {
        ...(map.boxel?.dependencies ?? {}),
        [SPECIFIER]: live ? 'live' : target,
      },
    };
    try {
      await new WriteTextFileTool(commandContext).execute({
        realm: this.realm,
        path: MAP_FILE,
        content: `${JSON.stringify(map, null, 2)}\n`,
        overwrite: true,
      });
      this.pinnedURL = url;
      this.follow = live ? 'live' : target;
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      return;
    }
    if (live) {
      this.followLive.perform();
    } else {
      this.followLive.cancelAll();
    }
  });

  // Following live is a WRITE loop, not a display trick. The pin in the map
  // is what every other card in the realm resolves through, so "keep the
  // palette up to date" has to mean moving that pin — showing a newer number
  // while the realm still loads the old bytes would be the lie this whole
  // demo exists to avoid.
  private followLive = restartableTask(async () => {
    while (this.isLive && !this.isDestroying && !this.isDestroyed) {
      await timeout(FOLLOW_INTERVAL_MS);
      if (!this.isLive) {
        return;
      }
      try {
        let latest = await this.fetchVersions();
        this.versions = latest;
        let tip = latest[0];
        if (tip && this.current !== tip.version) {
          // A new version landed. Move the pin, which propagates the same way
          // any other edit to the map does.
          await this.write.perform('live');
        }
      } catch (e: any) {
        // A failed poll is not worth surfacing — the next one is four seconds
        // away, and a transient blip should not paint an error over a
        // perfectly good pin.
      }
    }
  });

  // The map is a FILE, and the file is the truth. Every claim this card makes
  // about what `palette` means is a claim about those bytes, so it offers the
  // bytes — one click into code mode, where the same edit can be made by hand
  // and this card will read it back. An authoring surface that hides what it
  // writes asks to be trusted; one that links to it can be checked.
  private openMap = () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.realm) {
      return;
    }
    new ShowFileTool(commandContext).execute({
      fileIdentifier: new URL(MAP_FILE, this.realm).href,
    });
  };

  // ── Cutting a Version ────────────────────────────────────────────────────
  //
  // `deck-version-is-a-proposal.md`: cutting a stable Version is a deliberate
  // act with the shape of a pull request — proposed, reviewable, gated,
  // accepted. Not a save. Everything below is that shape, and none of the
  // judgement happens here: this card asks the realm server, shows what it
  // says, and never computes a second opinion that could disagree with the
  // one that gates the publish.

  private call = async (input: Record<string, any>) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('No command context.');
    }
    return await new PackageProposalTool(commandContext).execute({
      packageName: PACKAGE,
      ...input,
    });
  };

  private async refreshProposals() {
    try {
      let { body } = await this.call({ action: 'list' });
      this.proposals = Array.isArray(body?.proposals) ? body.proposals : [];
    } catch {
      // The queue is a view onto review state; failing to read it should not
      // take down the pin control, which is the part people depend on.
    }
  }

  private get openProposals(): Proposal[] {
    return this.proposals.filter((p) => p.state === 'open');
  }

  private startCut = restartableTask(async () => {
    this.refusal = undefined;
    this.error = undefined;
    let tip = this.newest;
    if (!tip) {
      this.error = 'Nothing is published yet.';
      return;
    }
    // Start from the published bytes rather than a blank editor. A Version is
    // a claim about a DELTA, and there is no delta without a predecessor on
    // the screen next to it.
    let response = await fetch(
      new URL(this.urlFor(tip.version), this.realm).href,
    );
    this.baseline = await response.text();
    this.draft = this.baseline;
    this.claim = '';
    this.changelog = '';
    this.analysis = undefined;
    this.suggested = undefined;
    this.cutting = true;
  });

  private cancelCut = () => {
    this.cutting = false;
    this.refusal = undefined;
  };

  private onDraft = (event: Event) => {
    this.draft = (event.target as HTMLTextAreaElement).value;
    // The argument goes stale the moment the code changes. Clearing it is the
    // honest move: a suggestion left standing beside edited source is a claim
    // about bytes nobody analysed.
    this.analysis = undefined;
    this.suggested = undefined;
  };

  private onClaim = (event: Event) => {
    this.claim = (event.target as HTMLInputElement).value.trim();
  };

  private onChangelog = (event: Event) => {
    this.changelog = (event.target as HTMLTextAreaElement).value;
  };

  private onOverride = (event: Event) => {
    this.overrideReason = (event.target as HTMLTextAreaElement).value;
  };

  // §3.3 — the suggestion arrives BEFORE the number is claimed. Asking someone
  // to guess and then telling them they guessed wrong is the workflow this
  // replaces.
  private analyze = restartableTask(async () => {
    this.refusal = undefined;
    try {
      let { ok, status, body } = await this.call({
        action: 'analyze',
        source: this.draft,
      });
      if (!ok) {
        // Say what happened. A button that quietly does nothing is worse than
        // one that reports a 404: the first looks like a broken card, the
        // second names the realm server that has not been restarted.
        this.refusal = body?.errors?.[0] ?? {
          code: `http-${status}`,
          detail:
            `the realm server answered ${status} for ` +
            `/_package-proposals/${PACKAGE}`,
        };
        return;
      }
      this.analysis = body?.delta
        ? { ...body.delta, comparedWith: body.comparedWith }
        : undefined;
      this.suggested = body?.suggested?.version;
      if (this.suggested && !this.claim) {
        this.claim = this.suggested;
      }
      if (!this.analysis) {
        this.refusal = {
          code: 'no-predecessor',
          detail:
            body?.detail ??
            'nothing is published under this name yet, so there is no delta',
        };
      }
    } catch (e: any) {
      this.refusal = { code: 'unreachable', detail: String(e?.message ?? e) };
    }
  });

  // A local check only, so the field can say "that is not a semver" without a
  // round trip. The server checks it again and its answer is the one that
  // counts — this is a courtesy, not a gate.
  private get claimIsSemver(): boolean {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(this.claim);
  }

  private get claimIsNew(): boolean {
    return !this.versions.some((v) => v.version === this.claim);
  }

  // Shown while the author is still choosing, so the asymmetry is visible
  // before it is enforced: claiming higher than the pass suggests is free,
  // claiming lower will be stopped and asked for a reason.
  private get claimIsBelowSuggestion(): boolean {
    let suggested = this.analysis?.bump;
    if (!suggested || !this.claimIsSemver || !this.analysis?.comparedWith) {
      return false;
    }
    let claimed = bumpBetween(this.analysis.comparedWith, this.claim);
    return !!claimed && RANK[claimed] < RANK[suggested];
  }

  // One line of prose per problem, in the order they stop you. Note what is
  // NOT here: being below the suggestion is a warning, never a block. The
  // ruling allows it — the pass is imperfect and a human may know better — it
  // just has to be said out loud at acceptance.
  private get claimWarning(): string | undefined {
    if (!this.claim) {
      return undefined;
    }
    if (!this.claimIsSemver) {
      return 'Not an exact semver — a range or a tag is a question, not an answer.';
    }
    if (!this.claimIsNew) {
      return `${this.claim} is already published, and a Version is immutable.`;
    }
    if (this.claimDoesNotFollow) {
      return `${this.claim} does not follow ${this.newest?.version}, so the structural verdict — which was read against ${this.newest?.version} — does not describe this claim. Allowed, but acceptance will ask you why.`;
    }
    if (this.claimIsBelowSuggestion) {
      return 'Below the structural suggestion. Allowed — the pass is imperfect — but acceptance will ask you why.';
    }
    return undefined;
  }

  // Not "is it smaller" — is it an increment at all. `4.0.1` after `4.0.0` is
  // a patch; `1.2.3` after `4.0.0` is a different line entirely, and the
  // suggestion on screen was computed against a baseline it does not extend.
  private get claimDoesNotFollow(): boolean {
    let baseline = this.newest?.version;
    if (!baseline || !this.claimIsSemver) {
      return false;
    }
    return !bumpBetween(baseline, this.claim);
  }

  private get cannotPropose(): boolean {
    return (
      !this.claimIsSemver ||
      !this.claimIsNew ||
      this.changelog.trim().length === 0 ||
      this.propose.isRunning
    );
  }

  private propose = restartableTask(async () => {
    this.refusal = undefined;
    let { ok, body } = await this.call({
      action: 'propose',
      version: this.claim,
      body: this.changelog,
      source: this.draft,
    });
    if (!ok) {
      this.refusal = body?.errors?.[0] ?? {
        code: 'refused',
        detail: 'the proposal was refused',
      };
      return;
    }
    this.cutting = false;
    await this.refreshProposals();
  });

  private accept = restartableTask(async (proposal: Proposal) => {
    this.refusal = undefined;
    let { ok, body } = await this.call({
      action: 'accept',
      proposalId: proposal.id,
      overrideReason:
        this.overrideFor === proposal.id ? this.overrideReason : undefined,
    });
    if (!ok) {
      let refused = body?.refused ?? body?.errors?.[0];
      this.refusal = refused;
      // The refusals that are QUESTIONS rather than stops: reveal the field
      // that answers them instead of making the reviewer hunt for it.
      if (
        refused?.code === 'override-needs-reason' ||
        refused?.code === 'claim-does-not-follow'
      ) {
        this.overrideFor = proposal.id;
      }
      return;
    }
    this.overrideFor = undefined;
    this.overrideReason = '';
    await this.refreshProposals();
    // The Version exists now, so the listing has changed and — if this realm
    // is following live — the pin should move to it.
    this.versions = await this.fetchVersions();
    if (this.isLive) {
      await this.write.perform('live');
    }
  });

  private withdraw = restartableTask(async (proposal: Proposal) => {
    await this.call({ action: 'withdraw', proposalId: proposal.id });
    await this.refreshProposals();
  });

  private get busy() {
    return this.write.isRunning || this.load.isRunning;
  }

  <template>
    <section class='lock'>
      <header>
        <h2>palette</h2>
        <p>Every card in this workspace resolves <code>palette</code> through
          <button type='button' class='linkish' {{on 'click' this.openMap}}>
            <code>importmap.json</code>
          </button>. This control reads and writes that file and keeps no copy
          of it. The versions below are whatever the realm server's package
          store actually holds.</p>
      </header>

      <div class='choices' role='group' aria-label='palette version'>
        <button
          type='button'
          class='choice live {{if this.isLive "on"}}'
          aria-pressed='{{if this.isLive "true" "false"}}'
          disabled={{this.busy}}
          {{on 'click' (fn this.choose 'live')}}
          data-test-choose-version='live'
        >
          <span class='v'>live</span>
          <span class='note'>follow whatever is newest</span>
        </button>

        {{#each this.versions as |v|}}
          <button
            type='button'
            class='choice {{if (eq v.version this.follow) "on"}}'
            aria-pressed='{{if (eq v.version this.follow) "true" "false"}}'
            disabled={{this.busy}}
            {{on 'click' (fn this.choose v.version)}}
            data-test-choose-version={{v.version}}
          >
            <span class='v'>{{v.version}}</span>
            <span class='note seal'>{{v.treeHash}}</span>
          </button>
        {{/each}}
      </div>

      <footer>
        {{#if this.loaded}}
          {{#if this.isLive}}
            {{! Following live: the label is the thing that moves, so name the
                seal instead. }}
            <span class='label'>following live · sealed as</span>
            <code class='resolved' data-test-resolved>
              {{#if this.shortSeal}}{{this.shortSeal}}{{else}}nothing published
                yet{{/if}}
            </code>
            <span class='sub'>currently {{this.current}}</span>
          {{else}}
            <span class='label'>pinned to</span>
            <code class='resolved' data-test-resolved>
              {{#if this.current}}{{this.current}}{{else}}nothing pinned yet{{/if}}
            </code>
          {{/if}}
          <button type='button' class='linkish map' {{on 'click' this.openMap}}>
            open {{MAP_FILE}} in code mode →
          </button>
        {{else}}
          <span class='label'>reading</span>
          <code class='resolved'>…</code>
        {{/if}}
        {{#if this.error}}
          <p class='error' role='status'>{{this.error}}</p>
        {{/if}}
      </footer>
    </section>

    {{! ── Cutting a Version ─────────────────────────────────────────────── }}
    <section class='cut'>
      <header>
        <h3>Cut a version</h3>
        <p>A Step is a fact — this is what the tree looked like. A Version is a
          <em>claim</em>, addressed at other people, about their code, which
          they will act on without reading yours. So it is proposed, argued and
          accepted rather than saved.</p>
      </header>

      {{#if this.cutting}}
        <label class='field'>
          <span class='label'>candidate source</span>
          <textarea
            class='code'
            rows='14'
            spellcheck='false'
            data-test-draft
            {{on 'input' this.onDraft}}
          >{{this.baseline}}</textarea>
        </label>

        <div class='row'>
          <button
            type='button'
            class='secondary'
            disabled={{this.analyze.isRunning}}
            {{on 'click' this.analyze.perform}}
            data-test-analyze
          >
            {{#if this.analyze.isRunning}}reading the surface…{{else}}Suggest a
              bump{{/if}}
          </button>
          {{#if this.suggested}}
            <span class='sub'>suggests
              <code>{{this.suggested}}</code></span>
          {{/if}}
        </div>

        {{#if this.analysis}}
          <div class='verdict {{this.analysis.bump}}'>
            <p class='headline'>
              <strong>{{this.analysis.bump}}</strong>
              against
              <code>{{this.analysis.comparedWith}}</code>
            </p>
            {{#if this.analysis.reasons}}
              <ul>
                {{#each this.analysis.reasons as |r|}}
                  <li><code>{{r.member}}</code>
                    — {{r.detail}}
                    <span class='tag'>{{r.bump}}</span></li>
                {{/each}}
              </ul>
            {{else}}
              <p class='sub'>No change to the exported surface.</p>
            {{/if}}
            {{! Always shown, never on a toggle. A structural pass that
                reports "no break" without saying what it cannot see invites
                exactly the mistake it exists to prevent. }}
            <p class='blind'><strong>Blind to:</strong>
              {{this.analysis.blindTo}}</p>
          </div>
        {{/if}}

        <label class='field'>
          <span class='label'>the version you are claiming</span>
          <input
            type='text'
            class='semver'
            placeholder='1.2.3'
            value={{this.claim}}
            data-test-claim
            {{on 'input' this.onClaim}}
          />
          {{#if this.claimWarning}}
            <span class='warn' data-test-claim-warning>{{this.claimWarning}}</span>
          {{/if}}
        </label>

        <label class='field'>
          <span class='label'>changelog — what is a consumer taking on?</span>
          <textarea
            rows='3'
            placeholder='pick() now takes a colour name instead of an index.'
            data-test-changelog
            {{on 'input' this.onChangelog}}
          >{{this.changelog}}</textarea>
        </label>

        <div class='row'>
          <button
            type='button'
            class='primary'
            disabled={{this.cannotPropose}}
            {{on 'click' this.propose.perform}}
            data-test-propose
          >Propose</button>
          <button
            type='button'
            class='secondary'
            {{on 'click' this.cancelCut}}
          >Cancel</button>
        </div>
      {{else}}
        <button
          type='button'
          class='primary'
          disabled={{this.startCut.isRunning}}
          {{on 'click' this.startCut.perform}}
          data-test-start-cut
        >Start from {{if this.newest this.newest.version 'nothing'}}…</button>
      {{/if}}

      {{#if this.refusal}}
        <p class='error' role='status' data-test-refusal>
          <strong>{{this.refusal.code}}</strong>
          — {{this.refusal.detail}}
        </p>
      {{/if}}

      {{#if this.openProposals}}
        <h4>Open proposals</h4>
        <ul class='queue'>
          {{#each this.openProposals as |p|}}
            <li class='proposal' data-test-proposal={{p.id}}>
              <div class='row spread'>
                <code class='v'>{{p.version}}</code>
                <span class='sub'>by {{p.proposedBy}}</span>
              </div>
              <p class='body'>{{p.body}}</p>
              {{#if p.delta}}
                <p class='sub'>structural pass:
                  <strong>{{p.delta.bump}}</strong>
                  vs
                  <code>{{p.delta.comparedWith}}</code></p>
              {{/if}}
              {{#if (eq p.gate.kind 'refused')}}
                <p class='warn'>gate: {{p.gate.detail}}</p>
              {{/if}}
              {{#if (eq this.overrideFor p.id)}}
                <label class='field'>
                  <span class='label'>why accept below the suggestion?</span>
                  <textarea
                    rows='2'
                    data-test-override
                    {{on 'input' this.onOverride}}
                  >{{this.overrideReason}}</textarea>
                  <span class='sub'>This is kept on the Version's record — it
                    is the sentence whoever meets the break will want.</span>
                </label>
              {{/if}}
              <div class='row'>
                <button
                  type='button'
                  class='primary'
                  disabled={{this.accept.isRunning}}
                  {{on 'click' (fn this.accept.perform p)}}
                  data-test-accept={{p.id}}
                >Accept &amp; publish</button>
                <button
                  type='button'
                  class='secondary'
                  {{on 'click' (fn this.withdraw.perform p)}}
                  data-test-withdraw={{p.id}}
                >Withdraw</button>
              </div>
            </li>
          {{/each}}
        </ul>
      {{/if}}
    </section>

    <style scoped>
      /* Light, like the swatches card beside it. The container is a neutral
         surface: everything that changes between versions is the library's
         output, so the chrome stays constant and out of the way. */
      .lock,
      .cut {
        padding: 1.5rem;
        font: 400 15px/1.5 system-ui, sans-serif;
        max-width: 36rem;
      }
      .cut {
        border-top: 1px solid #eee;
      }
      h2 {
        margin: 0;
        font-size: 1.4rem;
        font-family: ui-monospace, monospace;
      }
      h3 {
        margin: 0;
        font-size: 1.05rem;
      }
      h4 {
        margin: 1.5rem 0 0.5rem;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #888;
      }
      header p {
        margin: 0.35rem 0 0;
        color: #666;
        font-size: 0.9rem;
      }
      .choices {
        display: grid;
        gap: 0.6rem;
        margin: 1.25rem 0;
      }
      .choice {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        align-items: flex-start;
        padding: 0.7rem 0.9rem;
        border: 2px solid #d8d8d8;
        border-radius: 0.6rem;
        background: #fff;
        cursor: pointer;
        text-align: left;
      }
      .choice:hover {
        border-color: #999;
      }
      /* Kept from the dark pass, which is the one thing there worth keeping:
         this control is fully keyboard-operable and deserves a ring that does
         not depend on the browser default surviving a restyle. */
      .choice:focus-visible,
      button:focus-visible,
      textarea:focus-visible,
      input:focus-visible {
        outline: 2px solid #0090ff;
        outline-offset: 2px;
      }
      .choice:disabled {
        cursor: progress;
        opacity: 0.7;
      }
      .choice.on {
        border-color: #0090ff;
        background: #f0f8ff;
      }
      .choice.live .v {
        color: #0a7d3f;
      }
      .v {
        font-family: ui-monospace, monospace;
        font-weight: 600;
      }
      .note {
        font-size: 0.8rem;
        color: #666;
      }
      .note.seal {
        font-family: ui-monospace, monospace;
        font-size: 0.68rem;
        color: #999;
        word-break: break-all;
      }
      footer {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.2rem;
        padding-top: 1rem;
        border-top: 1px solid #eee;
      }
      .label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #888;
      }
      .resolved {
        font-family: ui-monospace, monospace;
        font-size: 0.85rem;
        color: #333;
        word-break: break-all;
      }
      .sub {
        font-size: 0.75rem;
        color: #777;
      }
      .error {
        margin: 0.5rem 0 0;
        color: #b91c1c;
        font-size: 0.85rem;
      }
      .warn {
        display: block;
        margin-top: 0.25rem;
        color: #9a6700;
        font-size: 0.78rem;
      }
      /* A button that reads as a link, because it navigates rather than
         changes anything. */
      .linkish {
        padding: 0;
        border: 0;
        background: none;
        color: #0069c2;
        font: inherit;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .linkish.map {
        margin-top: 0.6rem;
        font-size: 0.8rem;
      }
      .field {
        display: block;
        margin: 1rem 0;
      }
      .field .label {
        display: block;
        margin-bottom: 0.3rem;
      }
      textarea,
      input {
        width: 100%;
        padding: 0.5rem 0.6rem;
        border: 1px solid #d8d8d8;
        border-radius: 0.4rem;
        background: #fff;
        font: inherit;
        color: #222;
      }
      textarea.code,
      input.semver {
        font-family: ui-monospace, monospace;
        font-size: 0.8rem;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin: 0.6rem 0;
        flex-wrap: wrap;
      }
      .row.spread {
        justify-content: space-between;
      }
      .primary,
      .secondary {
        padding: 0.45rem 0.9rem;
        border-radius: 0.4rem;
        border: 1px solid #0090ff;
        background: #0090ff;
        color: #fff;
        font: inherit;
        font-size: 0.85rem;
        cursor: pointer;
      }
      .secondary {
        background: #fff;
        color: #0069c2;
      }
      .primary:disabled,
      .secondary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .verdict {
        padding: 0.75rem 0.9rem;
        border: 1px solid #e3e3e3;
        border-left: 4px solid #999;
        border-radius: 0.4rem;
        background: #fafafa;
      }
      .verdict.major {
        border-left-color: #e5484d;
      }
      .verdict.minor {
        border-left-color: #0090ff;
      }
      .verdict.patch {
        border-left-color: #30a46c;
      }
      .headline {
        margin: 0 0 0.4rem;
        font-size: 0.9rem;
      }
      .verdict ul {
        margin: 0;
        padding-left: 1.1rem;
        font-size: 0.82rem;
        color: #444;
      }
      .tag {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #888;
      }
      .blind {
        margin: 0.6rem 0 0;
        font-size: 0.78rem;
        color: #666;
      }
      .queue {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.75rem;
      }
      .proposal {
        padding: 0.8rem 0.9rem;
        border: 1px solid #e3e3e3;
        border-radius: 0.5rem;
        background: #fff;
      }
      .proposal .body {
        margin: 0.3rem 0;
        font-size: 0.88rem;
        color: #333;
      }
    </style>
  </template>
}

// Which bump one version number claims relative to another. The card shows
// this while the author is still typing; the SERVER computes it again on the
// record, and the server's answer is the one that gates. Duplicating the read
// here buys a warning before the round trip and nothing else — it must never
// become the thing that decides.
function bumpBetween(prior: string, next: string): string | undefined {
  let a = prior.split('.').map(Number);
  let b = next.split('.').map(Number);
  if (a.length < 3 || b.length < 3 || [...a, ...b].some((n) => !isFinite(n))) {
    return undefined;
  }
  // Anchored left-to-right. Read independently, `4.0.0 → 1.2.3` looks like a
  // minor because 2 > 0, and a version that went backwards would be graded
  // against a line it does not belong to.
  if (b[0] > a[0]) return 'major';
  if (b[0] === a[0] && b[1] > a[1]) return 'minor';
  if (b[0] === a[0] && b[1] === a[1] && b[2] > a[2]) return 'patch';
  return undefined;
}

// The version lock: one control over which build of `palette` every card in
// this realm gets, and the place a new build is cut.
//
// It STORES NOTHING. The realm's `importmap.json` is the truth; this reads it
// to show what is pinned and writes it to change it. That is the shape
// `deck-multi-package-design.md` §3 rules for any authoring surface over the
// map — "the card is a convenience, never a dependency."
//
// The list is discovered, not declared. `GET /experiments/_packages/lib/palette` reports
// what the store holds, so publishing a new version to the running server
// makes it appear here with no edit to this file.
//
// LIVE IS A REAL CHOICE, not a display mode. Deck's dependency vocabulary has
// three levels of volatility — `live` (every save), a dist-tag, and an exact
// pin — and this offers the two ends of it. Following live moves the pin as
// new versions land, and names the state by its SEAL rather than its semver,
// because while following, the semver is precisely the part that keeps
// changing underneath you.
//
// CUTTING IS TWO-PHASE, per `deck-version-is-a-proposal.md`. A candidate is
// analysed before a number is claimed, proposed with a changelog, and
// accepted separately — and accepting below the structural suggestion has to
// carry a reason, which is kept. Every one of those judgements is made by the
// realm server. This card asks, displays, and never grades its own homework:
// a second opinion computed here could disagree with the one that actually
// gates the publish, and the disagreement would be invisible.
export class VersionLock extends CardDef {
  static displayName = 'Version Lock';

  static isolated = VersionLockIsolated;
}
