import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

// Exercise the actual publication command in disposable Git checkouts.
const root = path.resolve(__dirname, '..');
const inventory = require('../scripts/publication-files.cjs');
const output = path.join(root, 'test-output');
let checkout: string;
const put = (file: string, content: string | Buffer) => {
  const target = path.join(checkout, file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, content);
};
const copy = (from: string, to = from) => put(to, fs.readFileSync(path.join(root, from)));
const git = (...args: string[]) => execFileSync('git', args, {
  cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const audit = () => {
  const result = spawnSync(process.execPath, ['scripts/audit-publication.cjs'], {
    cwd: checkout, encoding: 'utf8',
  });
  return {status: result.status, text: result.stdout + result.stderr};
};

beforeEach(() => {
  fs.mkdirSync(output, {recursive: true});
  checkout = fs.mkdtempSync(path.join(output, 'publication-'));
  for (const file of [...inventory.documents, 'package.json', 'package-lock.json', '.gitignore',
    'scripts/publication-files.cjs', 'scripts/audit-publication.cjs', 'src/manifest.json', 'src/app/model.ts',
    ...inventory.guides.map((name: string) => 'docs/' + name),
    ...inventory.brandAssets.map((name: string) => 'docs/brand/' + name)]) copy(file);
  for (const file of inventory.documents) copy(file, 'build/' + file);
  for (const file of inventory.guides) copy('docs/' + file, 'build/docs/' + file);
  for (const file of inventory.brandAssets) copy('docs/brand/' + file, 'build/docs/brand/' + file);
  for (const file of inventory.assets) copy('src/assets/' + file, 'build/' + file);
  for (const file of inventory.pages) copy('src/pages/' + file, 'build/' + file);
  for (const file of inventory.runtime) put('build/' + file, file === 'manifest.json'
    ? fs.readFileSync(path.join(root, 'src/manifest.json')) : '// Synthetic build fixture\n');
  git('init', '--quiet');
  git('add', '--', '.');
});

afterEach(() => {
  const target = path.resolve(checkout);
  if (!target.startsWith(path.resolve(output) + path.sep) || fs.lstatSync(target).isSymbolicLink()) {
    throw new Error('Refusing to remove a fixture outside test-output');
  }
  fs.rmSync(target, {recursive: true, force: true});
});

test('accepts a clean source checkout, staged contents and complete build', () => {
  expect(audit()).toMatchObject({status: 0});
});

test('rejects a force-added private file', () => {
  put('.private/review.md', 'Private fixture');
  git('add', '--force', '--', '.private/review.md');
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('private file eligible for Git')});
});

test('rejects an unexpected file at the repository root', () => {
  put('scratch.txt', 'Internal fixture');
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('scratch.txt')});
});

test('scans the index even after a staged credential is removed from the working file', () => {
  const original = fs.readFileSync(path.join(checkout, 'README.md'), 'utf8');
  const credential = 'gh' + 'p_' + 'A'.repeat(36);
  put('README.md', original + '\n' + credential);
  git('add', '--', 'README.md');
  put('README.md', original);
  const result = audit();
  expect(result).toMatchObject({status: 1, text: expect.stringContaining('credential signature: Git index: README.md')});
  expect(result.text).not.toContain(credential);
});

test('rejects links to a private file that happens to exist locally', () => {
  put('.private/review.md', 'Private fixture');
  put('README.md', '[Review](.private/review.md)');
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('local link')});
});

test('rejects a staged document whose link target is not staged', () => {
  git('rm', '--cached', '--', 'docs/TESTING.md');
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('Git index: README.md')});
});

test('fails closed when the Git inventory cannot be read', () => {
  fs.renameSync(path.join(checkout, '.git'), path.join(checkout, '.git-unavailable'));
  // The fixture lives inside another checkout. Stop Git discovery at its parent.
  const result = spawnSync(process.execPath, ['scripts/audit-publication.cjs'], {
    cwd: checkout, encoding: 'utf8', env: {...process.env, GIT_CEILING_DIRECTORIES: output},
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Git inventory unavailable');
});

test('rejects extra generated files', () => {
  put('build/extra.txt', 'Unreviewed fixture');
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('Unexpected generated-extension file')});
});

test('scans generated runtime for credentials', () => {
  put('build/background.js', '// ' + 'gh' + 'p_' + 'A'.repeat(36));
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('credential signature: build/background.js')});
});

test('keeps prior-project attribution out of product documentation', () => {
  const upstream = fs.readFileSync(path.join(checkout, 'NOTICE'), 'utf8')
    .match(/https:\/\/github\.com\/([^\s/]+)\/([^\s/]+)/)![2];
  put('README.md', 'Based on ' + upstream);
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('Prior-project branding outside NOTICE')});
});

test.each([
  ['workstation path', 'C:' + '\\Users\\' + 'example\\notes.txt'],
  ['conversation record', '### Assistant' + ' message\nPrivate fixture'],
])('rejects a %s in a public file', (kind, content) => {
  put('README.md', content);
  expect(audit()).toMatchObject({status: 1, text: expect.stringContaining('Possible ' + kind)});
});
