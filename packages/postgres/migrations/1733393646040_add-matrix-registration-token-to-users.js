 

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('users', {
    matrix_registration_token: {
      type: 'varchar',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['matrix_registration_token']);
};
