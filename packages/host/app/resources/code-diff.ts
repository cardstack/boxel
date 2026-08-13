import { registerDestructor } from '@ember/destroyable';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-modify-based-class-resource';

import type CardService from '@cardstack/host/services/card-service';
import type ToolService from '@cardstack/host/services/tool-service';

import ApplySearchReplaceBlockTool from '../tools/apply-search-replace-block';

import type { CodePatchStatus } from '@cardstack/base/matrix-event';

interface CodeDiffResourceArgs {
  named: {
    fileUrl?: string | null;
    searchReplaceBlock?: string | null;
    codePatchStatus?: CodePatchStatus | null;
  };
}

export class CodeDiffResource extends Resource<CodeDiffResourceArgs> {
  fileUrl: string | undefined | null = null;
  @tracked originalCode: string | undefined | null = null;
  @tracked modifiedCode: string | undefined | null = null;
  searchReplaceBlock: string | undefined | null = null;
  @tracked errorMessage: string | undefined | null = null;
  codePatchStatus: CodePatchStatus | undefined | null = null;

  // Deliberately untracked: `modify` consults this to decide whether a load is
  // already under way, and consuming tracked state there would re-enter
  // `modify` every time the load changed it. The template reads the task's own
  // `isRunning` instead, which is tracked and safe to render from.
  private loadInFlight = false;
  private abortController: AbortController | undefined;

  @service declare private cardService: CardService;
  @service declare private toolService: ToolService;

  constructor(owner: object) {
    super(owner);
    registerDestructor(this, () => this.abortController?.abort());
  }

  modify(_positional: never[], named: CodeDiffResourceArgs['named']) {
    let { fileUrl, searchReplaceBlock, codePatchStatus } = named;
    let fileOrPatchChanged =
      this.fileUrl !== fileUrl ||
      this.searchReplaceBlock !== searchReplaceBlock;
    let appliedStateChanged =
      this.codePatchStatus !== codePatchStatus &&
      (this.codePatchStatus === 'applied' || codePatchStatus === 'applied');
    let inputsChanged = fileOrPatchChanged || appliedStateChanged;

    this.fileUrl = fileUrl;
    this.searchReplaceBlock = searchReplaceBlock;
    this.codePatchStatus = codePatchStatus;

    // These arguments are recomputed on every invalidation of the room
    // resource, which during streaming arrives continuously — so `modify` runs
    // far more often than anything about this diff actually changes. Only a
    // change to what is being diffed justifies discarding what we have and
    // starting again. Restarting on every invalidation cancelled the load
    // mid-flight and cleared the error along with it, leaving the resource
    // holding neither code nor a message to show, and asking the realm for the
    // file again each time it happened.
    if (!inputsChanged) {
      if (this.isDataLoaded || this.errorMessage || this.loadInFlight) {
        return;
      }
    } else {
      this.originalCode = null;
      this.modifiedCode = null;
      this.errorMessage = null;
    }

    if (!fileUrl) {
      this.errorMessage = 'Missing file URL in the code block';
      return;
    }

    if (!searchReplaceBlock) {
      this.errorMessage = 'Missing search and replace block';
      return;
    }

    this.load.perform();
  }

  get isDataLoaded() {
    return this.originalCode != null && this.modifiedCode != null;
  }

  // True between starting a load and having something to show for it, so a
  // patch whose diff has not arrived can say so rather than render as nothing.
  get isLoadingDiff() {
    return this.load.isRunning && !this.isDataLoaded && !this.errorMessage;
  }

  private load = restartableTask(async () => {
    // Cancelling the task does not cancel a request already in flight, so
    // without this an abandoned load runs to completion and its answer is
    // merely discarded — the work still reaches the realm.
    this.abortController?.abort();
    let abortController = new AbortController();
    this.abortController = abortController;
    this.loadInFlight = true;
    try {
      await this.loadDiff(abortController.signal);
    } finally {
      // Only the newest run owns the flag. A superseded run settling later must
      // not report that loading has finished on behalf of the one that replaced
      // it.
      if (this.abortController === abortController) {
        this.loadInFlight = false;
      }
    }
  });

  private async loadDiff(signal: AbortSignal) {
    let { fileUrl, searchReplaceBlock, codePatchStatus } = this;
    if (codePatchStatus === 'applied') {
      this.originalCode = null;
      this.modifiedCode = null;
      // We currently don't show the diff for applied code patches.
      // Showing the diff for applied code patches won't work since in the
      // current code below we try to apply the patch against the original code,
      // but in this case the patch has already been applied.
      // We could make it work if we replaced the this.cardService.getSource below
      // with fetch of the matrix hosted attached file. But we deliberately
      // decided not to do that, and show the "// existing code ... " "// new code ... "
      // formatting instead. We decided to do that to avoid potential performance problems
      // when loading big chats with many code patches.
      return;
    }
    if (!fileUrl || !searchReplaceBlock) {
      return;
    }
    try {
      let result = await this.cardService.getSource(new URL(fileUrl), {
        signal,
      });
      if (result.status === 404) {
        this.originalCode = ''; // We are creating a new file, so we don't have the original code
      } else {
        this.originalCode = result.content;
      }
    } catch (error) {
      if (signal.aborted) {
        // Superseded by a newer load, or the resource went away. Neither is a
        // failure to report.
        return;
      }
      this.errorMessage = `Failed to load code from ${fileUrl}`;
      return;
    }

    let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockTool(
      this.toolService.toolContext,
    );

    try {
      let { resultContent: patchedCode } =
        await applySearchReplaceBlockCommand.execute({
          fileContent: this.originalCode,
          codeBlock: searchReplaceBlock,
        });
      this.modifiedCode = patchedCode;
    } catch (error) {
      this.modifiedCode = this.originalCode;
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    }
  }
}

export function getCodeDiffResultResource(
  parent: object,
  getNamedArgs: () => CodeDiffResourceArgs['named'],
) {
  return CodeDiffResource.from(parent, () => ({
    named: getNamedArgs(),
  }));
}
