import OnKeyModifier from 'ember-keyboard/modifiers/on-key';

export default OnKeyModifier;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'on-key-mod': typeof OnKeyModifier;
  }
}
