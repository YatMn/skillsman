'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { identity, digestSkill, fileDigest, readState, writeAtomic } = require('../lib/skillsman/state.cjs');
const sha = bytes => 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsman-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function skill(root, name = 'alpha') {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'agents'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'alpha');
  fs.writeFileSync(path.join(dir, 'references', 'a.md'), 'reference');
  fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), 'echo alpha');
  fs.writeFileSync(path.join(dir, 'agents', 'openai.yaml'), 'interface: test');
  return dir;
}

test('identity uses a lossless tuple', () => {
  assert.equal(identity('a|b', 'c', 'd'), JSON.stringify(['a|b', 'c', 'd']));
  assert.notEqual(identity('a|b', 'c', 'd'), identity('a', 'b|c', 'd'));
});

test('fileDigest hashes raw bytes and only ENOENT yields null', t => {
  const root = temporary(t); const file = path.join(root, 'file');
  assert.equal(fileDigest(file), null);
  fs.writeFileSync(file, Buffer.from([0, 255, 1]));
  assert.equal(fileDigest(file), sha(Buffer.from([0, 255, 1])));
  assert.throws(() => fileDigest(root));
  assert.throws(() => fileDigest(path.join(file, 'child')), { code: 'ENOTDIR' });
  fs.symlinkSync('loop', path.join(root, 'loop'));
  assert.throws(() => fileDigest(path.join(root, 'loop')), { code: 'ELOOP' });
});

test('digests include references, scripts, agents, hidden files and relative paths, ignoring time', t => {
  const root = temporary(t); const dir = skill(root);
  const initial = digestSkill(dir);
  assert.match(initial, /^sha256:[a-f0-9]{64}$/);
  fs.utimesSync(path.join(dir, 'references', 'a.md'), new Date(0), new Date(0));
  fs.utimesSync(dir, new Date(0), new Date(0));
  assert.equal(digestSkill(dir), initial);
  for (const relative of ['references/a.md', 'scripts/run.sh', 'agents/openai.yaml', '.hidden']) {
    const file = path.join(dir, relative); const before = digestSkill(dir);
    fs.writeFileSync(file, 'changed'); assert.notEqual(digestSkill(dir), before, relative);
  }
  const beforeMove = digestSkill(dir);
  fs.renameSync(path.join(dir, 'references/a.md'), path.join(dir, 'references/b.md'));
  assert.notEqual(digestSkill(dir), beforeMove);
});

test('digests are independent of absolute location and creation order, but include modes', t => {
  const root = temporary(t); const first = skill(root);
  const second = path.join(root, 'second'); fs.mkdirSync(second);
  for (const sub of ['scripts', 'references', 'agents']) fs.mkdirSync(path.join(second, sub));
  for (const file of ['scripts/run.sh', 'references/a.md', 'agents/openai.yaml', 'SKILL.md']) fs.copyFileSync(path.join(first, file), path.join(second, file));
  assert.equal(digestSkill(first), digestSkill(second));
  fs.chmodSync(path.join(second, 'scripts/run.sh'), 0o755);
  assert.notEqual(digestSkill(first), digestSkill(second));
});

test('top skill symlinks and contained file/directory links are supported', t => {
  const root = temporary(t); const dir = skill(root);
  fs.symlinkSync(dir, path.join(root, 'top'));
  assert.equal(digestSkill(path.join(root, 'top')), digestSkill(dir));
  const before = digestSkill(dir);
  fs.symlinkSync('references/a.md', path.join(dir, 'ref'));
  fs.symlinkSync('references', path.join(dir, 'refs'));
  const linked = digestSkill(dir);
  assert.notEqual(linked, before);
  fs.writeFileSync(path.join(dir, 'references/a.md'), 'changed target');
  assert.notEqual(digestSkill(dir), linked);
  const beforeRetarget = digestSkill(dir);
  fs.unlinkSync(path.join(dir, 'ref'));
  fs.symlinkSync('./references/a.md', path.join(dir, 'ref'));
  assert.notEqual(digestSkill(dir), beforeRetarget);
});

for (const [label, target] of [['broken', 'missing'], ['self cycle', 'link'], ['ancestor cycle', '.'], ['outside', '../outside'], ['outside prefix sibling', '../alpha-other']]) {
  test('digest rejects ' + label + ' symlinks', t => {
    const root = temporary(t); const dir = skill(root);
    fs.writeFileSync(path.join(root, 'outside'), 'outside');
    fs.mkdirSync(path.join(root, 'alpha-other'));
    fs.symlinkSync(target, path.join(dir, 'link'));
    assert.throws(() => digestSkill(dir));
  });
}

test('digest rejects missing/non-directory roots and special files', t => {
  const root = temporary(t);
  assert.throws(() => digestSkill(path.join(root, 'missing')), { code: 'ENOENT' });
  const dir = skill(root);
  assert.throws(() => digestSkill(path.join(dir, 'SKILL.md')));
  execFileSync('mkfifo', [path.join(dir, 'pipe')]);
  assert.throws(() => digestSkill(dir), /special|unsupported|regular/i);
});

test('state is strict, missing is empty, identical entries deduplicate and corruption propagates', t => {
  const root = temporary(t); const file = path.join(root, 'state.json');
  assert.deepEqual(readState(file), { version: 1, entries: [] });
  const entry = { source: 'example/kit', name: 'Name With Spaces', target: 'codex', digest: sha('a'), revision: null };
  const save = object => fs.writeFileSync(file, JSON.stringify(object));
  save({ version: 1, entries: [entry, entry, { ...entry, target: 'cursor', revision: 'abc' }] });
  assert.deepEqual(readState(file), { version: 1, entries: [entry, { ...entry, target: 'cursor', revision: 'abc' }] });
  const invalid = [null, [], {}, { version: 2, entries: [] }, { version: 1, entries: null }, { version: 1, entries: [], extra: 1 },
    ...[{ ...entry, unknown: true }, { ...entry, digest: 'sha256:no' }, { ...entry, digest: null }, { ...entry, revision: 123 },
      { ...entry, revision: undefined }, { ...entry, name: '' }, { ...entry, source: '--help' }, { ...entry, target: 'a\nb' }].map(row => ({ version: 1, entries: [row] })),
    { version: 1, entries: [entry, { ...entry, digest: sha('b') }] }];
  for (const value of invalid) { save(value); assert.throws(() => readState(file), JSON.stringify(value)); }
  fs.writeFileSync(file, '{'); assert.throws(() => readState(file), SyntaxError);
  assert.throws(() => readState(root));
});

test('atomic writes require explicit digest, check absence and replacements, and leave no temporary files', t => {
  const root = temporary(t); const file = path.join(root, 'nested/state.json');
  assert.throws(() => writeAtomic(file, 'first'));
  writeAtomic(file, 'first', null);
  assert.equal(fs.readFileSync(file, 'utf8'), 'first');
  const oldDigest = fileDigest(file);
  writeAtomic(file, 'second', oldDigest);
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  assert.throws(() => writeAtomic(file, 'lost', oldDigest), /chang|conflict|digest/i);
  assert.throws(() => writeAtomic(file, 'lost', null), /chang|conflict|digest/i);
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json']);
  fs.unlinkSync(file);
  assert.throws(() => writeAtomic(file, 'lost', oldDigest), /chang|conflict|digest/i);
});

test('atomic writing refuses existing symlinks and propagates non-file failures', t => {
  const root = temporary(t); const destination = path.join(root, 'destination');
  fs.writeFileSync(destination, 'keep'); fs.symlinkSync('destination', path.join(root, 'link'));
  assert.throws(() => writeAtomic(path.join(root, 'link'), 'new', fileDigest(destination)), /link|regular/i);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'keep');
  fs.symlinkSync('missing', path.join(root, 'broken'));
  assert.throws(() => writeAtomic(path.join(root, 'broken'), 'new', null));
  assert.throws(() => writeAtomic(root, 'new', null));
});

// Inject actual filesystem changes at deterministic I/O boundaries; data and hashing remain real.
test('digest rejects file edits during reads and directory edits during traversal', t => {
  const root = temporary(t); const dir = skill(root); const file = path.join(dir, 'SKILL.md');
  const originalRead = fs.readFileSync;
  try {
    let edited = false;
    fs.readFileSync = function (...args) {
      const result = originalRead.apply(this, args);
      if (!edited) { edited = true; fs.writeFileSync(file, 'mutation during read'); }
      return result;
    };
    assert.throws(() => digestSkill(dir), /chang|race|stable/i);
  } finally { fs.readFileSync = originalRead; }
  const originalList = fs.readdirSync;
  try {
    let edited = false;
    fs.readdirSync = function (...args) {
      const result = originalList.apply(this, args);
      if (!edited) { edited = true; fs.writeFileSync(path.join(dir, 'new'), 'mutation during traversal'); }
      return result;
    };
    assert.throws(() => digestSkill(dir), /chang|race|stable/i);
  } finally { fs.readdirSync = originalList; }
});

test('atomic write rechecks after staging and preserves external edits on failure', t => {
  const root = temporary(t); const file = path.join(root, 'state.json');
  fs.writeFileSync(file, 'before'); const expected = fileDigest(file);
  const originalWrite = fs.writeFileSync;
  try {
    let edited = false;
    fs.writeFileSync = function (...args) {
      const result = originalWrite.apply(this, args);
      if (!edited) { edited = true; originalWrite(file, 'external'); }
      return result;
    };
    assert.throws(() => writeAtomic(file, 'ours', expected), /chang|conflict|digest/i);
  } finally { fs.writeFileSync = originalWrite; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'external');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});

test('permission errors from real files propagate instead of becoming empty state or digest', { skip: process.getuid?.() === 0 }, t => {
  const root = temporary(t); const dir = skill(root); const file = path.join(dir, 'SKILL.md');
  fs.chmodSync(file, 0o000);
  try {
    for (const read of [fileDigest, readState]) assert.throws(() => read(file), { code: 'EACCES' });
    assert.throws(() => digestSkill(dir), { code: 'EACCES' });
  } finally { fs.chmodSync(file, 0o600); }
});

test('fileDigest detects replacement and disappearance during a real read', t => {
  const root = temporary(t); const file = path.join(root, 'file');
  const originalRead = fs.readFileSync;
  for (const remove of [false, true]) {
    fs.writeFileSync(file, 'before');
    try {
      let edited = false;
      fs.readFileSync = function (...args) {
        const result = originalRead.apply(this, args);
        if (!edited) {
          edited = true;
          fs.unlinkSync(file);
          if (!remove) fs.writeFileSync(file, 'before');
        }
        return result;
      };
      assert.throws(() => fileDigest(file), remove ? /ENOENT|chang/i : /chang/i);
    } finally { fs.readFileSync = originalRead; }
  }
});

test('digest detects edits to an already visited file and top symlink retargeting', t => {
  const root = temporary(t); const dir = skill(root); const other = skill(root, 'other');
  const top = path.join(root, 'top'); fs.symlinkSync(dir, top);
  const originalRead = fs.readFileSync;
  for (const retarget of [false, true]) {
    try {
      let reads = 0;
      fs.readFileSync = function (...args) {
        const result = originalRead.apply(this, args);
        if (++reads === 2) {
          if (retarget) { fs.unlinkSync(top); fs.symlinkSync(other, top); }
          else fs.writeFileSync(path.join(dir, 'SKILL.md'), 'changed after visit');
        }
        return result;
      };
      assert.throws(() => digestSkill(top), /chang/i);
    } finally { fs.readFileSync = originalRead; }
  }
});

test('absent atomic destination cannot overwrite a file created at final commit', t => {
  const root = temporary(t); const file = path.join(root, 'state.json');
  const originalLink = fs.linkSync;
  try {
    fs.linkSync = function (...args) {
      fs.writeFileSync(file, 'external winner');
      return originalLink.apply(this, args);
    };
    assert.throws(() => writeAtomic(file, 'ours', null), { code: 'EEXIST' });
  } finally { fs.linkSync = originalLink; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'external winner');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});

test('staging failure cleans only its own temporary file and preserves original state', t => {
  const root = temporary(t); const file = path.join(root, 'state.json');
  fs.writeFileSync(file, 'original'); fs.writeFileSync(path.join(root, 'unrelated.tmp'), 'keep');
  const expected = fileDigest(file); const originalSync = fs.fsyncSync;
  const failure = Object.assign(new Error('simulated disk failure'), { code: 'EIO' });
  try {
    fs.fsyncSync = () => { throw failure; };
    assert.throws(() => writeAtomic(file, 'ours', expected), error => error === failure);
  } finally { fs.fsyncSync = originalSync; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(root).sort(), ['state.json', 'unrelated.tmp']);
});

test('contained links resolve parent components after directory symlinks using filesystem semantics', t => {
  const root = temporary(t); const dir = skill(root);
  fs.mkdirSync(path.join(dir, 'nested', 'child'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nested', 'target'), 'actual target');
  fs.symlinkSync('nested/child', path.join(dir, 'directory-link'));
  fs.symlinkSync('directory-link/../target', path.join(dir, 'linked-file'));
  assert.equal(fs.readFileSync(path.join(dir, 'linked-file'), 'utf8'), 'actual target');
  assert.match(digestSkill(dir), /^sha256:[a-f0-9]{64}$/);
});

test('fileDigest returns null for an initially absent symlink target while state rejects a broken state link', t => {
  const root = temporary(t); const file = path.join(root, 'link');
  fs.symlinkSync('absent', file);
  assert.equal(fileDigest(file), null);
  assert.throws(() => readState(file), { code: 'ENOENT' });
});
