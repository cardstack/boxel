exports.up = (pgm) => {
  pgm.addColumn('proxy_endpoints', {
    credentials: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('proxy_endpoints', 'credentials');
};
