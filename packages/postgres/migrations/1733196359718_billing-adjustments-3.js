 

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('users', {
    stripe_customer_email: { type: 'varchar' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'stripe_customer_email');
};
