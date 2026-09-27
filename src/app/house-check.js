// The stamp on a product's copy of ws-house.css, and the check that it has
// not been edited there. Pure and dependency-free, so a product can copy this
// file beside its copy of the stylesheet and require it from its tests.
const crypto = require('crypto');

const HEAD = /^\/\* ws-house\.css (\d+\.\d+\.\d+), sha256 ([0-9a-f]{64})\n[\s\S]*?\*\/\n/;
const digest = (css) => crypto.createHash('sha256').update(css, 'utf8').digest('hex');

function stamp(css, version) {
  return '/* ws-house.css ' + version + ', sha256 ' + digest(css) + '\n' +
    '   Shared by every Williams, Stanley & Co. product. Do not edit this copy:\n' +
    '   change AAtithe/house-style and run its sync into this file. */\n' + css;
}

// Returns { version, css } for a sound copy; throws on an edited or unstamped one.
function check(stamped) {
  const m = stamped.match(HEAD);
  if (!m) throw new Error('ws-house.css has no house-style stamp: sync it from AAtithe/house-style');
  const css = stamped.slice(m[0].length);
  if (digest(css) !== m[2]) throw new Error('ws-house.css ' + m[1] + ' has been edited in this product: change AAtithe/house-style and sync it instead');
  return { version: m[1], css };
}

module.exports = { stamp, check, digest };
