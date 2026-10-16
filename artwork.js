'use strict';
const { createHash } = require('node:crypto');
function imageType(data) {
  if (!Buffer.isBuffer(data) || data.length < 12 || data.length > 2 * 1024 * 1024) return null;
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
function createArtworkStore() {
  const images = new Map();
  return {
    add(data) {
      const type = imageType(data); if (!type) return null;
      const hash = createHash('sha256').update(data).digest('hex');
      images.delete(hash); images.set(hash, { data, type });
      while (images.size > 12) images.delete(images.keys().next().value);
      return '/api/artwork/' + hash;
    },
    get(hash) { return images.get(hash); },
  };
}
module.exports = { imageType, createArtworkStore };
