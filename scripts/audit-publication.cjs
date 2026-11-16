// Read-only checks of working files, the Git index and the generated extension.
// Never stage, package or upload files, and never print matched sensitive text.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const inventory = require('./publication-files.cjs');
const root = path.resolve(__dirname, '..');
const failures = [];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const git = args => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const privatePath = file => inventory.privateSource.test(file);
const publicPath = file => !privatePath(file) && inventory.source.test(file);
const walk = directory => fs.readdirSync(path.join(root, directory), {withFileTypes: true})
  .flatMap(entry => {
    const file = directory + '/' + entry.name;
    if (entry.isSymbolicLink()) { failures.push('Unexpected link: ' + file); return []; }
    return entry.isDirectory() ? walk(file) : [file];
  });
const notice = read('NOTICE');
// Read upstream identifiers from the attribution instead of repeating branding.
const attributedNames = [...notice.matchAll(/https:\/\/github\.com\/([^\s/]+)\/([^\s/]+)/g)]
  .flatMap(match => [match[1], match[2]]).map(value => value.toLowerCase());
if (!attributedNames.length) failures.push('Required third-party attribution is missing from NOTICE.');
const meta = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('src/manifest.json'));
const modelVersion = read('src/app/model.ts').match(/VERSION\s*=\s*['"]([^'"]+)/)?.[1];
if (meta.name !== 'orderstash' || !manifest.name.startsWith('OrderStash')) {
  failures.push('Package and extension identities must use OrderStash.');
}
if (meta.version !== '0.1.0' || meta.version !== manifest.version || meta.version !== modelVersion ||
    JSON.parse(read('package-lock.json')).version !== meta.version) {
  failures.push('Development versions must all remain 0.1.0.');
}
if (meta.license !== 'Apache-2.0') failures.push('Review the package license before publication.');
if (Object.keys(meta.dependencies || {}).length) failures.push('Review new production dependencies and their notices.');

function inspect(file, content, label = file, boundary = root, available) {
  if (/\.png$/i.test(file)) return;
  if (file !== 'NOTICE' && file !== 'LICENSE' && attributedNames.some(name => content.toLowerCase().includes(name))) {
    failures.push('Prior-project branding outside NOTICE: ' + label);
  }
  const sensitive = [
    ['workstation path', /\b[a-z]:[\\/](?:users|documents and settings|synologydrive)[\\/]|\/(?:Users|home)\/[^/\s]+\//i],
    ['credential signature', /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
    ['URL credentials', /https?:\/\/[^/\s:@]+:[^/\s@]+@/i],
    ['conversation record', /<(?:oai-mem-citation|codex_internal_context)\b|"type"\s*:\s*"(?:response_item|event_msg|session_meta)"|^#{1,6}\s*(?:user|assistant|system|developer)\s+(?:message|prompt)\b/im],
  ];
  for (const [kind, pattern] of sensitive) if (pattern.test(content)) failures.push('Possible ' + kind + ': ' + label);
  if (!/\.md$/i.test(file)) return;
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const destination = match[1].trim().replace(/^<|>$/g, '').split('#')[0];
    if (!destination || /^[a-z][a-z\d+.-]*:/i.test(destination)) continue;
    let target;
    try { target = path.resolve(boundary, path.dirname(file), decodeURIComponent(destination)); }
    catch { failures.push('Invalid local link in ' + label); continue; }
    const relative = path.relative(boundary, target).replace(/\\/g, '/');
    if (!target.startsWith(boundary + path.sep) || !fs.existsSync(target) ||
        (available && !available.has(relative))) {
      failures.push('Broken local link in ' + label + ': ' + destination);
    } else if (privatePath(relative) || (boundary === root && !publicPath(relative))) {
      failures.push('Public document links to private material in ' + label + ': ' + destination);
    }
  }
}

let sourceFiles = [];
try {
  sourceFiles = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  const available = new Set(sourceFiles);
  for (const file of sourceFiles) {
    if (!publicPath(file)) { failures.push('Unapproved or private file eligible for Git: ' + file); continue; }
    const location = path.join(root, file);
    if (!fs.existsSync(location)) { failures.push('Git file missing from working tree: ' + file); continue; }
    if (!fs.lstatSync(location).isFile()) { failures.push('Unexpected link or non-file: ' + file); continue; }
    inspect(file, read(file), file, root, available);
  }
  const staged = git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)
    .map(entry => /^(\d+) ([a-f\d]+) (\d)\t([\s\S]+)$/.exec(entry));
  const stagedPaths = new Set(staged.filter(Boolean).map(entry => entry[4]));
  for (const entry of staged) {
    if (!entry) { failures.push('Cannot parse the Git index.'); continue; }
    const [, mode, oid, stage, file] = entry;
    if (!publicPath(file)) continue; // Already rejected above.
    if (!['100644', '100755'].includes(mode) || stage !== '0') {
      failures.push('Link, submodule or unresolved merge in Git index: ' + file); continue;
    }
    inspect(file, git(['cat-file', 'blob', oid]), 'Git index: ' + file, root, stagedPaths);
  }
} catch {
  failures.push('Git inventory unavailable. Run from a trusted Git checkout; publication cannot be verified without its index.');
}
for (const file of [...inventory.documents, ...inventory.guides.map(file => 'docs/' + file)]) {
  if (!sourceFiles.includes(file)) failures.push('Required public document missing from Git inventory: ' + file);
}

const expected = new Set([...inventory.documents, ...inventory.assets, ...inventory.pages,
  ...inventory.runtime, ...inventory.guides.map(file => 'docs/' + file),
  ...inventory.brandAssets.map(file => 'docs/brand/' + file)]);
if (!fs.existsSync(path.join(root, 'build/manifest.json'))) failures.push('Run npm run build before auditing publication files.');
else {
  const built = walk('build').map(file => file.slice('build/'.length));
  const available = new Set(built);
  for (const file of built) if (!expected.has(file)) failures.push('Unexpected generated-extension file: ' + file);
  for (const file of expected) if (!available.has(file)) failures.push('Missing generated-extension file: ' + file);
  for (const file of [...inventory.documents, ...inventory.guides.map(file => 'docs/' + file)]) {
    if (available.has(file) && read(file) !== read('build/' + file)) failures.push('Stale generated document: ' + file);
  }
  if (JSON.parse(read('build/manifest.json')).version !== meta.version) failures.push('Generated extension version is stale.');
  for (const file of built) inspect(file, read('build/' + file), 'build/' + file, path.join(root, 'build'), available);
}
if (failures.length) {
  [...new Set(failures)].forEach(failure => console.error('FAIL: ' + failure));
  process.exitCode = 1;
} else console.log('Publication audit passed: ' + sourceFiles.length + ' Git-eligible public files, Git index checked, complete build, OrderStash ' + meta.version + ', attribution retained in NOTICE.');
