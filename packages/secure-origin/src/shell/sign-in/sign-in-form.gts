// The app's sign-in page on the secure origin: the sign-in screen with an
// email address or username and a password typed into it. Everything here is
// typed into, and sent from, this window; a session it signs in is handed to
// `@onSignedIn`, never to the page that opened the window.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  beginGoogleSignIn,
  googleSignInConfig,
  signInWithPassword,
} from '../../security/session.js';
import type { Session } from '../../security/session.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import AuthFormField from '../../components/auth-form-field.gts';
import BoxelInput from '../../components/input.gts';
import { bool } from '../../helpers/truth-helpers.ts';
import SignInScreen from '../../screens/sign-in.gts';
import { navigation } from '../navigation.js';
import { asSentence, signInFailed } from '../sign-in-copy.js';
import { cliParams, pageURL } from '../urls.js';

import { autofocus } from '../../modifiers/autofocus.ts';

type Config = ReturnType<typeof import('../../security/session.js').readConfig>;

interface Signature {
  Args: {
    config: Config;
    // 'window' for the window's own session, 'cli' for one handed to the CLI.
    client: 'window' | 'cli';
    cli?: CliCallback;
    username?: string;
    onSignedIn: (session: Session) => void;
    // The page's heading, for a page that signs in for something other than
    // the app, such as the CLI's; the sign-in's own when not given.
    title?: string;
  };
  // What signing in grants, under the heading, in place of the line
  // inviting a new user to start with Google.
  Blocks: { intro: [] };
}

// The fields a password sign-in types into.
const Fields: TemplateOnlyComponent<{
  Args: {
    username: string;
    password: string;
    onUsername: (value: string) => void;
    onPassword: (value: string) => void;
    focusUsername: boolean;
    focusPassword: boolean;
  };
}> = <template>
  <AuthFormField
    @label='Email Address or Username'
    data-test-secure-field='username'
  >
    <BoxelInput
      @type='text'
      @autocomplete='username'
      @placeholder='Your email address'
      @value={{@username}}
      @onInput={{@onUsername}}
      name='username'
      data-test-secure-username
      {{autofocus @focusUsername}}
    />
  </AuthFormField>
  <AuthFormField @label='Password' data-test-secure-field='password'>
    <BoxelInput
      @type='password'
      @autocomplete='current-password'
      @placeholder='Your password'
      @value={{@password}}
      @onInput={{@onPassword}}
      name='password'
      data-test-secure-password
      {{autofocus @focusPassword}}
    />
  </AuthFormField>
</template>;

export default class SignInForm extends Component<Signature> {
  <template>
    {{! A named block can't be passed on only when given, so the screen is
        drawn with or without the caller's intro. }}
    {{#if (has-block 'intro')}}
      <SignInScreen
        @title={{@title}}
        @google={{bool this.state.google}}
        @googleSubtitle={{bool this.state.google}}
        @startingGoogle={{this.state.startingGoogle}}
        @submitDisabled={{this.submitDisabled}}
        @submitting={{this.state.submitting}}
        @error={{this.state.error}}
        @onSubmit={{this.submit}}
        @onGoogle={{this.startGoogle}}
        @onForgotPassword={{this.forgotPassword}}
        @onRegister={{this.register}}
      >
        <:intro>{{yield to='intro'}}</:intro>
        <:default>
          <Fields
            @username={{this.state.username}}
            @password={{this.state.password}}
            @onUsername={{this.setUsername}}
            @onPassword={{this.setPassword}}
            @focusUsername={{this.focusUsername}}
            @focusPassword={{this.focusPassword}}
          />
        </:default>
      </SignInScreen>
    {{else}}
      <SignInScreen
        @title={{@title}}
        @google={{bool this.state.google}}
        @googleSubtitle={{bool this.state.google}}
        @startingGoogle={{this.state.startingGoogle}}
        @submitDisabled={{this.submitDisabled}}
        @submitting={{this.state.submitting}}
        @error={{this.state.error}}
        @onSubmit={{this.submit}}
        @onGoogle={{this.startGoogle}}
        @onForgotPassword={{this.forgotPassword}}
        @onRegister={{this.register}}
      >
        <Fields
          @username={{this.state.username}}
          @password={{this.state.password}}
          @onUsername={{this.setUsername}}
          @onPassword={{this.setPassword}}
          @focusUsername={{this.focusUsername}}
          @focusPassword={{this.focusPassword}}
        />
      </SignInScreen>
    {{/if}}
  </template>

  private state = trackedObject({
    username: this.args.username ?? '',
    password: '',
    submitting: false,
    error: undefined as string | undefined,
    google: undefined as unknown,
    startingGoogle: false,
  });

  // The username the CLI suggested is filled in, so the password is what's
  // left to type.
  private focusUsername = !this.args.username;
  private focusPassword = Boolean(this.args.username);

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.offerGoogle();
  }

  private async offerGoogle() {
    this.state.google = await googleSignInConfig(this.args.config);
  }

  // Sign In waits for both fields, as the app's does.
  private get submitDisabled() {
    return (
      this.state.submitting ||
      !this.state.username.trim() ||
      !this.state.password
    );
  }

  // The pages a sign-in links to carry the CLI along, so finishing there
  // still hands the CLI its session.
  private get pageParams() {
    return cliParams(this.args.cli, this.args.username);
  }

  // Typing clears an error.
  private setUsername = (value: string) => {
    this.state.username = value;
    this.state.error = undefined;
  };

  private setPassword = (value: string) => {
    this.state.password = value;
    this.state.error = undefined;
  };

  private forgotPassword = () => {
    navigation.assign(pageURL('forgot-password', this.pageParams));
  };

  private register = () => {
    navigation.assign(pageURL('register', this.pageParams));
  };

  private submit = async (event: Event) => {
    event.preventDefault();
    if (this.submitDisabled) {
      return;
    }
    this.state.submitting = true;
    this.state.error = undefined;
    let session;
    try {
      session = await signInWithPassword(this.args.config, {
        username: this.state.username,
        password: this.state.password,
        client: this.args.client,
        registrationToken: undefined,
      });
    } catch (e) {
      this.state.error = signInFailed(e);
      this.state.submitting = false;
      return;
    }
    this.args.onSignedIn(session);
  };

  private startGoogle = async () => {
    this.state.startingGoogle = true;
    this.state.error = undefined;
    try {
      navigation.assign(
        await beginGoogleSignIn(this.state.google, {
          client: this.args.client,
          cli: this.args.cli,
          username: this.args.username,
        }),
      );
    } catch (e: any) {
      this.state.error = asSentence(e.message);
      this.state.startingGoogle = false;
    }
  };
}
