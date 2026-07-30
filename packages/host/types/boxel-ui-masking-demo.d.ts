// DEMO ONLY — drop this commit before merging. This shorthand ambient module
// declaration degrades every symbol imported from
// '@cardstack/boxel-ui/modifiers' to `any`, simulating the declaration
// breakage that once masked ~100 type errors, to demonstrate the canary
// failing in CI.
declare module '@cardstack/boxel-ui/modifiers';
