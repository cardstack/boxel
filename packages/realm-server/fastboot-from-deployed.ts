//@ts-expect-error no types for fastboot
import FastBoot from 'fastboot';
import { dirSync as tmpDirSync } from 'tmp';
import { ensureFileSync, writeFileSync, writeJSONSync } from 'fs-extra';
import { join } from 'path';
import { JSDOM } from 'jsdom';

interface FastBootOptions {
  resilient?: boolean;
  request?: {
    headers?: {
      host?: string;
    };
  };
}

type DOMContents = () => {
  head: string;
  body: string;
};

interface FastBootVisitResult {
  html(): string;
  domContents(): DOMContents;
}

export interface FastBootInstance {
  visit(url: string, opts?: FastBootOptions): Promise<FastBootVisitResult>;
}

// This is mostly cribbed from
// https://github.com/ember-fastboot/ember-cli-fastboot/blob/master/packages/fastboot/src/html-entrypoint.js

export async function instantiateFastBoot(
  appName: string,
  distURL: URL,
  buildSandboxGlobals: (defaultGlobals: any) => any,
): Promise<{ fastboot: FastBootInstance; distPath: string }> {
  let pkgJSONHref = new URL('./package.json', distURL).href;
  let pkgJSON = await (await fetch(pkgJSONHref)).json();
  let pkgFastboot = pkgJSON?.fastboot;
  if (!pkgFastboot) {
    throw new Error(
      `${distURL.href} does not appear to be an ember app built for fastboot, ${pkgJSONHref} doesn't contain 'fastboot' entry`,
    );
  }
  if (pkgFastboot.schemaVersion < 5) {
    throw new Error(
      `${distURL.href} is built for fastboot schema version that is less than the supported version "5"`,
    );
  }
  let htmlEntrypointHref = new URL(pkgFastboot.htmlEntrypoint, distURL).href;
  let html = await (await fetch(htmlEntrypointHref)).text();
  let dom = new JSDOM(html);
  let config = {};
  for (let element of dom.window.document.querySelectorAll('meta')) {
    mergeContent(element, config, '/config/environment');
    let fastbootMerged = mergeContent(
      element,
      config,
      '/config/fastboot-environment',
    );
    if (fastbootMerged) {
      element.remove();
    }
  }

  let scripts: { local: string; remote: string }[] = [];
  let rootURL = getRootURL(appName, config);
  let distPath = tmpDirSync().name;

  for (let element of dom.window.document.querySelectorAll(
    'script,fastboot-script',
  )) {
    let src = extractSrc(element);
    if (src && !extractIgnore(element)) {
      let relativeSrc = urlWithin(src, rootURL);
      if (relativeSrc) {
        scripts.push({
          local: join(distPath, relativeSrc),
          remote: new URL(`./${relativeSrc}`, distURL).href,
        });
      } else if (element.tagName === 'FASTBOOT-SCRIPT') {
        scripts.push({
          local: join(distPath, src),
          remote: new URL(src, distURL).href,
        });
      }
    }
    if (element.tagName === 'FASTBOOT-SCRIPT') {
      removeWithWhitespaceTrim(element);
    }
  }

  writeJSONSync(join(distPath, 'package.json'), pkgJSON);
  writeFileSync(join(distPath, pkgFastboot.htmlEntrypoint), html);
  for (let { local, remote } of scripts) {
    ensureFileSync(local);
    let script = await (await fetch(remote)).text();
    writeFileSync(local, script);
  }

  return {
    fastboot: new FastBoot({
      distPath,
      resilient: false,
      buildSandboxGlobals,
    }) as FastBootInstance,
    distPath,
  };
}

function mergeContent(
  metaElement: HTMLMetaElement,
  config: any,
  configName: string,
) {
  let name = metaElement.getAttribute('name');
  if (name && name.endsWith(configName)) {
    let content = JSON.parse(
      decodeURIComponent(metaElement.getAttribute('content')!),
    );
    content.APP = Object.assign({ autoboot: false }, content.APP);
    config[name.slice(0, -1 * configName.length)] = content;
    return true;
  }
  return false;
}

function getRootURL(appName: string, config: any) {
  let rootURL = (config[appName] && config[appName].rootURL) || '/';
  if (!rootURL.endsWith('/')) {
    rootURL = rootURL + '/';
  }
  return rootURL;
}

function extractSrc(element: Element) {
  if (element.hasAttribute('data-fastboot-src')) {
    let src = element.getAttribute('data-fastboot-src');
    element.removeAttribute('data-fastboot-src');
    return src;
  } else {
    return element.getAttribute('src');
  }
}

function extractIgnore(element: Element) {
  if (element.hasAttribute('data-fastboot-ignore')) {
    element.removeAttribute('data-fastboot-ignore');
    return true;
  }
  return false;
}

function urlWithin(candidate: string, root: string) {
  let candidateURL = new URL(candidate, 'http://_the_current_origin_');
  let rootURL = new URL(root, 'http://_the_current_origin_');
  if (candidateURL.href.startsWith(rootURL.href)) {
    return candidateURL.href.slice(rootURL.href.length);
  }
  return;
}

// removes an element, and if that element was on a line by itself with nothing
// but whitespace, removes the whole line. The extra whitespace would otherwise
// be harmless but ugly.
function removeWithWhitespaceTrim(element: Element) {
  let prev = element.previousSibling;
  let next = element.nextSibling;
  if (
    prev &&
    next &&
    prev.nodeType == prev.TEXT_NODE &&
    next.nodeType === next.TEXT_NODE
  ) {
    let prevMatch = prev.textContent?.match(/\n\s*$/);
    let nextMatch = next.textContent?.match(/^(\s*\n)/);
    if (prevMatch && nextMatch && prevMatch.index != null) {
      prev.textContent =
        prev.textContent?.slice(0, prevMatch.index + 1) ?? null;
      next.textContent = next.textContent?.slice(nextMatch[0].length) ?? null;
    }
  }
  element.remove();
}
