// Stand-in for the `@percy/ember/env` virtual module. The classic addon
// generates it with broccoli at build time (WriteFile in its Node-only
// index.js); Vite never runs that hook, so the vite config aliases the
// import here instead. VERSION only feeds Percy's client-info string, and
// an undefined PERCY_SERVER_ADDRESS leaves @percy/sdk-utils on its default
// localhost discovery address.
export default {
  VERSION: '5.0.1',
  PERCY_SERVER_ADDRESS: undefined,
};
