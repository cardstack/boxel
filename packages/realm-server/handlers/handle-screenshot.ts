import type Koa from 'koa';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { screenshotCard } from '../scripts/screenshot-card';
import type { BrowserType, CardFormat } from '../scripts/screenshot-card';
import type { CreateRoutesArgs } from '../routes';

const VALID_FORMATS: CardFormat[] = ['isolated', 'embedded', 'fitted', 'atom'];
const VALID_BROWSERS: BrowserType[] = ['chromium', 'firefox', 'webkit'];

export function handleScreenshot(args: CreateRoutesArgs) {
  return async (ctxt: Koa.Context, _next: Koa.Next): Promise<void> => {
    let request = await fetchRequestFromContext(ctxt);
    let body: any;
    try {
      body = await request.json();
    } catch {
      return sendResponseForBadRequest(ctxt, 'Invalid JSON body');
    }

    const { cardUrl, format, browser } = body ?? {};

    if (!cardUrl || typeof cardUrl !== 'string') {
      return sendResponseForBadRequest(ctxt, 'cardUrl is required');
    }

    if (!format || !VALID_FORMATS.includes(format)) {
      return sendResponseForBadRequest(
        ctxt,
        `format must be one of: ${VALID_FORMATS.join(', ')}`,
      );
    }

    if (browser !== undefined && !VALID_BROWSERS.includes(browser)) {
      return sendResponseForBadRequest(
        ctxt,
        `browser must be one of: ${VALID_BROWSERS.join(', ')}`,
      );
    }

    try {
      const hostAppUrl = args.assetsURL.href.replace(/\/$/, '');
      const realmToken = request.headers.get('Authorization') ?? undefined;
      const buffer = await screenshotCard({
        cardUrl,
        hostAppUrl,
        format: format as CardFormat,
        browser: browser as BrowserType | undefined,
        realmToken,
      });

      await setContextResponse(
        ctxt,
        new Response(buffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      );
    } catch (error) {
      return sendResponseForSystemError(
        ctxt,
        `Failed to screenshot card: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}
