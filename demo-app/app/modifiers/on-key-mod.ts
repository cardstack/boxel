import OnKeyModifier from 'ember-keyboard/modifiers/on-key';

// This warrants an explanation. The way glint deals with non-strict templates is to let you add
// types in a global registry. There is a single registry that includes components and helpers
// and modifiers. ember-keyboard has both a helper named on-key and a modifier named on-key.
// This is impossible to work with as-is with the system I just described. As a workaround,
// in this file, we re-export the on-key modifier as on-key-mod and add that to the registry.

export default OnKeyModifier;

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'on-key-mod': typeof OnKeyModifier;
  }
}
