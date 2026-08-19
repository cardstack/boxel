import type {
  AffinityType,
  FileExtractResponse,
  FileRenderArgs,
  FileRenderResponse,
  RenderResponse,
  RenderRouteOptions,
} from '@cardstack/runtime-common';
import type { Prerenderer as ServerPrerenderer } from '../../prerender/index.ts';

type PoolMeta = {
  pageId: string;
  affinityType: AffinityType;
  affinityValue: string;
  reused: boolean;
  evicted: boolean;
  timedOut: boolean;
};

type VisitOpts = { timeoutMs?: number; simulateTimeoutMs?: number };

type Wrapped<R> = {
  response: R;
  timings: {
    launchMs: number;
    renderMs: number;
    waits?: { semaphoreMs: number; tabQueueMs: number; tabStartupMs: number };
  };
  pool: PoolMeta;
};

type BaseArgs = {
  affinityType: AffinityType;
  affinityValue: string;
  realm: string;
  url: string;
  auth: string;
  opts?: VisitOpts;
  renderOptions?: RenderRouteOptions;
};

export async function prerenderCard(
  prerenderer: ServerPrerenderer,
  args: BaseArgs,
): Promise<Wrapped<RenderResponse>> {
  let result = await prerenderer.prerenderVisit({
    ...args,
    renderOptions: { ...(args.renderOptions ?? {}), cardRender: true },
  });
  if (!result.response.card) {
    throw new Error(
      `prerenderCard helper: visit returned no card payload${
        result.response.pageUnusableError?.error?.message
          ? `: ${result.response.pageUnusableError.error.message}`
          : ''
      }`,
    );
  }
  return {
    response: result.response.card,
    timings: result.timings,
    pool: result.pool,
  };
}

export async function prerenderFileExtract(
  prerenderer: ServerPrerenderer,
  args: BaseArgs,
): Promise<Wrapped<FileExtractResponse>> {
  let result = await prerenderer.prerenderVisit({
    ...args,
    renderOptions: { ...(args.renderOptions ?? {}), fileExtract: true },
  });
  if (!result.response.fileExtract) {
    throw new Error(
      `prerenderFileExtract helper: visit returned no fileExtract payload${
        result.response.pageUnusableError?.error?.message
          ? `: ${result.response.pageUnusableError.error.message}`
          : ''
      }`,
    );
  }
  return {
    response: result.response.fileExtract,
    timings: result.timings,
    pool: result.pool,
  };
}

export async function prerenderFileRender(
  prerenderer: ServerPrerenderer,
  args: BaseArgs & {
    fileData: FileRenderArgs['fileData'];
    types: string[];
  },
): Promise<Wrapped<FileRenderResponse>> {
  let result = await prerenderer.prerenderVisit({
    ...args,
    renderOptions: { ...(args.renderOptions ?? {}), fileRender: true },
  });
  if (!result.response.fileRender) {
    throw new Error(
      `prerenderFileRender helper: visit returned no fileRender payload${
        result.response.pageUnusableError?.error?.message
          ? `: ${result.response.pageUnusableError.error.message}`
          : ''
      }`,
    );
  }
  return {
    response: result.response.fileRender,
    timings: result.timings,
    pool: result.pool,
  };
}
