// Package only the compiled extension, never account data or browser profiles.
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'audit-publication.cjs')], {stdio: 'inherit'});
const version = require('../package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Invalid version');
}
const build = path.join(root, 'build');
const manifest = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json')));
if (manifest.version !== version) {
  throw new Error('Rebuild before packaging');
}
fs.mkdirSync(path.join(root, 'artifacts'), {recursive: true});
const archive = path.join(root, 'artifacts', `OrderStash-${version}.zip`);
if (process.platform === 'win32') {
  const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
  const files = fs
    .readdirSync(build)
    .map((file) => quote(path.join(build, file)))
    .join(',');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath ${files} -DestinationPath ${quote(archive)} -Force`,
    ],
    {stdio: 'inherit'},
  );
} else {
  execFileSync('zip', ['-qr', archive, '.'], {cwd: build, stdio: 'inherit'});
}
console.log(archive);
