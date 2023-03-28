// we are getting multiple versions of @ember/test-helpers because it has a peer
// dep on ember-source, which is consumed by ember-qunit, which in turn has no
// ember-source dep, such that when that is consumed by the host app, the ember
// source seen by the peer dep may not necessarily be the same ember-source the
// host app uses, resulting in more than one @ember/test-helpers.
// @ember/test-helpers then has this logic where if there is more than one
// version, then the extra ones will be deleted, which causes grief for how pnpm
// lays things out. this will patch the package.json for the ember-qunit package
// to make an explicit ember-source peer dep so that we only get a single
// version @ember/test-helper.

function readPackage(pkg, context) {
  if (pkg.name === 'ember-qunit' && pkg.version.startsWith('5.')) {
    pkg.peerDependencies = {
      ...pkg.peerDependencies,
      'ember-source': '>=4.2.0',
    };
    context.log('set ember-qunit to have a peer-dep of ember-source >=4.2.0');
  }
  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
