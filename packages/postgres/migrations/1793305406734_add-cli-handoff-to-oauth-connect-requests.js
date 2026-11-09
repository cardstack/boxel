// A sign-in the CLI starts names the loopback listener it waits on: the port
// on 127.0.0.1 and the state value the listener expects back. The realm
// server's OAuth callback reads them from the sign-in in progress and passes
// them to the secure window's `connected` page, which hands the service's
// one-use code to the CLI to finish the sign-in with its own secure session.
// Both are null for a sign-in the secure window starts.
//
// `oauth_connect_requests` is excluded from the SQLite schema dump, so the
// host's schema file is unchanged.

exports.up = (pgm) => {
  pgm.addColumns('oauth_connect_requests', {
    cli_port: { type: 'integer' },
    cli_state: { type: 'varchar' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('oauth_connect_requests', ['cli_port', 'cli_state']);
};
