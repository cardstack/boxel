import { fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { timeout } from 'ember-concurrency';

import { pageTitle } from 'ember-page-title';
import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { eq } from '@cardstack/boxel-ui/helpers';

import { SupportedMimeType } from '@cardstack/runtime-common';

import MatrixAuth from '@cardstack/host/components/matrix/auth';
import config from '@cardstack/host/config/environment';
import {
  AI_PROXY_URL,
  CARD_SOURCE_HEADERS,
  EDITORIAL_ARTICLE_CARD_SOURCE,
  EDITORIAL_CHILD_CARDS_SOURCE,
  ISOLATION_PROGRAM_SOURCE,
  SECURITY_PROBE_CARD_SOURCE,
  SECURITY_PROBE_PROGRAM_SOURCE,
  SPIKE_STORAGE_KEY,
  articleCardDocumentSource,
  assertAllowedAIProxyURL,
  assertURLWithinRealm,
  commentCardDocumentSource,
  recipeSnapshotFromCardDocument,
  recipeCardDocumentSource,
  securityProbeCardDocumentSource,
  sanitizeAIProxyRequest,
  sanitizeDelegationProps,
  sanitizeOwnCardPatch,
  sanitizeRecipeCommandInput,
  snapshotFromCardDocument,
  spikeCardQuery,
  videoCardDocumentSource,
  type DelegatedRenderModel,
  type ParentDelegationRequest,
  type SpikeCardSnapshot,
  type SpikeProgramView,
  type SpikeRenderAction,
  type SpikeRealmConfig,
  type WorkerCapabilityRequest,
} from '@cardstack/host/lib/realm-isolation-spike';
import RealmIsolationWorkerRuntime from '@cardstack/host/lib/realm-isolation-worker-runtime';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from '@cardstack/base/card-api';

interface PanelState extends SpikeRealmConfig {
  status: 'starting' | 'ready' | 'working' | 'error';
  displayMode: 'view' | 'edit';
  view?: SpikeProgramView;
  draftNote: string;
  aiPrompt: string;
  commentAuthor: string;
  commentDraft: string;
  error?: string;
}

class RealmIsolationSpike extends Component {
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

  @tracked panels: PanelState[] = [];
  @tracked setupStatus = '';
  @tracked isSettingUp = false;
  @tracked delegatedRender: DelegatedRenderModel | undefined;
  private runtimes: Array<RealmIsolationWorkerRuntime | undefined> = [];

  private readonly reusedRealmPair: SpikeRealmConfig[] = [
    {
      realmURL:
        'https://realms-staging.stack.cards/ctse/ses-isolation-ms7jy87e-parent/',
      cardURL:
        'https://realms-staging.stack.cards/ctse/ses-isolation-ms7jy87e-parent/IsolationCard/primary',
      programURL:
        'https://realms-staging.stack.cards/ctse/ses-isolation-ms7jy87e-parent/isolation-program.js',
      label: 'Parent Realm',
      role: 'parent',
      canUseAIProxy: false,
    },
    {
      realmURL:
        'https://realms-staging.stack.cards/ctse/ses-isolation-ms7jy87e-child/',
      cardURL:
        'https://realms-staging.stack.cards/ctse/ses-isolation-ms7jy87e-child/IsolationCard/primary',
      programURL:
        'https://realms-staging.stack.cards/ctse/ses-isolation-ms7jy87e-child/isolation-program.js',
      label: 'Child Realm',
      role: 'child',
      canUseAIProxy: true,
    },
  ];

  constructor(owner: Owner, args: object) {
    super(owner, args);
    void this.restoreStoredPair();
  }

  willDestroy() {
    super.willDestroy();
    this.destroyRuntimes();
  }

  get isLoggedIn() {
    return this.matrixService.isLoggedIn;
  }

  get matrixUserId() {
    return this.matrixService.userId;
  }

  get matrixURL() {
    return config.matrixURL;
  }

  get realmServerURL() {
    return config.realmServerURL;
  }

  get aiProxyURL() {
    return AI_PROXY_URL;
  }

  get childPanelIndex() {
    return this.panels.findIndex((panel) => panel.role === 'child');
  }

  get childPanel() {
    return this.panels[this.childPanelIndex];
  }

  interactPath(cardURL: string) {
    return new URL(cardURL).pathname;
  }

  private replacePanel(index: number, changes: Partial<PanelState>) {
    this.panels = this.panels.map((panel, panelIndex) =>
      panelIndex === index ? { ...panel, ...changes } : panel,
    );
  }

  private destroyRuntimes() {
    for (let runtime of this.runtimes) {
      runtime?.destroy();
    }
    this.runtimes = [];
    this.delegatedRender = undefined;
  }

  private normalizeConfigs(configs: SpikeRealmConfig[]) {
    let child = configs.find((config) => config.role === 'child');
    if (!child) {
      throw new Error('The saved realm pair has no child realm');
    }
    let moduleCardURLs = {
      video: `${child.realmURL}VideoCard/field-notes`,
      recipe: `${child.realmURL}RecipeCard/fire-roasted-beans`,
      comments: `${child.realmURL}IsolationCard/primary`,
      securityProbe: `${child.realmURL}security-probe`,
    };
    return configs.map((realmConfig) => ({
      ...realmConfig,
      cardURL: `${realmConfig.realmURL}IsolationCard/primary`,
      canUseAIProxy: realmConfig.role === 'child',
      moduleCardURLs,
    }));
  }

  private async restoreStoredPair() {
    let raw = window.localStorage.getItem(SPIKE_STORAGE_KEY);
    try {
      let configs = raw
        ? (JSON.parse(raw) as SpikeRealmConfig[])
        : this.reusedRealmPair;
      if (
        configs.length !== 2 ||
        configs.some(
          (config) =>
            !['parent', 'child'].includes(config.role) ||
            typeof config.canUseAIProxy !== 'boolean',
        )
      ) {
        return;
      }
      configs = this.normalizeConfigs(configs);
      this.setupStatus = 'Restoring the most recent staging realm pair…';
      await this.startPair(configs);
      this.setupStatus =
        'Reused the existing staging realms and added the hostile card to ordinary Interact mode.';
    } catch (error) {
      this.setupStatus = `Could not restore the previous pair: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  @action
  async createRealmPair() {
    if (!this.isLoggedIn || this.isSettingUp) {
      return;
    }

    this.isSettingUp = true;
    this.destroyRuntimes();
    this.panels = [];
    let runId = Date.now().toString(36);

    try {
      let configs: SpikeRealmConfig[] = [];
      for (let [index, descriptor] of [
        {
          suffix: 'parent',
          label: 'Parent Realm',
          role: 'parent' as const,
          canUseAIProxy: false,
        },
        {
          suffix: 'child',
          label: 'Child Realm',
          role: 'child' as const,
          canUseAIProxy: true,
        },
      ].entries()) {
        this.setupStatus = `Creating ${descriptor.label} on staging…`;
        let endpoint = `ses-isolation-${runId}-${descriptor.suffix}`;
        let realmURL = await this.realmServer.createRealm({
          endpoint,
          name: `SES Isolation Spike ${descriptor.label}`,
        });
        await this.matrixService.appendRealmToAccountData(realmURL.href);
        let realmResource = this.realm.getOrCreateRealmResource(realmURL.href);
        await realmResource.login();

        this.setupStatus = `Writing the ${descriptor.label} program…`;
        await this.writeSource(
          realmURL.href,
          `${realmURL.href}isolation-program.js`,
          ISOLATION_PROGRAM_SOURCE,
        );

        let config: SpikeRealmConfig = {
          realmURL: realmURL.href,
          cardURL: `${realmURL.href}IsolationCard/primary`,
          programURL: `${realmURL.href}isolation-program.js`,
          label: descriptor.label,
          role: descriptor.role,
          canUseAIProxy: descriptor.canUseAIProxy,
        };
        configs[index] = config;
      }

      await this.startPair(configs);
      this.setupStatus =
        'Both private staging realms are ready. The programs share this DOM, not authority.';
    } catch (error) {
      this.setupStatus = `Setup failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    } finally {
      this.isSettingUp = false;
    }
  }

  private async startPair(configs: SpikeRealmConfig[]) {
    this.destroyRuntimes();
    configs = this.normalizeConfigs(configs);
    this.panels = configs.map((realmConfig) => ({
      ...realmConfig,
      status: 'starting',
      displayMode: 'view',
      draftNote: '',
      aiPrompt: 'What can I substitute for cannellini beans?',
      commentAuthor: '',
      commentDraft: '',
    }));

    await Promise.all(
      configs.map(async (realmConfig) => {
        await this.realm.getOrCreateRealmResource(realmConfig.realmURL).login();
      }),
    );
    await this.ensureEditorialCards(configs);
    window.localStorage.setItem(SPIKE_STORAGE_KEY, JSON.stringify(configs));

    await Promise.all(
      configs.map(async (realmConfig, index) => {
        try {
          await this.writeSource(
            realmConfig.realmURL,
            realmConfig.programURL,
            ISOLATION_PROGRAM_SOURCE,
          );
          let programSource = await this.readSource(
            realmConfig.realmURL,
            realmConfig.programURL,
          );
          let runtime = new RealmIsolationWorkerRuntime(
            realmConfig,
            programSource,
            async (request) =>
              await this.handleCapability(realmConfig, request),
          );
          this.runtimes[index] = runtime;
          let view = await runtime.invoke('initialize');
          this.replacePanel(index, {
            status: 'ready',
            view,
            draftNote: view.render.editor.value,
            error: undefined,
          });
        } catch (error) {
          this.replacePanel(index, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    if (this.runtimes.every(Boolean)) {
      await this.delegateChildRender();
    }
  }

  private async ensureEditorialCards(configs: SpikeRealmConfig[]) {
    let parent = configs.find((config) => config.role === 'parent');
    let child = configs.find((config) => config.role === 'child');
    if (!parent || !child || !child.moduleCardURLs) {
      throw new Error('Both realm configurations are required');
    }

    this.setupStatus =
      'Upgrading the existing realms to one parent card and three child cards…';
    await this.writeSource(
      parent.realmURL,
      `${parent.realmURL}article-card.gts`,
      EDITORIAL_ARTICLE_CARD_SOURCE,
    );
    await this.writeSource(
      child.realmURL,
      `${child.realmURL}story-modules.gts`,
      EDITORIAL_CHILD_CARDS_SOURCE,
    );
    await this.writeSource(
      child.realmURL,
      `${child.realmURL}security-probe-card.gts`,
      SECURITY_PROBE_CARD_SOURCE,
    );
    await this.writeSource(
      child.realmURL,
      `${child.realmURL}security-probe-program.js`,
      SECURITY_PROBE_PROGRAM_SOURCE,
    );

    await this.ensureCardDocument(
      parent.realmURL,
      `${parent.cardURL}.json`,
      'ArticleCard',
      (attributes) =>
        articleCardDocumentSource(
          parent.label,
          String(attributes.privateValue ?? 'PARENT-PRIVATE-MIGRATED'),
          child.moduleCardURLs!,
        ),
    );
    await this.ensureCardDocument(
      child.realmURL,
      `${child.moduleCardURLs.video}.json`,
      'VideoCard',
      () => videoCardDocumentSource(),
    );
    await this.ensureCardDocument(
      child.realmURL,
      `${child.moduleCardURLs.recipe}.json`,
      'RecipeCard',
      () => recipeCardDocumentSource(),
    );
    await this.ensureCardDocument(
      child.realmURL,
      `${child.moduleCardURLs.comments}.json`,
      'CommentCard',
      (attributes) =>
        commentCardDocumentSource(
          child.label,
          String(attributes.privateValue ?? 'CHILD-PRIVATE-MIGRATED'),
        ),
    );
    if (child.moduleCardURLs.securityProbe) {
      await this.writeSource(
        child.realmURL,
        `${child.moduleCardURLs.securityProbe}.json`,
        securityProbeCardDocumentSource(
          child.label,
          'CHILD-PROBE-PRIVATE',
          child.realmURL,
          parent.cardURL,
        ),
      );
    }

    await Promise.all(configs.map((config) => this.waitForCard(config)));
    if (child.moduleCardURLs.securityProbe) {
      await this.waitForIndexedCard(
        child.realmURL,
        child.moduleCardURLs.securityProbe,
      );
    }
  }

  private async ensureCardDocument(
    realmURL: string,
    targetURL: string,
    expectedCardName: string,
    sourceFor: (attributes: Record<string, unknown>) => string,
  ) {
    assertURLWithinRealm(realmURL, targetURL);
    let response = await this.network.authedFetch(targetURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    let attributes: Record<string, unknown> = {};
    if (response.ok) {
      let document = (await response.json()) as {
        data?: {
          attributes?: Record<string, unknown>;
          meta?: { adoptsFrom?: { name?: string } };
        };
      };
      if (document.data?.meta?.adoptsFrom?.name === expectedCardName) {
        return;
      }
      attributes = document.data?.attributes ?? {};
    }
    await this.writeSource(realmURL, targetURL, sourceFor(attributes));
  }

  @action
  async invoke(index: number, action: 'refresh' | 'increment') {
    let runtime = this.runtimes[index];
    if (!runtime) {
      return;
    }
    this.replacePanel(index, { status: 'working', error: undefined });
    try {
      let view = await runtime.invoke(action);
      this.replacePanel(index, { status: 'ready', view });
    } catch (error) {
      this.replacePanel(index, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @action
  updateNoteDraft(index: number, event: Event) {
    this.replacePanel(index, {
      draftNote: (event.currentTarget as HTMLInputElement).value,
    });
  }

  @action
  setDisplayMode(index: number, displayMode: 'view' | 'edit') {
    this.replacePanel(index, { displayMode });
  }

  @action
  updateAIPrompt(index: number, event: Event) {
    this.replacePanel(index, {
      aiPrompt: (event.currentTarget as HTMLInputElement).value,
    });
  }

  @action
  updateCommentAuthor(event: Event) {
    if (this.childPanelIndex < 0) {
      return;
    }
    this.replacePanel(this.childPanelIndex, {
      commentAuthor: (event.currentTarget as HTMLInputElement).value,
    });
  }

  @action
  updateCommentDraft(event: Event) {
    if (this.childPanelIndex < 0) {
      return;
    }
    this.replacePanel(this.childPanelIndex, {
      commentDraft: (event.currentTarget as HTMLTextAreaElement).value,
    });
  }

  @action
  async saveNote(index: number) {
    let runtime = this.runtimes[index];
    let panel = this.panels[index];
    if (!runtime || !panel) {
      return;
    }
    this.replacePanel(index, { status: 'working', error: undefined });
    try {
      let view = await runtime.invoke('saveNote', panel.draftNote);
      this.replacePanel(index, {
        status: 'ready',
        view,
        draftNote: view.render.editor.value,
      });
    } catch (error) {
      this.replacePanel(index, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @action
  async askAI(index: number) {
    let runtime = this.runtimes[index];
    let panel = this.panels[index];
    if (!runtime || !panel) {
      return;
    }
    this.replacePanel(index, { status: 'working', error: undefined });
    try {
      let view = await runtime.invoke('askAI', panel.aiPrompt);
      this.replacePanel(index, { status: 'ready', view });
      if (panel.role === 'child' && this.delegatedRender) {
        await this.requestDelegatedRender();
      }
    } catch (error) {
      this.replacePanel(index, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @action
  async applyAIRecipeUpdate() {
    let index = this.childPanelIndex;
    let runtime = this.runtimes[index];
    if (!runtime || index < 0) {
      return;
    }
    this.replacePanel(index, { status: 'working', error: undefined });
    try {
      let view = await runtime.invoke('applyAIRecipeUpdate');
      this.replacePanel(index, { status: 'ready', view });
      await this.requestDelegatedRender();
    } catch (error) {
      this.replacePanel(index, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @action
  async submitComment() {
    let index = this.childPanelIndex;
    let runtime = this.runtimes[index];
    let panel = this.panels[index];
    if (!runtime || !panel) {
      return;
    }
    this.replacePanel(index, { status: 'working', error: undefined });
    try {
      let view = await runtime.invoke(
        'submitComment',
        panel.commentAuthor,
        panel.commentDraft,
      );
      this.replacePanel(index, {
        status: 'ready',
        view,
        commentDraft: '',
      });
      await this.requestDelegatedRender();
    } catch (error) {
      this.replacePanel(index, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @action
  async setCommentMode(mode: 'nice' | 'malicious') {
    let index = this.childPanelIndex;
    let runtime = this.runtimes[index];
    let parent = this.panels.find((panel) => panel.role === 'parent');
    if (!runtime || !parent) {
      return;
    }
    this.replacePanel(index, { status: 'working', error: undefined });
    try {
      let view = await runtime.invoke('setCommentMode', mode, parent.cardURL);
      this.replacePanel(index, { status: 'ready', view });
      await this.requestDelegatedRender();
    } catch (error) {
      this.replacePanel(index, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requestDelegatedRender() {
    let parentIndex = this.panels.findIndex((panel) => panel.role === 'parent');
    let childIndex = this.childPanelIndex;
    let parentRuntime = this.runtimes[parentIndex];
    let childRuntime = this.runtimes[childIndex];
    if (!parentRuntime || !childRuntime) {
      throw new Error('Both realm workers are required for delegation');
    }
    let request =
      await parentRuntime.invoke<ParentDelegationRequest>('delegateChild');
    if (request.renderer !== 'child') {
      throw new Error('Parent selected an unknown delegated renderer');
    }
    let props = sanitizeDelegationProps(request.props);
    this.delegatedRender = await childRuntime.invoke<DelegatedRenderModel>(
      'renderDelegated',
      props,
    );
  }

  @action
  async delegateChildRender() {
    let parentIndex = this.panels.findIndex((panel) => panel.role === 'parent');
    let childIndex = this.panels.findIndex((panel) => panel.role === 'child');
    let parentRuntime = this.runtimes[parentIndex];
    let childRuntime = this.runtimes[childIndex];
    if (!parentRuntime || !childRuntime || parentIndex < 0 || childIndex < 0) {
      return;
    }
    this.replacePanel(parentIndex, { status: 'working', error: undefined });
    try {
      await this.requestDelegatedRender();
      this.replacePanel(parentIndex, { status: 'ready' });
    } catch (error) {
      this.replacePanel(parentIndex, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @action
  performAction(index: number, actionId: SpikeRenderAction['id']) {
    switch (actionId) {
      case 'increment':
      case 'refresh':
        void this.invoke(index, actionId);
        return;
      case 'probe-other':
        void this.probeOther(index);
        return;
      case 'delegate-child':
        void this.delegateChildRender();
        return;
    }
  }

  @action
  async probeOther(index: number) {
    let runtime = this.runtimes[index];
    let other = this.panels[index === 0 ? 1 : 0];
    if (!runtime || !other) {
      return;
    }
    this.replacePanel(index, { status: 'working', error: undefined });
    try {
      let view = await runtime.invoke('probeOther', other.cardURL);
      this.replacePanel(index, { status: 'ready', view });
    } catch (error) {
      this.replacePanel(index, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleCapability(
    realmConfig: SpikeRealmConfig,
    request: WorkerCapabilityRequest,
  ) {
    switch (request.operation) {
      case 'read-own-card':
        return await this.readCardSnapshot(realmConfig, realmConfig.cardURL);
      case 'write-own-card':
        return await this.writeOwnCard(
          realmConfig,
          sanitizeOwnCardPatch(request.args[0]),
        );
      case 'read-card':
        return await this.readCardSnapshot(
          realmConfig,
          String(request.args[0] ?? ''),
        );
      case 'read-recipe':
        return await this.readRecipeCard(realmConfig);
      case 'query-own': {
        let cards = await this.store.search<CardDef>(
          spikeCardQuery(realmConfig.realmURL, realmConfig.role),
          [realmConfig.realmURL],
          { cardInitiated: true },
        );
        return cards.map((card) => ({
          id: card.id,
          realmLabel: String(
            (card as CardDef & { realmLabel?: string }).realmLabel ?? '',
          ),
          role:
            (card as CardDef & { role?: string }).role === 'child'
              ? 'child'
              : 'parent',
          privateValue: String(
            (card as CardDef & { privateValue?: string }).privateValue ?? '',
          ),
          note: String((card as CardDef & { note?: string }).note ?? ''),
          counter: Number(
            (card as CardDef & { counter?: number }).counter ?? 0,
          ),
        }));
      }
      case 'run-own-command': {
        let commandName = String(request.args[0] ?? '');
        if (commandName !== 'increment') {
          throw new Error(`Command ${commandName} is not granted`);
        }
        return await this.incrementOwnCard(realmConfig);
      }
      case 'run-recipe-command': {
        let commandName = String(request.args[0] ?? '');
        if (commandName !== 'update-recipe-content') {
          throw new Error(`Recipe command ${commandName} is not granted`);
        }
        return await this.updateRecipeContent(
          realmConfig,
          sanitizeRecipeCommandInput(request.args[1]),
        );
      }
      case 'proxy-fetch': {
        if (!realmConfig.canUseAIProxy) {
          throw new Error('This realm was not granted AI proxy access');
        }
        let targetURL = assertAllowedAIProxyURL(String(request.args[0] ?? ''));
        let init = request.args[1] as
          | { method?: unknown; body?: unknown }
          | undefined;
        if (init?.method !== 'POST' || typeof init.body !== 'string') {
          throw new Error('AI proxy fetch requires a POST body');
        }
        let requestBody = sanitizeAIProxyRequest(JSON.parse(init.body));
        let response = await this.realmServer.requestForward({
          url: targetURL,
          method: 'POST',
          requestBody,
          headers: { 'Content-Type': 'application/json' },
        });
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body: await response.text(),
        };
      }
    }
  }

  private async readCardSnapshot(
    realmConfig: SpikeRealmConfig,
    cardURL: string,
  ): Promise<SpikeCardSnapshot> {
    assertURLWithinRealm(realmConfig.realmURL, cardURL);
    let response = await this.network.authedFetch(`${cardURL}.json`, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(
        `Could not read ${cardURL}: ${response.status} ${await response.text()}`,
      );
    }
    return snapshotFromCardDocument(cardURL, await response.json());
  }

  private recipeCardURL(realmConfig: SpikeRealmConfig) {
    if (realmConfig.role !== 'child' || !realmConfig.moduleCardURLs?.recipe) {
      throw new Error('This card was not granted the RecipeCard capability');
    }
    return assertURLWithinRealm(
      realmConfig.realmURL,
      realmConfig.moduleCardURLs.recipe,
    ).href;
  }

  private async readRecipeCard(realmConfig: SpikeRealmConfig) {
    let cardURL = this.recipeCardURL(realmConfig);
    let response = await this.network.authedFetch(`${cardURL}.json`, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(
        `Could not read RecipeCard: ${response.status} ${await response.text()}`,
      );
    }
    return recipeSnapshotFromCardDocument(cardURL, await response.json());
  }

  private async updateRecipeContent(
    realmConfig: SpikeRealmConfig,
    input: {
      title: string;
      description: string;
      serves: string;
      time: string;
      ingredients: string[];
      steps: string[];
    },
  ) {
    let cardURL = this.recipeCardURL(realmConfig);
    let sourceURL = `${cardURL}.json`;
    let response = await this.network.authedFetch(sourceURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(
        `Could not load RecipeCard command input: ${response.status}`,
      );
    }
    let document = (await response.json()) as {
      data: { attributes: Record<string, unknown> };
    };
    document.data.attributes.title = input.title;
    document.data.attributes.description = input.description;
    document.data.attributes.serves = input.serves;
    document.data.attributes.time = input.time;
    document.data.attributes.ingredients = input.ingredients;
    document.data.attributes.steps = input.steps;
    await this.writeSource(
      realmConfig.realmURL,
      sourceURL,
      JSON.stringify(document, null, 2),
    );
    return recipeSnapshotFromCardDocument(cardURL, document);
  }

  private async incrementOwnCard(realmConfig: SpikeRealmConfig) {
    let sourceURL = `${realmConfig.cardURL}.json`;
    assertURLWithinRealm(realmConfig.realmURL, sourceURL);
    let response = await this.network.authedFetch(sourceURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(`Could not load command input: ${response.status}`);
    }
    let document = (await response.json()) as {
      data: { attributes: Record<string, unknown> };
    };
    document.data.attributes.counter =
      Number(document.data.attributes.counter ?? 0) + 1;
    await this.writeSource(
      realmConfig.realmURL,
      sourceURL,
      JSON.stringify(document, null, 2),
    );
    return true;
  }

  private async writeOwnCard(
    realmConfig: SpikeRealmConfig,
    patch: { note: string },
  ) {
    let sourceURL = `${realmConfig.cardURL}.json`;
    assertURLWithinRealm(realmConfig.realmURL, sourceURL);
    let response = await this.network.authedFetch(sourceURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(`Could not load own card: ${response.status}`);
    }
    let document = (await response.json()) as {
      data: { attributes: Record<string, unknown> };
    };
    document.data.attributes.note = patch.note;
    await this.writeSource(
      realmConfig.realmURL,
      sourceURL,
      JSON.stringify(document, null, 2),
    );
    return true;
  }

  private async writeSource(
    realmURL: string,
    targetURL: string,
    source: string,
  ) {
    assertURLWithinRealm(realmURL, targetURL);
    let response = await this.network.authedFetch(targetURL, {
      method: 'POST',
      headers: CARD_SOURCE_HEADERS,
      body: source,
    });
    if (!response.ok) {
      throw new Error(
        `Could not write ${targetURL}: ${response.status} ${await response.text()}`,
      );
    }
  }

  private async readSource(realmURL: string, targetURL: string) {
    assertURLWithinRealm(realmURL, targetURL);
    let response = await this.network.authedFetch(targetURL, {
      headers: { Accept: SupportedMimeType.CardSource },
    });
    if (!response.ok) {
      throw new Error(
        `Could not read ${targetURL}: ${response.status} ${await response.text()}`,
      );
    }
    return await response.text();
  }

  private async waitForCard(
    realmConfig: SpikeRealmConfig,
    cardURL = realmConfig.cardURL,
  ) {
    let lastError = '';
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await this.readCardSnapshot(realmConfig, cardURL);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await timeout(500);
      }
    }
    throw new Error(`Card did not become readable: ${lastError}`);
  }

  private async waitForIndexedCard(realmURL: string, cardURL: string) {
    assertURLWithinRealm(realmURL, cardURL);
    let lastError = '';
    for (let attempt = 0; attempt < 30; attempt++) {
      let response = await this.network.authedFetch(cardURL, {
        headers: { Accept: SupportedMimeType.CardJson },
      });
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${await response.text()}`;
      await timeout(500);
    }
    throw new Error(`Card did not enter the realm index: ${lastError}`);
  }

  <template>
    {{pageTitle 'Realm isolation spike'}}
    <main class='realm-isolation-spike'>
      <header class='spike-header'>
        <div>
          <p class='eyebrow'>SES card runtime spike</p>
          <h1>One story, two realms, no shared secrets</h1>
          <p class='lede'>
            One real ArticleCard in the parent realm links to three real cards
            in the child realm: VideoCard, RecipeCard with Ask AI, and
            CommentCard. Switch comments into hostile mode to see what the
            capability boundary denies.
          </p>
        </div>
        <dl class='environment'>
          <div><dt>Matrix</dt><dd>{{this.matrixURL}}</dd></div>
          <div><dt>Realm server</dt><dd>{{this.realmServerURL}}</dd></div>
          <div><dt>AI allowlist</dt><dd>{{this.aiProxyURL}}</dd></div>
          <div><dt>User</dt><dd>{{if
                this.matrixUserId
                this.matrixUserId
                'not signed in'
              }}</dd></div>
        </dl>
      </header>

      {{#if this.isLoggedIn}}
        <section class='setup-bar'>
          <button
            type='button'
            disabled={{this.isSettingUp}}
            {{on 'click' this.createRealmPair}}
          >
            {{if
              this.isSettingUp
              'Creating staging realms…'
              'Replace with a new realm pair'
            }}
          </button>
          <p>{{this.setupStatus}}</p>
        </section>

        {{#if this.panels.length}}
          <section class='shared-dom' aria-label='Shared DOM card area'>
            {{#each this.panels key='realmURL' as |panel index|}}
              <article
                class='realm-card realm-card--{{panel.role}}'
                data-realm-principal={{panel.realmURL}}
              >
                <div class='card-header'>
                  <span
                    class='status status--{{panel.status}}'
                  >{{panel.status}}</span>
                  <p class='realm-label'>{{panel.label}}</p>
                  <p class='grant-summary'>
                    storage: own realm · AI proxy:
                    {{if panel.canUseAIProxy 'granted' 'not granted'}}
                  </p>
                  <p class='card-count'>
                    {{if
                      (eq panel.role 'parent')
                      '1 actual card in this realm'
                      '4 actual cards in this realm'
                    }}
                  </p>
                  <a
                    href={{panel.cardURL}}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    {{panel.cardURL}}
                  </a>
                  {{#if (eq panel.role 'child')}}
                    {{#if panel.moduleCardURLs}}
                      <div class='module-card-links'>
                        <a
                          href={{panel.moduleCardURLs.video}}
                          target='_blank'
                          rel='noopener noreferrer'
                        >VideoCard</a>
                        <a
                          href={{panel.moduleCardURLs.recipe}}
                          target='_blank'
                          rel='noopener noreferrer'
                        >RecipeCard + Ask AI</a>
                        <a
                          href={{panel.moduleCardURLs.comments}}
                          target='_blank'
                          rel='noopener noreferrer'
                        >CommentCard</a>
                        {{#if panel.moduleCardURLs.securityProbe}}
                          <a
                            href={{this.interactPath
                              panel.moduleCardURLs.securityProbe
                            }}
                            target='_blank'
                            rel='noopener noreferrer'
                          >Open hostile card in Interact →</a>
                        {{/if}}
                      </div>
                    {{/if}}
                  {{/if}}
                </div>

                {{#if panel.view}}
                  <section
                    class='self-render self-render--{{panel.view.render.theme}}'
                    data-rendered-by={{panel.realmURL}}
                  >
                    <div class='card-mode-toolbar'>
                      <p class='render-origin'>Card template from this card's
                        SES worker</p>
                      <div
                        class='mode-switch'
                        role='group'
                        aria-label='Card display mode'
                      >
                        <button
                          type='button'
                          class='mode-button
                            {{if (eq panel.displayMode "view") "is-active"}}'
                          aria-pressed={{eq panel.displayMode 'view'}}
                          data-card-mode='view'
                          {{on 'click' (fn this.setDisplayMode index 'view')}}
                        >View</button>
                        <button
                          type='button'
                          class='mode-button
                            {{if (eq panel.displayMode "edit") "is-active"}}'
                          aria-pressed={{eq panel.displayMode 'edit'}}
                          data-card-mode='edit'
                          {{on 'click' (fn this.setDisplayMode index 'edit')}}
                        >Edit</button>
                      </div>
                    </div>

                    {{#if (eq panel.displayMode 'view')}}
                      {{#if (eq panel.role 'parent')}}
                        {{#if panel.view.render.article}}
                          {{#let panel.view.render.article as |article|}}
                            <div class='editorial-story card-view'>
                              <div class='editorial-masthead'>
                                <p class='story-section'>{{article.section}}</p>
                                <p
                                  class='story-location'
                                >{{article.location}}</p>
                              </div>
                              <div class='story-hero'>
                                <p class='story-issue'>No. 18 · Autumn</p>
                                <h2>{{article.title}}</h2>
                                <p class='story-dek'>{{article.dek}}</p>
                                <div class='story-byline'>
                                  <span>{{article.byline}}</span>
                                  <span>{{article.published}}</span>
                                  <span>{{article.readTime}}</span>
                                </div>
                              </div>

                              <div class='story-copy'>
                                <p class='story-opening'>{{article.opening}}</p>
                                <p>{{get article.body 0}}</p>

                                {{#if this.delegatedRender}}
                                  {{#let this.delegatedRender as |delegated|}}
                                    <aside
                                      class='delegation-label'
                                      data-rendered-by='child-worker'
                                    >
                                      <span>Child realm module boundary</span>
                                      <span>Received:
                                        {{#each
                                          delegated.receivedKeys
                                          as |key|
                                        }}
                                          <code>{{key}}</code>
                                        {{/each}}
                                      </span>
                                      <span>Parent private state:
                                        {{if
                                          delegated.parentPrivateStateVisible
                                          'visible'
                                          'not delegated'
                                        }}</span>
                                    </aside>

                                    <section
                                      class='story-video child-owned-module'
                                      data-module-owner='child-realm'
                                    >
                                      <img
                                        src={{delegated.modules.recipe.imageURL}}
                                        alt='Fire-roasted tomatoes and white beans beside grilled bread'
                                      />
                                      <div class='video-shade'></div>
                                      <button
                                        type='button'
                                        class='play-button'
                                        aria-label='Play recipe field-notes video'
                                      >▶</button>
                                      <div class='video-copy'>
                                        <p
                                        >{{delegated.modules.video.eyebrow}}</p>
                                        <h3
                                        >{{delegated.modules.video.title}}</h3>
                                        <span
                                        >{{delegated.modules.video.duration}}</span>
                                      </div>
                                    </section>

                                    <p>{{get article.body 1}}</p>
                                    <blockquote
                                    >{{article.pullQuote}}</blockquote>
                                    <p>{{get article.body 2}}</p>

                                    {{#if this.childPanel}}
                                      {{#let this.childPanel as |childPanel|}}
                                        <section
                                          class='story-ai child-owned-module'
                                          data-module-owner='child-realm'
                                        >
                                          <div
                                            class='ai-orbit'
                                            aria-hidden='true'
                                          >✦</div>
                                          <div class='ai-intro'>
                                            <p class='module-eyebrow'>Ask the
                                              story</p>
                                            <h3>A kitchen editor, within bounds</h3>
                                            <p>Uses the child's allowlisted AI
                                              proxy and a read-only projection
                                              of the live RecipeCard. No API key
                                              enters the card.</p>
                                          </div>
                                          <div class='ai-form'>
                                            <label for='story-ai-prompt'>
                                              <span
                                              >{{delegated.modules.ai.label}}</span>
                                            </label>
                                            <div class='inline-form'>
                                              <input
                                                id='story-ai-prompt'
                                                value={{childPanel.aiPrompt}}
                                                placeholder={{delegated.modules.ai.placeholder}}
                                                disabled={{eq
                                                  childPanel.status
                                                  'working'
                                                }}
                                                {{on
                                                  'input'
                                                  (fn
                                                    this.updateAIPrompt
                                                    this.childPanelIndex
                                                  )
                                                }}
                                              />
                                              <button
                                                type='button'
                                                disabled={{eq
                                                  childPanel.status
                                                  'working'
                                                }}
                                                {{on
                                                  'click'
                                                  (fn
                                                    this.askAI
                                                    this.childPanelIndex
                                                  )
                                                }}
                                              >Ask AI</button>
                                            </div>
                                          </div>
                                          <div class='ai-results'>
                                            {{#if delegated.aiResult}}
                                              <p
                                                class='ai-answer'
                                              >{{delegated.aiResult}}</p>
                                            {{/if}}
                                            {{#if delegated.aiProposal}}
                                              <div class='ai-proposal'>
                                                <div class='proposal-content'>
                                                  <p
                                                    class='proposal-label'
                                                  >Proposed RecipeCard update</p>
                                                  <h4
                                                  >{{delegated.aiProposal.title}}</h4>
                                                  <p
                                                    class='proposal-description'
                                                  >{{delegated.aiProposal.description}}</p>
                                                  <div class='proposal-meta'>
                                                    <span
                                                    >{{delegated.aiProposal.serves}}</span>
                                                    <span
                                                    >{{delegated.aiProposal.time}}</span>
                                                  </div>
                                                  <div class='proposal-columns'>
                                                    <div>
                                                      <h5>Ingredients</h5>
                                                      <ul>
                                                        {{#each
                                                          delegated.aiProposal.ingredients
                                                          as |ingredient|
                                                        }}
                                                          <li
                                                          >{{ingredient}}</li>
                                                        {{/each}}
                                                      </ul>
                                                    </div>
                                                    <div>
                                                      <h5>Method</h5>
                                                      <ol>
                                                        {{#each
                                                          delegated.aiProposal.steps
                                                          as |step|
                                                        }}
                                                          <li>{{step}}</li>
                                                        {{/each}}
                                                      </ol>
                                                    </div>
                                                  </div>
                                                </div>
                                                <div class='proposal-action'>
                                                  <p>Nothing changes until you
                                                    approve this proposal.</p>
                                                  <button
                                                    type='button'
                                                    disabled={{eq
                                                      childPanel.status
                                                      'working'
                                                    }}
                                                    {{on
                                                      'click'
                                                      this.applyAIRecipeUpdate
                                                    }}
                                                  >Apply full recipe update</button>
                                                </div>
                                              </div>
                                            {{/if}}
                                            {{#if delegated.recipeUpdateResult}}
                                              <p class='recipe-update-result'>
                                                ✓
                                                {{delegated.recipeUpdateResult}}
                                              </p>
                                            {{/if}}
                                          </div>
                                        </section>

                                        <section
                                          class='story-recipe child-owned-module'
                                          data-module-owner='child-realm'
                                        >
                                          <img
                                            src={{delegated.modules.recipe.imageURL}}
                                            alt='A bowl of fire-roasted tomato and white bean stew with basil and grilled sourdough'
                                          />
                                          <div class='recipe-content'>
                                            <p
                                              class='module-eyebrow'
                                            >{{delegated.modules.recipe.eyebrow}}</p>
                                            <h3
                                            >{{delegated.modules.recipe.title}}</h3>
                                            <p
                                              class='recipe-dek'
                                            >{{delegated.modules.recipe.description}}</p>
                                            <div class='recipe-meta'>
                                              <span
                                              >{{delegated.modules.recipe.serves}}</span>
                                              <span
                                              >{{delegated.modules.recipe.time}}</span>
                                            </div>
                                            <div class='recipe-columns'>
                                              <div>
                                                <h4>Ingredients</h4>
                                                <ul>
                                                  {{#each
                                                    delegated.modules.recipe.ingredients
                                                    as |ingredient|
                                                  }}
                                                    <li>{{ingredient}}</li>
                                                  {{/each}}
                                                </ul>
                                              </div>
                                              <div>
                                                <h4>Method</h4>
                                                <ol>
                                                  {{#each
                                                    delegated.modules.recipe.steps
                                                    as |step|
                                                  }}
                                                    <li>{{step}}</li>
                                                  {{/each}}
                                                </ol>
                                              </div>
                                            </div>
                                          </div>
                                        </section>

                                        <section
                                          class='story-comments child-owned-module
                                            {{if
                                              (eq
                                                delegated.modules.comments.mode
                                                "malicious"
                                              )
                                              "is-malicious"
                                            }}'
                                          data-module-owner='child-realm'
                                        >
                                          <div class='comment-heading'>
                                            <div>
                                              <p class='module-eyebrow'>Reader
                                                notes</p>
                                              <h3>Join the conversation</h3>
                                            </div>
                                            <div
                                              class='threat-toggle'
                                              role='group'
                                              aria-label='Comment module behavior'
                                            >
                                              <button
                                                type='button'
                                                class='{{if
                                                    (eq
                                                      delegated.modules.comments.mode
                                                      "nice"
                                                    )
                                                    "is-active"
                                                  }}'
                                                aria-pressed={{eq
                                                  delegated.modules.comments.mode
                                                  'nice'
                                                }}
                                                {{on
                                                  'click'
                                                  (fn
                                                    this.setCommentMode 'nice'
                                                  )
                                                }}
                                              >Playing nice</button>
                                              <button
                                                type='button'
                                                class='danger-toggle
                                                  {{if
                                                    (eq
                                                      delegated.modules.comments.mode
                                                      "malicious"
                                                    )
                                                    "is-active"
                                                  }}'
                                                aria-pressed={{eq
                                                  delegated.modules.comments.mode
                                                  'malicious'
                                                }}
                                                {{on
                                                  'click'
                                                  (fn
                                                    this.setCommentMode
                                                    'malicious'
                                                  )
                                                }}
                                              >Act malicious</button>
                                            </div>
                                          </div>

                                          {{#if
                                            (eq
                                              delegated.modules.comments.mode
                                              'malicious'
                                            )
                                          }}
                                            <div class='malicious-warning'>
                                              <strong>Malicious card mode active</strong>
                                              <p>The child is dumping everything
                                                its real SES compartment can
                                                observe and attempting
                                                cross-realm reads and arbitrary
                                                network exfiltration.</p>
                                            </div>
                                            <dl class='finding-dump'>
                                              {{#each
                                                delegated.modules.comments.findings
                                                as |finding|
                                              }}
                                                <div
                                                  class='finding finding--{{finding.status}}'
                                                >
                                                  <dt>{{finding.label}}</dt>
                                                  <dd>{{finding.value}}</dd>
                                                </div>
                                              {{/each}}
                                            </dl>
                                          {{else}}
                                            <div class='comment-list'>
                                              {{#each
                                                delegated.modules.comments.comments
                                                as |comment|
                                              }}
                                                <div class='comment'>
                                                  <span
                                                    class='comment-avatar'
                                                    aria-hidden='true'
                                                  >{{comment.author}}</span>
                                                  <div>
                                                    <div class='comment-meta'>
                                                      <strong
                                                      >{{comment.author}}</strong>
                                                      <span
                                                      >{{comment.timestamp}}</span>
                                                    </div>
                                                    <p>{{comment.body}}</p>
                                                  </div>
                                                </div>
                                              {{/each}}
                                            </div>
                                            <div class='comment-form'>
                                              <label>
                                                <span>Name</span>
                                                <input
                                                  value={{childPanel.commentAuthor}}
                                                  placeholder='Your name'
                                                  {{on
                                                    'input'
                                                    this.updateCommentAuthor
                                                  }}
                                                />
                                              </label>
                                              <label>
                                                <span>Comment</span>
                                                <textarea
                                                  value={{childPanel.commentDraft}}
                                                  placeholder='What will you remember from this recipe?'
                                                  {{on
                                                    'input'
                                                    this.updateCommentDraft
                                                  }}
                                                ></textarea>
                                              </label>
                                              <button
                                                type='button'
                                                disabled={{eq
                                                  childPanel.status
                                                  'working'
                                                }}
                                                {{on
                                                  'click'
                                                  this.submitComment
                                                }}
                                              >Publish comment</button>
                                            </div>
                                          {{/if}}
                                        </section>
                                      {{/let}}
                                    {{/if}}
                                  {{/let}}
                                {{else}}
                                  <div class='module-loading'>Mounting
                                    child-realm modules…</div>
                                {{/if}}
                              </div>
                            </div>
                          {{/let}}
                        {{/if}}
                      {{else}}
                        <div class='module-provider card-view'>
                          <div class='card-hero'>
                            <span
                              class='card-role-mark'
                              aria-hidden='true'
                            >C</span>
                            <div>
                              <p class='card-kicker'>Child realm</p>
                              <h2>{{panel.view.render.title}}</h2>
                              <p
                                class='card-subtitle'
                              >{{panel.view.render.subtitle}}</p>
                            </div>
                          </div>
                          <div class='module-manifest'>
                            <div><span aria-hidden='true'>▶</span><strong
                              >Video</strong><small>render data</small></div>
                            <div><span aria-hidden='true'>✦</span><strong>Ask AI</strong><small
                              >proxy grant</small></div>
                            <div><span aria-hidden='true'>♨</span><strong
                              >Recipe</strong><small>render data</small></div>
                            <div><span aria-hidden='true'>☵</span><strong
                              >Comments</strong><small>own-realm write</small></div>
                          </div>
                          <dl class='card-facts'>
                            {{#each panel.view.render.fields as |field|}}
                              <div class='card-fact'>
                                <dt>{{field.label}}</dt>
                                <dd>{{field.value}}</dd>
                              </div>
                            {{/each}}
                            <div class='card-fact'>
                              <dt>Own-realm results</dt>
                              <dd>{{panel.view.queryCount}}</dd>
                            </div>
                          </dl>
                          <div class='actions'>
                            {{#each
                              panel.view.render.actions
                              as |renderAction|
                            }}
                              <button
                                type='button'
                                disabled={{eq panel.status 'working'}}
                                data-spike-action={{renderAction.id}}
                                {{on
                                  'click'
                                  (fn this.performAction index renderAction.id)
                                }}
                              >{{renderAction.label}}</button>
                            {{/each}}
                          </div>
                        </div>
                      {{/if}}
                    {{else}}
                      <section class='default-edit'>
                        <div class='edit-header'>
                          <div>
                            <p class='card-kicker'>Generated form</p>
                            <h2>Default edit template</h2>
                            <p>The trusted host builds this form from the card's
                              field metadata. Only fields allowed by the card
                              capability are writable.</p>
                          </div>
                          <span class='edit-badge'>1 editable field</span>
                        </div>

                        <div class='field-stack'>
                          <label class='field-row'>
                            <span class='field-heading'>
                              <span>Realm label</span>
                              <small>Read only</small>
                            </span>
                            <input
                              value={{panel.view.card.realmLabel}}
                              readonly
                            />
                          </label>
                          <label class='field-row'>
                            <span class='field-heading'>
                              <span>Role</span>
                              <small>Read only</small>
                            </span>
                            <input value={{panel.view.card.role}} readonly />
                          </label>
                          <label class='field-row'>
                            <span class='field-heading'>
                              <span>Private realm value</span>
                              <small>Read only</small>
                            </span>
                            <input
                              value={{panel.view.card.privateValue}}
                              readonly
                            />
                          </label>
                          <label class='field-row'>
                            <span class='field-heading'>
                              <span>Counter</span>
                              <small>Read only</small>
                            </span>
                            <input value={{panel.view.card.counter}} readonly />
                          </label>
                          <label class='field-row field-row--editable'>
                            <span class='field-heading'>
                              <span>{{panel.view.render.editor.label}}</span>
                              <small>Writable in this realm</small>
                            </span>
                            <input
                              value={{panel.draftNote}}
                              disabled={{eq panel.status 'working'}}
                              {{on 'input' (fn this.updateNoteDraft index)}}
                            />
                          </label>
                        </div>

                        <div class='edit-actions'>
                          <button
                            type='button'
                            disabled={{eq panel.status 'working'}}
                            {{on 'click' (fn this.saveNote index)}}
                          >Save into my realm</button>
                          <button
                            type='button'
                            class='secondary-button'
                            {{on 'click' (fn this.setDisplayMode index 'view')}}
                          >Back to view</button>
                        </div>
                      </section>
                    {{/if}}

                    <footer class='security-footer'>
                      <div class='security-heading'>
                        <span aria-hidden='true'>◉</span>
                        <div>
                          <strong>SES authority boundary</strong>
                          <p>Ambient browser capabilities visible to this card</p>
                        </div>
                      </div>
                      <div
                        class='ambient-grid'
                        aria-label='Ambient authority probes'
                      >
                        <span>fetch: {{panel.view.ambient.fetch}}</span>
                        <span>window: {{panel.view.ambient.window}}</span>
                        <span>document: {{panel.view.ambient.document}}</span>
                        <span>localStorage:
                          {{panel.view.ambient.localStorage}}</span>
                        <span>Function escape:
                          {{panel.view.ambient.functionEscapeReachedWindow}}</span>
                      </div>

                      {{#if panel.view.boundary}}
                        <p
                          class='boundary-result boundary-result--{{if
                              panel.view.boundary.allowed
                              "bad"
                              "good"
                            }}'
                        >
                          {{panel.view.boundary.message}}
                        </p>
                      {{/if}}
                    </footer>
                  </section>
                {{/if}}

                {{#if panel.error}}
                  <pre class='error'>{{panel.error}}</pre>
                {{/if}}
              </article>
            {{/each}}
          </section>
        {{else}}
          <section class='empty-state'>
            Create two private realms to run the side-by-side isolation proof.
          </section>
        {{/if}}
      {{else}}
        <section class='login-panel'>
          <h2>Sign in to staging Matrix</h2>
          <p>The spike creates two private test realms owned by this account.</p>
          <MatrixAuth />
        </section>
      {{/if}}
    </main>

    <style scoped>
      .realm-isolation-spike {
        min-height: 100vh;
        padding: 2rem;
        color: #14231e;
        background:
          radial-gradient(circle at top left, #d7f5e7 0, transparent 32rem),
          #f7faf8;
        font-family: system-ui, sans-serif;
      }

      .spike-header {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(18rem, 1fr);
        gap: 2rem;
        max-width: 90rem;
        margin: 0 auto 2rem;
      }

      .eyebrow,
      .realm-label {
        margin: 0 0 0.35rem;
        color: #247255;
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      h1,
      h2,
      p {
        margin-top: 0;
      }

      h1 {
        max-width: 14ch;
        margin-bottom: 0.75rem;
        font-size: clamp(2.4rem, 5vw, 5rem);
        line-height: 0.95;
        letter-spacing: -0.055em;
      }

      .lede {
        max-width: 48rem;
        color: #4d6059;
        font-size: 1.05rem;
        line-height: 1.6;
      }

      .environment,
      .setup-bar,
      .realm-card,
      .empty-state,
      .login-panel {
        border: 1px solid #c9d8d1;
        border-radius: 1rem;
        background: rgb(255 255 255 / 88%);
        box-shadow: 0 1rem 3rem rgb(22 70 52 / 8%);
      }

      .environment {
        align-self: start;
        margin: 0;
        padding: 1rem;
      }

      .environment div,
      .card-data div {
        display: grid;
        grid-template-columns: 7rem minmax(0, 1fr);
        gap: 0.75rem;
        padding: 0.55rem 0;
        border-bottom: 1px solid #e5ece8;
      }

      .environment div:last-child,
      .card-data div:last-child {
        border-bottom: 0;
      }

      dt {
        color: #65766f;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      dd {
        min-width: 0;
        margin: 0;
        overflow-wrap: anywhere;
      }

      .setup-bar,
      .empty-state,
      .login-panel {
        max-width: 90rem;
        margin: 0 auto 1.25rem;
        padding: 1rem;
      }

      .setup-bar {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .setup-bar p {
        margin: 0;
        color: #52635d;
      }

      .shared-dom {
        display: grid;
        grid-template-columns: minmax(0, 2.15fr) minmax(20rem, 0.85fr);
        gap: 1.25rem;
        align-items: start;
        max-width: 96rem;
        margin: 0 auto;
      }

      .realm-card {
        min-width: 0;
        padding: 0.8rem;
        background: #edf3ef;
      }

      .realm-card--parent {
        background: #ede8de;
      }

      .realm-card--child {
        position: sticky;
        top: 1rem;
      }

      .grant-summary,
      .render-origin {
        color: #65766f;
        font-family: ui-monospace, monospace;
        font-size: 0.75rem;
      }

      .card-count {
        margin: 0.45rem 0;
        color: #342f29;
        font-size: 0.8rem;
        font-weight: 800;
      }

      .realm-card .card-header a {
        display: block;
        margin-bottom: 0.8rem;
        color: #247255;
        font-size: 0.78rem;
        overflow-wrap: anywhere;
      }

      .module-card-links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin: 0 0 0.8rem;
      }

      .realm-card .card-header .module-card-links a {
        margin: 0;
        padding: 0.35rem 0.55rem;
        border: 1px solid #b9c8c0;
        border-radius: 999px;
        background: #f7faf8;
        font-size: 0.7rem;
        font-weight: 700;
        text-decoration: none;
      }

      .card-header {
        padding: 0.45rem 0.45rem 0;
      }

      .status {
        float: right;
        padding: 0.25rem 0.55rem;
        border-radius: 999px;
        background: #e8eee9;
        color: #58665f;
        font-size: 0.7rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .status--ready {
        background: #d6f3e5;
        color: #176144;
      }

      .status--error {
        background: #fee2df;
        color: #9b2d25;
      }

      .self-render {
        overflow: hidden;
        border: 1px solid #c8d8d0;
        border-radius: 1.15rem;
        background: #fff;
        box-shadow:
          0 1.25rem 2.5rem rgb(27 65 50 / 10%),
          0 0.15rem 0.4rem rgb(27 65 50 / 8%);
      }

      .self-render--parent {
        --card-accent: #1d7957;
        --card-accent-dark: #12523b;
        --card-tint: #e8f7f0;
        --card-tint-strong: #d1efdf;
      }

      .self-render--child {
        --card-accent: #7357a6;
        --card-accent-dark: #4f3978;
        --card-tint: #f2edfb;
        --card-tint-strong: #e2d7f5;
        border-color: #d8d0ed;
      }

      .card-mode-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.7rem 0.8rem 0.7rem 1.15rem;
        border-bottom: 1px solid #e2e9e5;
        background: #fbfcfb;
      }

      .card-mode-toolbar .render-origin {
        margin: 0;
      }

      .mode-switch {
        display: inline-flex;
        gap: 0.2rem;
        padding: 0.2rem;
        border: 1px solid #d5ded9;
        border-radius: 0.7rem;
        background: #eef2ef;
      }

      .mode-button {
        min-width: 3.75rem;
        padding: 0.42rem 0.7rem;
        border-radius: 0.5rem;
        background: transparent;
        color: #52615a;
        font-size: 0.78rem;
        box-shadow: none;
      }

      .mode-button:hover {
        color: var(--card-accent-dark);
      }

      .mode-button.is-active {
        background: #fff;
        color: var(--card-accent-dark);
        box-shadow: 0 0.1rem 0.3rem rgb(31 57 47 / 15%);
      }

      .card-view,
      .default-edit {
        padding: 1.4rem;
      }

      .editorial-story.card-view {
        padding: 0;
        background: #fffdf8;
      }

      .editorial-masthead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1.05rem 2rem;
        border-bottom: 1px solid #ded7ca;
        color: #615a4e;
        font-family: ui-monospace, monospace;
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .editorial-masthead p {
        margin: 0;
      }

      .story-section {
        color: #a4412f;
        font-weight: 850;
      }

      .story-hero {
        padding: clamp(2.5rem, 6vw, 5rem) clamp(1.5rem, 6vw, 5.5rem) 3rem;
        background:
          linear-gradient(
            120deg,
            rgb(255 253 248 / 96%),
            rgb(255 253 248 / 72%)
          ),
          radial-gradient(circle at 85% 18%, #e5c8a6 0, transparent 34rem);
      }

      .story-issue,
      .module-eyebrow {
        margin: 0 0 1rem;
        color: #a4412f;
        font-size: 0.7rem;
        font-weight: 850;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .story-hero h2 {
        max-width: 15ch;
        margin: 0;
        color: #201d19;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(3rem, 6.8vw, 6.8rem);
        font-weight: 500;
        letter-spacing: -0.055em;
        line-height: 0.91;
      }

      .story-dek {
        max-width: 42rem;
        margin: 1.8rem 0;
        color: #5b554c;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(1.2rem, 2vw, 1.65rem);
        line-height: 1.45;
      }

      .story-byline {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem 1.2rem;
        color: #696158;
        font-size: 0.74rem;
        font-weight: 750;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .story-byline span + span::before {
        margin-right: 1.2rem;
        color: #c3b9a8;
        content: '•';
      }

      .story-copy {
        padding: clamp(2rem, 5vw, 4.5rem) clamp(1.5rem, 7vw, 6.5rem);
        color: #312d27;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.08rem;
        line-height: 1.82;
      }

      .story-copy > p,
      .story-copy > blockquote {
        max-width: 42rem;
        margin-right: auto;
        margin-left: auto;
      }

      .story-opening {
        font-size: 1.35rem;
        line-height: 1.65;
      }

      .story-opening::first-letter {
        float: left;
        margin: 0.08em 0.12em 0 0;
        color: #a4412f;
        font-size: 4.5em;
        line-height: 0.76;
      }

      .story-copy blockquote {
        margin-top: 3.5rem;
        margin-bottom: 3.5rem;
        padding: 1.6rem 0;
        border-top: 1px solid #cdbda7;
        border-bottom: 1px solid #cdbda7;
        color: #8b3a2b;
        font-size: clamp(1.8rem, 3vw, 2.65rem);
        font-style: italic;
        line-height: 1.18;
        text-align: center;
      }

      .delegation-label {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem 1rem;
        max-width: 50rem;
        margin: 2.5rem auto 0.8rem;
        padding: 0.65rem 0.8rem;
        border: 1px dashed #9d8abc;
        border-radius: 0.6rem;
        background: #f7f3fc;
        color: #66567d;
        font-family: ui-monospace, monospace;
        font-size: 0.64rem;
        line-height: 1.45;
      }

      .delegation-label span:first-child {
        font-weight: 850;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .delegation-label code {
        margin-left: 0.3rem;
      }

      .child-owned-module {
        position: relative;
        max-width: 50rem;
        margin: 1rem auto 3.5rem;
        border: 1px solid #d9d0e7;
        border-radius: 1rem;
        background: #fff;
        box-shadow: 0 1.25rem 3rem rgb(55 42 30 / 12%);
        font-family: system-ui, sans-serif;
      }

      .child-owned-module::before {
        position: absolute;
        z-index: 2;
        top: 0.75rem;
        right: 0.75rem;
        padding: 0.28rem 0.48rem;
        border-radius: 999px;
        background: rgb(63 45 91 / 82%);
        color: white;
        content: 'child realm';
        font-family: ui-monospace, monospace;
        font-size: 0.58rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .story-video {
        height: clamp(19rem, 42vw, 31rem);
        overflow: hidden;
        border: 0;
        color: white;
      }

      .story-video img,
      .story-recipe > img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .video-shade {
        position: absolute;
        inset: 0;
        background: linear-gradient(0deg, rgb(19 13 9 / 82%), transparent 68%);
      }

      .play-button {
        position: absolute;
        top: 50%;
        left: 50%;
        display: grid;
        width: 4.6rem;
        height: 4.6rem;
        padding: 0 0 0 0.25rem;
        place-items: center;
        border: 1px solid rgb(255 255 255 / 70%);
        border-radius: 50%;
        background: rgb(255 255 255 / 18%);
        backdrop-filter: blur(0.5rem);
        transform: translate(-50%, -50%);
      }

      .play-button:hover {
        transform: translate(-50%, -50%) scale(1.04) !important;
      }

      .video-copy {
        position: absolute;
        right: 1.5rem;
        bottom: 1.5rem;
        left: 1.5rem;
      }

      .video-copy p {
        margin-bottom: 0.25rem;
        font-size: 0.65rem;
        font-weight: 850;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .video-copy h3 {
        max-width: 25rem;
        margin: 0;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(1.5rem, 3vw, 2.4rem);
        line-height: 1.05;
      }

      .video-copy span {
        position: absolute;
        right: 0;
        bottom: 0;
        font-family: ui-monospace, monospace;
        font-size: 0.75rem;
      }

      .story-ai {
        display: grid;
        grid-template-areas:
          'orbit intro form'
          '. results results';
        grid-template-columns: auto minmax(0, 0.75fr) minmax(16rem, 1.25fr);
        gap: 1rem;
        align-items: center;
        padding: 1.4rem;
        background: linear-gradient(135deg, #1f1930, #3e2c5d);
        color: white;
      }

      .story-ai::before {
        background: #d4bdf8;
        color: #312249;
      }

      .ai-orbit {
        display: grid;
        grid-area: orbit;
        width: 3rem;
        height: 3rem;
        place-items: center;
        border: 1px solid rgb(255 255 255 / 35%);
        border-radius: 50%;
        background: rgb(255 255 255 / 10%);
        color: #dcc9fa;
        font-size: 1.2rem;
      }

      .ai-intro h3 {
        margin: 0 0 0.25rem;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.35rem;
      }

      .ai-intro p:last-child {
        margin: 0;
        color: #cec5dc;
        font-size: 0.75rem;
        line-height: 1.5;
      }

      .story-ai .module-eyebrow {
        margin-bottom: 0.25rem;
        color: #d8c2f8;
      }

      .story-ai label {
        display: grid;
        gap: 0.4rem;
        font-size: 0.7rem;
        font-weight: 750;
      }

      .story-ai input {
        color: #231a2e;
      }

      .story-ai input::placeholder {
        color: #776d7e;
      }

      .ai-form {
        display: grid;
        grid-area: form;
        gap: 0.4rem;
      }

      .ai-intro {
        grid-area: intro;
      }

      .inline-form {
        display: flex;
        gap: 0.45rem;
      }

      .inline-form input {
        width: 100%;
        flex: 1 1 auto;
        min-width: 0;
      }

      .inline-form button {
        flex: 0 0 auto;
        background: #d8c0f8;
        color: #2e2044;
      }

      .ai-results {
        display: grid;
        grid-area: results;
        gap: 0.8rem;
        min-width: 0;
      }

      .ai-answer {
        margin: 0;
        padding: 0.75rem;
        border-left: 2px solid #d8c0f8;
        background: rgb(255 255 255 / 8%);
        color: #eee8f5;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 0.95rem;
      }

      .ai-proposal {
        display: grid;
        gap: 1rem;
        padding: 1rem;
        border: 1px solid rgb(216 192 248 / 45%);
        border-radius: 0.85rem;
        background: rgb(255 255 255 / 7%);
      }

      .proposal-label {
        margin: 0 0 0.5rem;
        color: #dcc9fa;
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .proposal-content h4 {
        margin: 0 0 0.35rem;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.15rem;
      }

      .proposal-description,
      .proposal-action p {
        margin: 0;
        color: #d8d0e2;
        font-size: 0.76rem;
        line-height: 1.5;
      }

      .proposal-meta {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.65rem;
      }

      .proposal-meta span {
        padding: 0.28rem 0.5rem;
        border: 1px solid rgb(216 192 248 / 35%);
        border-radius: 999px;
        color: #eee8f5;
        font-size: 0.7rem;
        font-weight: 750;
      }

      .proposal-columns {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        margin-top: 0.85rem;
      }

      .proposal-columns h5 {
        margin: 0 0 0.35rem;
        color: #dcc9fa;
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .ai-proposal ul,
      .ai-proposal ol {
        margin: 0;
        padding-left: 1.1rem;
        color: #f1edf5;
        font-size: 0.82rem;
        line-height: 1.55;
      }

      .proposal-action {
        display: flex;
        gap: 1rem;
        align-items: center;
        justify-content: space-between;
        padding-top: 0.8rem;
        border-top: 1px solid rgb(216 192 248 / 22%);
      }

      .ai-proposal button {
        flex: 0 0 auto;
        border-color: #f1c87c;
        background: #f1c87c;
        color: #312249;
        font-weight: 800;
      }

      .recipe-update-result {
        margin: 0;
        padding: 0.7rem 0.85rem;
        border-radius: 0.65rem;
        background: rgb(113 214 157 / 16%);
        color: #bff0d1;
        font-size: 0.8rem;
        font-weight: 700;
      }

      .story-recipe {
        display: grid;
        grid-template-columns: minmax(16rem, 0.9fr) minmax(0, 1.1fr);
        overflow: hidden;
        background: #f5efe3;
      }

      .story-recipe::before {
        background: #6b382b;
      }

      .story-recipe > img {
        min-height: 100%;
      }

      .recipe-content {
        padding: clamp(1.5rem, 4vw, 3rem);
      }

      .recipe-content h3 {
        margin: 0;
        color: #33251d;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2rem, 3.5vw, 3.25rem);
        font-weight: 500;
        letter-spacing: -0.04em;
        line-height: 0.98;
      }

      .recipe-dek {
        color: #66564a;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 0.95rem;
        line-height: 1.55;
      }

      .recipe-meta {
        display: flex;
        gap: 1.25rem;
        padding: 0.65rem 0;
        border-top: 1px solid #cfc1ad;
        border-bottom: 1px solid #cfc1ad;
        color: #7d4132;
        font-size: 0.72rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .recipe-columns {
        display: grid;
        grid-template-columns: 0.85fr 1.15fr;
        gap: 1.4rem;
        margin-top: 1.25rem;
        color: #554a41;
        font-size: 0.76rem;
        line-height: 1.5;
      }

      .recipe-columns h4 {
        margin: 0 0 0.6rem;
        color: #2f2924;
        font-size: 0.7rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .recipe-columns ul,
      .recipe-columns ol {
        margin: 0;
        padding-left: 1.1rem;
      }

      .recipe-columns li + li {
        margin-top: 0.45rem;
      }

      .story-comments {
        padding: clamp(1.25rem, 3vw, 2rem);
        transition:
          border-color 180ms ease,
          background 180ms ease,
          color 180ms ease;
      }

      .comment-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding-bottom: 1.15rem;
        border-bottom: 1px solid #e5dfd7;
      }

      .comment-heading .module-eyebrow {
        margin-bottom: 0.2rem;
      }

      .comment-heading h3 {
        margin: 0;
        color: #292521;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.65rem;
      }

      .threat-toggle {
        display: flex;
        gap: 0.2rem;
        padding: 0.2rem;
        border: 1px solid #d7d1c8;
        border-radius: 0.65rem;
        background: #f2efea;
      }

      .threat-toggle button {
        padding: 0.45rem 0.62rem;
        background: transparent;
        color: #675f56;
        font-size: 0.68rem;
        box-shadow: none;
      }

      .threat-toggle button.is-active {
        background: white;
        color: #2d4f40;
        box-shadow: 0 0.12rem 0.35rem rgb(45 38 31 / 13%);
      }

      .threat-toggle .danger-toggle.is-active {
        background: #8f1717;
        color: white;
      }

      .comment-list {
        display: grid;
        gap: 1rem;
        margin: 1.25rem 0;
      }

      .comment {
        display: grid;
        grid-template-columns: 2.35rem minmax(0, 1fr);
        gap: 0.75rem;
      }

      .comment-avatar {
        display: grid;
        width: 2.35rem;
        height: 2.35rem;
        overflow: hidden;
        place-items: center;
        border-radius: 50%;
        background: #e5dded;
        color: transparent;
        font-size: 0;
      }

      .comment-avatar::after {
        color: #634c7a;
        content: 'R';
        font-size: 0.78rem;
        font-weight: 850;
      }

      .comment-meta {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
        color: #312b27;
        font-size: 0.78rem;
      }

      .comment-meta span {
        color: #8a8178;
        font-size: 0.66rem;
      }

      .comment p {
        margin: 0.25rem 0 0;
        color: #5e554e;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 0.88rem;
        line-height: 1.55;
      }

      .comment-form {
        display: grid;
        grid-template-columns: minmax(10rem, 0.35fr) minmax(0, 0.65fr) auto;
        gap: 0.65rem;
        align-items: end;
        padding-top: 1.15rem;
        border-top: 1px solid #e5dfd7;
      }

      .comment-form label {
        display: grid;
        gap: 0.35rem;
        color: #5c554e;
        font-size: 0.7rem;
        font-weight: 750;
      }

      textarea {
        width: 100%;
        min-height: 2.7rem;
        box-sizing: border-box;
        padding: 0.65rem 0.75rem;
        resize: vertical;
        border: 1px solid #b9cac2;
        border-radius: 0.5rem;
        background: white;
        color: inherit;
        font: inherit;
      }

      .story-comments.is-malicious {
        border-color: #c11f1f;
        background: #430d0d;
        color: #fff1f1;
        box-shadow: 0 1.25rem 3rem rgb(104 0 0 / 28%);
      }

      .story-comments.is-malicious::before {
        background: #ff3b30;
        content: 'hostile child';
      }

      .is-malicious .comment-heading {
        border-color: #7d2b2b;
      }

      .is-malicious .comment-heading h3,
      .is-malicious .module-eyebrow {
        color: #fff;
      }

      .is-malicious .threat-toggle {
        border-color: #7d2b2b;
        background: #2e0909;
      }

      .is-malicious .threat-toggle button {
        color: #f2baba;
      }

      .malicious-warning {
        margin: 1rem 0;
        padding: 0.85rem;
        border: 1px solid #d44a4a;
        border-radius: 0.65rem;
        background: #731414;
      }

      .malicious-warning strong {
        font-size: 0.8rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .malicious-warning p {
        margin: 0.3rem 0 0;
        color: #ffd4d4;
        font-size: 0.75rem;
        line-height: 1.5;
      }

      .finding-dump {
        display: grid;
        gap: 0.5rem;
        margin: 0;
      }

      .finding {
        display: grid;
        grid-template-columns: minmax(8rem, 0.3fr) minmax(0, 0.7fr);
        gap: 0.75rem;
        padding: 0.65rem;
        border: 1px solid #7f2929;
        border-radius: 0.55rem;
        background: #2c0909;
        font-family: ui-monospace, monospace;
        font-size: 0.68rem;
      }

      .finding dt {
        color: #ffadad;
      }

      .finding dd {
        color: #ffe5e5;
      }

      .finding--blocked {
        border-left: 0.25rem solid #66d39b;
      }

      .finding--visible,
      .finding--granted {
        border-left: 0.25rem solid #ffb13b;
      }

      .module-loading {
        max-width: 42rem;
        margin: 2rem auto;
        padding: 1rem;
        border: 1px dashed #b9adc9;
        border-radius: 0.75rem;
        color: #6d5d82;
        font-family: ui-monospace, monospace;
        font-size: 0.75rem;
        text-align: center;
      }

      .module-manifest {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem;
        margin-bottom: 1rem;
      }

      .module-manifest div {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.1rem 0.55rem;
        padding: 0.7rem;
        border: 1px solid #ddd5e9;
        border-radius: 0.7rem;
        background: #faf8fd;
      }

      .module-manifest span {
        grid-row: span 2;
        color: #7456a0;
      }

      .module-manifest strong {
        color: #40334e;
        font-size: 0.78rem;
      }

      .module-manifest small {
        color: #81758d;
        font-size: 0.64rem;
      }

      .card-hero {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        margin: -1.4rem -1.4rem 1.3rem;
        padding: 1.45rem 1.4rem 1.35rem;
        background:
          radial-gradient(
            circle at 90% 10%,
            rgb(255 255 255 / 72%),
            transparent 38%
          ),
          var(--card-tint);
      }

      .card-role-mark,
      .feature-icon {
        display: grid;
        flex: 0 0 auto;
        place-items: center;
        border-radius: 0.8rem;
        background: var(--card-accent);
        color: #fff;
        font-weight: 850;
      }

      .card-role-mark {
        width: 2.85rem;
        height: 2.85rem;
        font-size: 1.15rem;
        box-shadow: 0 0.45rem 1rem
          color-mix(in srgb, var(--card-accent) 25%, transparent);
      }

      .card-kicker,
      .section-kicker {
        margin: 0 0 0.22rem;
        color: var(--card-accent-dark);
        font-size: 0.68rem;
        font-weight: 850;
        letter-spacing: 0.11em;
        text-transform: uppercase;
      }

      .card-hero h2,
      .edit-header h2 {
        margin-bottom: 0.3rem;
        color: #17261f;
        font-size: 1.55rem;
        line-height: 1.15;
        letter-spacing: -0.025em;
      }

      .card-subtitle,
      .edit-header p {
        margin: 0;
        color: #53655d;
        line-height: 1.5;
      }

      .card-facts {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.65rem;
        margin: 0;
      }

      .card-fact {
        min-width: 0;
        padding: 0.8rem;
        border: 1px solid #e0e8e4;
        border-radius: 0.75rem;
        background: #fcfdfc;
      }

      .card-fact dt {
        margin-bottom: 0.28rem;
      }

      .card-fact dd {
        color: #23372e;
        font-size: 0.9rem;
        line-height: 1.4;
      }

      .section-heading,
      .security-heading {
        display: flex;
        align-items: center;
        gap: 0.7rem;
      }

      .section-heading {
        margin-bottom: 0.85rem;
      }

      .section-heading h3 {
        margin: 0;
        color: #26382f;
        font-size: 1rem;
      }

      .section-heading .section-kicker {
        margin-bottom: 0.08rem;
      }

      .feature-icon {
        width: 2.1rem;
        height: 2.1rem;
        border-radius: 0.65rem;
      }

      .ai-box label {
        display: grid;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
        color: #41544c;
        font-size: 0.78rem;
        font-weight: 700;
      }

      input {
        width: 100%;
        box-sizing: border-box;
        padding: 0.65rem 0.75rem;
        border: 1px solid #b9cac2;
        border-radius: 0.5rem;
        background: white;
        color: inherit;
        font: inherit;
        transition:
          border-color 120ms ease,
          box-shadow 120ms ease;
      }

      input:focus {
        border-color: var(--card-accent);
        outline: 0;
        box-shadow: 0 0 0 0.2rem
          color-mix(in srgb, var(--card-accent) 18%, transparent);
      }

      input[readonly] {
        border-color: #dde5e1;
        background: #f4f7f5;
        color: #64736c;
      }

      .ai-box,
      .delegated-render {
        margin: 1rem 0 0;
        padding: 1rem;
        border: 1px solid color-mix(in srgb, var(--card-accent) 28%, white);
        border-radius: 0.85rem;
        background: color-mix(in srgb, var(--card-tint) 72%, white);
      }

      .ai-result {
        margin: 0.75rem 0 0;
        padding: 0.65rem;
        border-radius: 0.5rem;
        background: white;
      }

      .delegated-render {
        border-color: #c9bce8;
        background: #f8f5fd;
      }

      .delegated-render dl {
        margin-bottom: 0;
      }

      .delegated-render dl div {
        display: grid;
        grid-template-columns: 11rem minmax(0, 1fr);
        gap: 0.75rem;
        padding: 0.4rem 0;
      }

      .delegated-render code {
        margin-right: 0.35rem;
      }

      .default-edit {
        background:
          linear-gradient(#fff, #fff) padding-box,
          var(--card-tint);
      }

      .edit-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 1.25rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #e3eae6;
      }

      .edit-badge {
        flex: 0 0 auto;
        padding: 0.35rem 0.55rem;
        border-radius: 999px;
        background: var(--card-tint-strong);
        color: var(--card-accent-dark);
        font-size: 0.7rem;
        font-weight: 800;
      }

      .field-stack {
        display: grid;
        gap: 0.75rem;
      }

      .field-row {
        display: grid;
        gap: 0.4rem;
        padding: 0.8rem;
        border: 1px solid #e0e7e3;
        border-radius: 0.75rem;
        background: #fbfcfb;
      }

      .field-row--editable {
        border-color: color-mix(in srgb, var(--card-accent) 42%, white);
        background: color-mix(in srgb, var(--card-tint) 55%, white);
      }

      .field-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        color: #34483e;
        font-size: 0.78rem;
        font-weight: 750;
      }

      .field-heading small {
        color: #74827b;
        font-size: 0.66rem;
        font-weight: 650;
      }

      .field-row--editable .field-heading small {
        color: var(--card-accent-dark);
      }

      .edit-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        margin-top: 1rem;
      }

      .secondary-button {
        border: 1px solid #cdd8d2;
        background: #fff;
        color: #40534a;
      }

      .security-footer {
        padding: 1rem 1.4rem 1.2rem;
        border-top: 1px solid #e0e8e4;
        background: #f7f9f8;
      }

      .security-heading {
        margin-bottom: 0.75rem;
        color: #3c5147;
      }

      .security-heading > span {
        color: #2d8a65;
        font-size: 0.75rem;
      }

      .security-heading strong {
        display: block;
        font-size: 0.78rem;
      }

      .security-heading p {
        margin: 0.1rem 0 0;
        color: #6b7972;
        font-size: 0.7rem;
      }

      .ambient-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.5rem;
      }

      .ambient-grid span {
        padding: 0.55rem;
        border-radius: 0.5rem;
        background: #eff4f1;
        font-family: ui-monospace, monospace;
        font-size: 0.75rem;
      }

      .boundary-result {
        margin: 0.75rem 0 0;
        padding: 0.75rem;
        border-radius: 0.6rem;
        font-family: ui-monospace, monospace;
        font-size: 0.78rem;
        overflow-wrap: anywhere;
      }

      .boundary-result--good {
        border: 1px solid #8bd4b4;
        background: #e1f7ed;
        color: #155b40;
      }

      .boundary-result--bad,
      .error {
        border: 1px solid #f0aaa3;
        background: #fff0ee;
        color: #942d26;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
        margin-top: 1rem;
      }

      button {
        padding: 0.65rem 0.85rem;
        border: 0;
        border-radius: 0.55rem;
        background: #1f6f52;
        color: white;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        transition:
          transform 120ms ease,
          box-shadow 120ms ease;
      }

      button:not(:disabled):not(.mode-button):hover {
        transform: translateY(-1px);
        box-shadow: 0 0.4rem 0.8rem rgb(25 70 52 / 16%);
      }

      button:disabled {
        cursor: wait;
        opacity: 0.55;
      }

      .actions button:last-child {
        background: var(--card-accent-dark);
      }

      .error {
        padding: 0.75rem;
        border-radius: 0.6rem;
        white-space: pre-wrap;
      }

      @media (max-width: 55rem) {
        .spike-header,
        .shared-dom {
          grid-template-columns: 1fr;
        }

        .realm-card--child {
          position: static;
        }

        .story-ai,
        .story-recipe {
          grid-template-columns: 1fr;
        }

        .story-ai {
          grid-template-areas:
            'orbit'
            'intro'
            'form'
            'results';
          align-items: start;
        }

        .proposal-columns {
          grid-template-columns: 1fr;
        }

        .story-recipe > img {
          max-height: 28rem;
        }

        .comment-form {
          grid-template-columns: 1fr;
        }

        .realm-isolation-spike {
          padding: 1rem;
        }
      }

      @media (max-width: 32rem) {
        .card-mode-toolbar,
        .edit-header {
          align-items: stretch;
          flex-direction: column;
        }

        .mode-switch {
          align-self: stretch;
        }

        .mode-button {
          flex: 1;
        }

        .card-facts,
        .ambient-grid,
        .recipe-columns,
        .module-manifest,
        .finding {
          grid-template-columns: 1fr;
        }

        .story-byline span + span::before {
          display: none;
        }

        .story-ai {
          padding-top: 3.2rem;
        }

        .proposal-action {
          align-items: stretch;
          flex-direction: column;
        }

        .comment-heading {
          align-items: stretch;
          flex-direction: column;
        }

        .threat-toggle {
          align-self: stretch;
        }

        .threat-toggle button {
          flex: 1;
        }

        .edit-badge {
          align-self: flex-start;
        }
      }
    </style>
  </template>
}

export default RouteTemplate(RealmIsolationSpike);
