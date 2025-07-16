const matrixUserIds = [
  '@0xpranayy:boxel.ai',
  '@agent:boxel.ai',
  '@aibot:boxel.ai',
  '@andrecastro89:boxel.ai',
  '@athompson19:boxel.ai',
  '@b9:boxel.ai',
  '@banksia:boxel.ai',
  '@breakdance12:boxel.ai',
  '@btc:boxel.ai',
  '@buck.doyle+202410231246:boxel.ai',
  '@bucktest:boxel.ai',
  '@burcu:boxel.ai',
  '@burcunoyan1:boxel.ai',
  '@burcunoyan:boxel.ai',
  '@cgardella:boxel.ai',
  '@chad924:boxel.ai',
  '@chris:boxel.ai',
  '@chuanstack:boxel.ai',
  '@david:boxel.ai',
  '@dezertfox:boxel.ai',
  '@dick:boxel.ai',
  '@dmartinez21:boxel.ai',
  '@dml:boxel.ai',
  '@doug:boxel.ai',
  '@doug_funny:boxel.ai',
  '@dtaylor56:boxel.ai',
  '@fadhlanr:boxel.ai',
  '@harry:boxel.ai',
  '@hassan1:boxel.ai',
  '@hassan2:boxel.ai',
  '@hassan3:boxel.ai',
  '@hassan4:boxel.ai',
  '@ian:boxel.ai',
  '@iantest2:boxel.ai',
  '@iantest3:boxel.ai',
  '@iantest4:boxel.ai',
  '@iantest:boxel.ai',
  '@itranslate:boxel.ai',
  '@jacthong:boxel.ai',
  '@janderson23:boxel.ai',
  '@jbrown44:boxel.ai',
  '@jhall77:boxel.ai',
  '@jtjr:boxel.ai',
  '@jurgen1:boxel.ai',
  '@jurgen5:boxel.ai',
  '@jurgen:boxel.ai',
  '@jurgenwerk2:boxel.ai',
  '@jurgenwerk:boxel.ai',
  '@justme:boxel.ai',
  '@kdowlin:boxel.ai',
  '@larenug:boxel.ai',
  '@lucas:boxel.ai',
  '@lukemelia20240925:boxel.ai',
  '@lukemelia:boxel.ai',
  '@lukemeliatest:boxel.ai',
  '@machgroup:boxel.ai',
  '@maheshmaceee:boxel.ai',
  '@marbles8641:boxel.ai',
  '@mbeckett:boxel.ai',
  '@mdavis33:boxel.ai',
  '@mjohnson87:boxel.ai',
  '@nas9171:boxel.ai',
  '@nayton:boxel.ai',
  '@octavian:boxel.ai',
  '@perelin:boxel.ai',
  '@ramadi:boxel.ai',
  '@richard.tan:boxel.ai',
  '@riham:boxel.ai',
  '@rosalina:boxel.ai',
  '@rwilson78:boxel.ai',
  '@sander:boxel.ai',
  '@sertac:boxel.ai',
  '@slewis88:boxel.ai',
  '@steppenwolf:boxel.ai',
  '@thomas:boxel.ai',
  '@tintinthong:boxel.ai',
  '@wd2263:boxel.ai',
  '@weizhou.ding.nyu:boxel.ai',
  '@will007:boxel.ai',
  '@wsmith99:boxel.ai',
  '@yhd9587:boxel.ai',
  '@ys5899:boxel.ai',
];

exports.up = (pgm) => {
  if (process.env.REALM_SENTRY_ENVIRONMENT === 'production') {
    for (const matrixUserId of matrixUserIds) {
      pgm.sql(`
        INSERT INTO users (matrix_user_id)
        SELECT '${matrixUserId}'
        WHERE NOT EXISTS (
          SELECT 1 FROM users WHERE matrix_user_id = '${matrixUserId}'
        )
      `);
    }
  }
};

exports.down = (pgm) => {
  // No down migration - this is a one-way data migration
};
