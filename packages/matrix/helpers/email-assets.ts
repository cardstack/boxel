import { readFileSync } from 'fs';
import { join } from 'path';
import type { BrowserContext, Frame, Request } from '@playwright/test';
import { mailHost } from './index.ts';

// The Synapse email and validation-page templates
// (support/synapse/templates/_base.html) load web fonts and the Boxel logo
// from the internet. Those stylesheets block rendering, so when one of them is
// slow the email shows as a blank pane in the mail client and the screenshot
// assertions fail. These are the bytes the browser received for each URL,
// served locally so the screenshots no longer depend on those hosts.
const assetsDir = join(import.meta.dirname, '..', 'support', 'email-assets');

const EXTERNAL_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.cdnfonts.com',
  'd12nxmpmo97fii.cloudfront.net',
];

const ASSETS: Record<string, { file: string; contentType: string }> = {
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400': {
    file: 'poppins-400.css',
    contentType: 'text/css; charset=utf-8',
  },
  'https://fonts.googleapis.com/css2?family=Poppins:wght@700': {
    file: 'poppins-700.css',
    contentType: 'text/css; charset=utf-8',
  },
  'https://fonts.googleapis.com/css?family=Open%20Sans': {
    file: 'open-sans.css',
    contentType: 'text/css; charset=utf-8',
  },
  'https://fonts.cdnfonts.com/css/arial-2': {
    file: 'arial-2.css',
    contentType: 'text/css; charset=utf-8',
  },
  'https://fonts.gstatic.com/s/poppins/v24/pxiEyp8kv8JHgFVrJJfecg.woff2': {
    file: 'pxiEyp8kv8JHgFVrJJfecg.woff2',
    contentType: 'font/woff2',
  },
  'https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7Z1xlFQ.woff2': {
    file: 'pxiByp8kv8JHgFVrLCz7Z1xlFQ.woff2',
    contentType: 'font/woff2',
  },
  'https://d12nxmpmo97fii.cloudfront.net/boxel-icon.png': {
    file: 'boxel-icon.png',
    contentType: 'image/png',
  },
};

const SYNAPSE_PAGE = /^https?:\/\/[^/]+\/_(matrix|synapse)\//;

// The route is on the whole browser context, so host pages that load from these
// hosts reach it too, such as a card theme's web font. Only requests from the
// mail client (and the email in its iframe) or a page Synapse serves come from
// the templates.
function isFromEmailTemplate(request: Request): boolean {
  let frame: Frame | null;
  try {
    frame = request.frame();
  } catch {
    // service worker requests have no frame
    return false;
  }
  for (; frame; frame = frame.parentFrame()) {
    let url = frame.url();
    if (url.startsWith(mailHost) || SYNAPSE_PAGE.test(url)) {
      return true;
    }
  }
  return false;
}

export async function routeEmailAssets(context: BrowserContext) {
  await context.route(
    (url) => EXTERNAL_HOSTS.includes(url.hostname),
    async (route) => {
      let request = route.request();
      let url = request.url();
      let asset = ASSETS[url];
      if (!asset) {
        if (!isFromEmailTemplate(request)) {
          // Not the templates' request: leave it to the network as before.
          await route.fallback();
          return;
        }
        // A template now asks for something not stored here. Answer quickly
        // so nothing waits on the network, and say so in the test output.
        console.warn(
          `email template asset not stored locally, answering 404: ${url} (add it to helpers/email-assets.ts)`,
        );
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: asset.contentType,
        headers: { 'access-control-allow-origin': '*' },
        body: readFileSync(join(assetsDir, asset.file)),
      });
    },
  );
}
