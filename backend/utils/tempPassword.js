const crypto = require('crypto');

// Generates a readable one-time password, e.g. "Kx7m-Rt42-Qp9w"
// Avoids ambiguous chars (0/O, 1/l/I) since a human will be reading it off screen.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTempPassword() {
  const chunk = () =>
    Array.from({ length: 4 }, () => CHARS[crypto.randomInt(CHARS.length)]).join('');
  return `${chunk()}-${chunk()}-${chunk()}`;
}

module.exports = { generateTempPassword };