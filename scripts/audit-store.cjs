// Check ready-to-upload artwork without changing it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));
const screenshots = ['invoice-pdfs', 'saved-orders', 'export-status', 'history', 'local-records'];
const images = [
  ['store-icon-128.png', 128, 128, 6],
  ...screenshots.map((name, index) => ['screenshot-' + (index + 1) + '-' + name + '.png', 1280, 800, 2]),
  ['promo-small-440x280.png', 440, 280, 2],
  ['promo-marquee-1400x560.png', 1400, 560, 2],
  ['orderstash-logo.png', 820, 224, 6],
];
for (const [name, width, height, colorType] of images) {
  const png = read('store/assets/' + name);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name + ': not a PNG');
  assert.equal(png.readUInt32BE(16), width, name + ': wrong width');
  assert.equal(png.readUInt32BE(20), height, name + ': wrong height');
  assert.equal(png[24], 8, name + ': expected 8 bits per channel');
  assert.equal(png[25], colorType, name + ': wrong RGB/alpha format');
  console.log('PASS: ' + name + ' (' + width + 'x' + height + (colorType === 2 ? ', RGB without alpha)' : ', RGBA)'));
}
assert.deepEqual(read('store/assets/store-icon-128.png'), read('src/assets/icon128.png'), 'Store icon differs from extension');
const short = read('store/short-description.txt').toString('utf8').trim();
assert.ok(short.length > 0 && short.length <= 132, 'Short description must be 1-132 characters');
const description = read('store/description.txt').toString('utf8').trim();
assert.ok(description.length > 0 && description.length <= 16000, 'Detailed description must be 1-16000 characters');
console.log('Store asset audit passed: five screenshots, both promo tiles, icon, logo and listing copy.');
