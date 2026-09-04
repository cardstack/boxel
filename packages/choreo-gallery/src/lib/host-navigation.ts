import { tracked } from '@glimmer/tracking';

let navigate: (id: string | null) => void = () => {};
let hrefFor: (id: string | null) => string = () => './';
export function configureNavigation(go: typeof navigate, href: typeof hrefFor) {
  navigate = go;
  hrefFor = href;
}
export function routeId(
  route: string,
  models?: string[],
  model?: string,
): string | null {
  return route === 'index'
    ? null
    : route === 'demo'
      ? (models?.[0] ?? model ?? null)
      : route;
}
export const router = {
  transitionTo(route: string, model?: string) {
    navigate(routeId(route, undefined, model));
    // Sylva's Ember route is its full theater. In Boxel keep the same live
    // frame and use the gallery's theater layout rather than nesting a site.
    if (route === 'sylva') {
      theater.enter(true);
    }
    return Promise.resolve();
  },
};
export function href(route: string, models?: string[], model?: string) {
  return hrefFor(routeId(route, models, model));
}
export class Theater {
  @tracked on = false;
  private follow = () => {
    this.on = window.location.hash === '#theater';
  };
  attach() {
    this.follow();
    window.addEventListener('popstate', this.follow);
    window.addEventListener('hashchange', this.follow);
  }
  detach() {
    window.removeEventListener('popstate', this.follow);
    window.removeEventListener('hashchange', this.follow);
    this.on = false;
  }
  enter(on: boolean) {
    this.on = on;
    const url = new URL(location.href);
    url.hash = on ? 'theater' : '';
    history.pushState(null, '', url);
  }
  toggle = () => this.enter(!this.on);
}
export const theater = new Theater();
