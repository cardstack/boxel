import { registerDestructor } from '@ember/destroyable';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import config from 'choreo-gallery/config/environment';

export class RawDocumentFrame extends Component<{
  Args: { route: string; title: string };
  Element: HTMLIFrameElement;
}> {
  @tracked source?: string;
  @tracked error?: string;
  private abort = new AbortController();
  constructor(owner: unknown, args: { route: string; title: string }) {
    super(owner as never, args);
    registerDestructor(this, () => this.abort.abort());
    void this.load();
  }
  private async load() {
    try {
      const base = new URL(`${config.rootURL}iframe/`, document.baseURI);
      const read = async (path: string) => {
        const response = await fetch(new URL(path, base), {
          signal: this.abort.signal,
          headers: { Accept: 'application/vnd.card+source' },
        });
        if (!response.ok) {
          throw new Error(`${path}: ${response.status}`);
        }
        return response.text();
      };
      const html = (await read('index.html')).replace(
        /(<meta name="test-app\/config\/environment" content=")([^"]+)(")/,
        (_match, start, encoded, end) => {
          const environment = JSON.parse(decodeURIComponent(encoded));
          environment.rootURL = base.pathname;
          return start + encodeURIComponent(JSON.stringify(environment)) + end;
        },
      );
      let picture = '';
      const name = this.args.route;
      if (name === 'sagrada' || name === 'towers') {
        const [model, three] = await Promise.all([
          read(`asset/${name}-model.html`),
          read(`asset/${name}/three-149.js`),
        ]);
        picture = model
          .replace(/\b(?:window\.)?location\.search/g, "'?host'")
          .replace(
            /<head[^>]*>/i,
            (match) =>
              `${match}<base href="${base.href}asset/"><script>window.__choreoFetch=(url,init)=>window.parent.__choreoFetch(url,init);</script>`,
          )
          .replace(/\bfetch\(/g, 'window.__choreoFetch(')
          .replace(
            new RegExp(
              `<script\\s+src=["']${name}/three-149\\.js["']><\\/script>`,
              'i',
            ),
            `<script>(function(module,exports,define){${three.replaceAll('</script>', '<\\/script>')}\n}).call(window);</script>`,
          );
      }
      const bootstrap = `<base href="${base.href}"><script>
        window.__choreoPicture=${JSON.stringify(picture).replaceAll('<', '\\u003c')};
        window.__choreoFetch=(input,init)=>fetch(new URL(input,document.baseURI),init);
        location.hash=${JSON.stringify(`/${name}?embed`)};
      </script>`;
      this.source = html.replace(/<head[^>]*>/i, (match) => match + bootstrap);
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.error = String(error);
      }
    }
  }
  <template>
    {{#if this.source}}
      <iframe
        title={{@title}}
        srcdoc={{this.source}}
        sandbox='allow-scripts allow-same-origin allow-pointer-lock'
        allow='autoplay; fullscreen'
        allowfullscreen
        ...attributes
      ></iframe>
    {{else if this.error}}
      <p role='alert'>Unable to load the film: {{this.error}}</p>
    {{else}}
      <p role='status'>Loading the film…</p>
    {{/if}}
  </template>
}
