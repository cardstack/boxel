// This declaration is needed to satisfy the type checker.
declare module '@cardstack/boxel-host/tools/*' {
  const mod: any;
  export default mod;
}

// Pre-rename spelling of the tools/ specifiers; resolves to the same modules.
declare module '@cardstack/boxel-host/commands/*' {
  const mod: any;
  export default mod;
}
