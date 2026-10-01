import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { DemoPage } from 'choreo-gallery/components/demo-page';
import { Gallery } from 'choreo-gallery/components/gallery';
import { SiteFrame } from 'choreo-gallery/components/site-frame';
import {
  SagradaFrameStage,
  SylvaFrameStage,
  TowersFrameStage,
} from 'choreo-gallery/components/special-stages';
import { configureAssetRoot } from 'choreo-gallery/config/environment';
import {
  createCatalog,
  type DemoEntry,
  type SpecialStages,
} from 'choreo-gallery/lib/catalog';
import { beginNavigation } from 'choreo-gallery/lib/crossing';
import { configureNavigation } from 'choreo-gallery/lib/host-navigation';
import { modifier } from 'ember-modifier';
import { setMotionSpeed } from 'glimmer-motion';

interface Signature {
  Args: {
    assetRoot?: string | URL;
    stages?: SpecialStages;
  };
}

/**
 * The host-neutral, single-document gallery application.
 *
 * Boxel maps every public path to one CardDef instance. This component keeps
 * navigation inside that mounted card so Choreo sees gallery ⇄ detail as one
 * render pass; direct loads and browser history still use real URLs.
 */
export class GallerySite extends Component<Signature> {
  readonly catalog: DemoEntry[];
  @tracked private demoId: string | null;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args);
    configureAssetRoot(args.assetRoot);
    this.catalog = createCatalog(
      args.stages ?? {
        SagradaStage: SagradaFrameStage,
        SylvaStage: SylvaFrameStage,
        TowerStage: TowersFrameStage,
      },
    );
    this.demoId = this.idFromLocation();
    configureNavigation(this.navigate, this.hrefFor);
    this.applyTitle();
    registerDestructor(this, () => configureAssetRoot(undefined));
  }

  private idFromLocation() {
    if (typeof location === 'undefined') {
      return null;
    }
    const tail = decodeURIComponent(
      location.pathname.replace(/\/+$/, '').split('/').pop() ?? '',
    );
    return this.catalog.some((demo) => demo.id === tail) ? tail : null;
  }

  private get basePath() {
    if (typeof location === 'undefined') {
      return '/';
    }
    const path = location.pathname;
    // Boxel prerenders cards under an internal /render/ URL. Public links
    // must point to the realm, never that transient rendering endpoint.
    if (path.startsWith('/render/') && this.args.assetRoot) {
      return new URL(String(this.args.assetRoot)).pathname;
    }
    if (!this.demoId) {
      return path.endsWith('/') ? path : `${path}/`;
    }
    const encoded = encodeURIComponent(this.demoId);
    const suffix = `/${encoded}`;
    const base = path.endsWith(suffix) ? path.slice(0, -encoded.length) : '/';
    return base.endsWith('/') ? base : `${base}/`;
  }

  get currentDemo() {
    return this.demoId
      ? this.catalog.find((demo) => demo.id === this.demoId)
      : undefined;
  }

  hrefFor = (id: string | null) =>
    id ? `${this.basePath}${encodeURIComponent(id)}` : this.basePath;

  private applyTitle() {
    if (typeof document === 'undefined') {
      return;
    }
    const demo = this.demoId
      ? this.catalog.find((entry) => entry.id === this.demoId)
      : undefined;
    document.title = demo ? `${demo.title} · Choreo` : 'Choreo';
  }

  navigate = (id: string | null) => {
    if (id === this.demoId) {
      if (id === null) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    beginNavigation(this.demoId, id);
    history.pushState({ choreoDemo: id }, '', this.hrefFor(id));
    this.demoId = id;
    setMotionSpeed(1);
    this.applyTitle();
  };

  private history = modifier(() => {
    const onPopState = () => {
      const id = this.idFromLocation();
      if (id === this.demoId) {
        return;
      }
      beginNavigation(this.demoId, id);
      this.demoId = id;
      setMotionSpeed(1);
      this.applyTitle();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  <template>
    <div {{this.history}}>
      <SiteFrame
        @homeActive={{if this.currentDemo false true}}
        @homeHref={{this.hrefFor null}}
        @navigateHome={{fn this.navigate null}}
      >
        {{#if this.currentDemo}}
          <DemoPage
            @catalog={{this.catalog}}
            @hrefFor={{this.hrefFor}}
            @model={{this.currentDemo}}
            @navigate={{this.navigate}}
          />
        {{else}}
          <Gallery
            @catalog={{this.catalog}}
            @hrefFor={{this.hrefFor}}
            @navigate={{this.navigate}}
          />
        {{/if}}
      </SiteFrame>
    </div>
  </template>
}
