// The shell's Ember application: a route for each of the shell's pages
// (`pages.js`), each rendering that page's component. The router keeps the
// address in step with the page through the History API, so a move between
// pages the shell makes itself (the key page and the pages reached from it)
// is a route transition, and the back button returns to the page before.
//
// Every module the app is built from is named in `registry`, which the
// resolver looks names up in and nowhere else: nothing outside this package
// is resolved, and a name the registry doesn't hold falls back to Ember's own
// defaults.
import Application from '@ember/application';
import type { TemplateOnlyComponent as TOC } from '@ember/component/template-only';
import { getOwner } from '@ember/owner';
import Route from '@ember/routing/route';
import EmberRouter from '@ember/routing/router';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { schedule } from '@ember/runloop';

import ConnectPage from './keys/connect-page.gts';
import ConnectedPage from './keys/connected-page.gts';
import EnterKeyPage from './keys/enter-key-page.gts';
import KeyPage from './keys/key-page.gts';
import ReplaceKeyPage from './keys/replace-key-page.gts';
import ShareKeyPage from './keys/share-key-page.gts';
import SwapKeyPage from './keys/swap-key-page.gts';
import { useRouter } from './navigation.js';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
} from './password-reset/pages.gts';
import { RegisterPage, VerifyEmailPage } from './register/pages.gts';
import CliAuthPage from './sign-in/cli-auth-page.gts';
import CliSignInPage from './sign-in/cli-sign-in-page.gts';
import GoogleCallback from './sign-in/google-callback.gts';
import SignInPage from './sign-in/sign-in-page.gts';
import SignOutPage from './sign-in/sign-out-page.gts';
import { pageOpened, pageRendered } from './telemetry.ts';
import { shellPath } from './urls.js';

class Router extends EmberRouter {
  location = 'history';
  // The shell's address, whichever of its pages the document was loaded at.
  rootURL = shellPath();
}

// The routes' paths are `pages.js`'s `PAGE_PATHS`, and a key's share page at
// `keys/<key id>/share`; the realm server serves the shell at those paths, and
// the policy test checks each draws its own page.
Router.map(function () {
  this.route('sign-in');
  this.route('cli-sign-in');
  this.route('cli-auth');
  this.route('sign-out');
  this.route('register');
  this.route('verify-email');
  this.route('forgot-password');
  this.route('reset-password');
  this.route('google-callback');
  this.route('keys', function () {
    this.route('add');
    this.route('share', { path: '/:key_id/share' });
  });
  this.route('enter-key');
  this.route('share-key');
  this.route('swap-key');
  this.route('replace-key');
  this.route('connect');
  this.route('connected');
});

// The application route starts once, on the document's first transition: it
// hands navigation the router, and tells the telemetry about that page and
// every page opened after it, and when each has rendered.
class ApplicationRoute extends Route {
  beforeModel(transition: Transition) {
    let router = getOwner(this)!.lookup('service:router') as RouterService;
    useRouter(router);
    pageOpened(transition.to?.name);
    router.on('routeWillChange', (next: Transition) => {
      // The document's first transition was reported above.
      if (next.from) {
        pageOpened(next.to?.name);
      }
    });
    router.on('routeDidChange', () => schedule('afterRender', pageRendered));
  }
}

// The share page for the key its path names. The route's model is its
// parameters, as there is no store to find a key in.
class KeyShareRoute extends Route {
  model(params: { key_id: string }) {
    return params;
  }
}

const KeyAddTemplate: TOC<object> = <template>
  <EnterKeyPage @fromKeyPage={{true}} />
</template>;

const KeyShareTemplate: TOC<{ Args: { model: { key_id: string } } }> =
  <template><ShareKeyPage @keyId={{@model.key_id}} /></template>;

const registry: Record<string, unknown> = {
  'router:main': Router,
  'route:application': ApplicationRoute,
  'route:keys/share': KeyShareRoute,
  'template:index': KeyPage,
  'template:sign-in': SignInPage,
  'template:cli-sign-in': CliSignInPage,
  'template:cli-auth': CliAuthPage,
  'template:sign-out': SignOutPage,
  'template:register': RegisterPage,
  'template:verify-email': VerifyEmailPage,
  'template:forgot-password': ForgotPasswordPage,
  'template:reset-password': ResetPasswordPage,
  'template:google-callback': GoogleCallback,
  'template:keys/index': KeyPage,
  'template:keys/add': KeyAddTemplate,
  'template:keys/share': KeyShareTemplate,
  'template:enter-key': EnterKeyPage,
  'template:share-key': ShareKeyPage,
  'template:swap-key': SwapKeyPage,
  'template:replace-key': ReplaceKeyPage,
  'template:connect': ConnectPage,
  'template:connected': ConnectedPage,
};

class ShellApplication extends Application {
  Resolver = {
    create: () => ({
      resolve(fullName: string) {
        let [type, name] = fullName.split(':');
        return registry[`${type}:${name!.replace(/\./g, '/')}`];
      },
    }),
  } as unknown as Application['Resolver'];
}

// Boots the app into `root`.
export function startShell(root: Element) {
  ShellApplication.create({ rootElement: root });
}
