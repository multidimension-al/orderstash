const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const inventory = require('./publication-files.cjs');
const root = path.resolve(__dirname, '..');
const build = path.join(root, 'build');
const meta = require('../package.json');
async function main() {
  // Recreate only our generated directory so removed documents cannot linger.
  if (fs.existsSync(build)) {
    const expected = path.join(fs.realpathSync(root), 'build');
    if (fs.lstatSync(build).isSymbolicLink() || fs.realpathSync(build) !== expected) {
      throw new Error('Refusing to clean a linked build directory');
    }
    fs.rmSync(build, {recursive: true});
  }
  fs.mkdirSync(build, {recursive: true});
  await esbuild.build({
    entryPoints: ['background', 'panel', 'parser', 'content'].map((n) =>
      path.join(root, 'src/app', n + '.ts'),
    ),
    outdir: build,
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    format: 'iife',
    minify: true,
    legalComments: 'eof',
  });
  for (const [folder, files] of [
    ['src/pages', inventory.pages],
    ['src/styles', ['panel.css']],
    ['src/assets', inventory.assets],
    ['.', inventory.documents],
  ])
    for (const file of files)
      fs.copyFileSync(path.join(root, folder, file), path.join(build, file));
  fs.mkdirSync(path.join(build, 'docs'), {recursive: true});
  for (const file of inventory.guides) {
    fs.copyFileSync(path.join(root, 'docs', file), path.join(build, 'docs', file));
  }
  fs.mkdirSync(path.join(build, 'docs/brand'), {recursive: true});
  for (const file of inventory.brandAssets) {
    fs.copyFileSync(path.join(root, 'docs/brand', file), path.join(build, 'docs/brand', file));
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'),
  );
  manifest.version = meta.version;
  fs.writeFileSync(
    path.join(build, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(`Built ${meta.name} ${meta.version}`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
