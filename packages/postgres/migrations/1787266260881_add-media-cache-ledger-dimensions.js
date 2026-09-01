exports.shorthands = undefined;

// Pixel dimensions of the stored capture, recorded so a serving path that
// answers from the ledger (the POST endpoint's ledger-hit response mirrors
// the capture's width/height) never has to decode the image bytes. Nullable:
// rows written before dimensions were recorded simply lack them.

exports.up = (pgm) => {
  pgm.addColumns('media_cache_ledger', {
    width: { type: 'integer' },
    height: { type: 'integer' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('media_cache_ledger', ['width', 'height']);
};
