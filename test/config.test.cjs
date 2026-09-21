'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const config = require('../lib/skillsman/config.cjs');
const selection = (source = 'example/kit', names = ['alpha'], why = 'Writing') => ({ includes: [], skills: [{ source, why, names }] });
const text = value => YAML.stringify(value, { aliasDuplicateObjects: false });
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsman-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('selection preserves quoted full names, punctuation, local sources and round trips', () => {
  const input = selection('./a path', ['Name With Spaces', 'colon: hash#', "It’s quoted"], 'A: # reason');
  const parsed = config.parseSelection(text(input));
  assert.deepEqual(parsed, input);
  assert.deepEqual(config.parseSelection(config.serializeSelection(parsed)), parsed);
  assert.deepEqual(config.parseSelection("includes: []\nskills:\n  - source: 'owner/repo'\n    why: 'a: # reason'\n    names:\n      - 'one''s name'\n"), selection('owner/repo', ["one's name"], 'a: # reason'));
  assert.deepEqual(config.parseSelection('includes: []\nskills: []\n'), { includes: [], skills: [] });
});

test('selection requires exact schema and explicit names', () => {
  const base = selection();
  const invalid = [null, [], {}, { skills: [] }, { includes: [], skills: null }, { includes: ['workflow'], skills: [] },
    { ...base, version: 1 }, { includes: [], skills: [{}] },
    ...[undefined, null, [], '*', ['*'], [3], [''], ['  '], ['--help'], [' -x'], ['a\nb'], ['a\u007fb']].map(names => ({ includes: [], skills: [{ source: 'example/kit', why: 'Writing', names }] })),
    ...[null, 1, '', ' ', '--help', ' --help', 'a\0b'].map(source => selection(source)),
    ...[null, false, '', ' ', 'a\tb'].map(why => selection('example/kit', ['alpha'], why)),
    { includes: [], skills: [{ ...base.skills[0], extra: true }] }];
  for (const value of invalid) assert.throws(() => config.parseSelection(text(value)), text(value));
  assert.throws(() => config.serializeSelection({ skills: [] }));
});

test('YAML syntax is checked before conversion, including nested constructs', () => {
  for (const input of [
    'includes: []\nskills: []\nskills: []',
    'includes: []\nskills: &s []',
    'includes: &s []\nskills: *s',
    'includes: []\nskills: !!seq []',
    'includes: []\nskills: !custom []',
    'includes: []\nskills: []\n---\nincludes: []\nskills: []',
    'includes: []\nskills: [{source: owner/repo, why: reason, names: [alpha]}]',
    'includes: []\nskills:\n  - source: owner/repo\n    why: reason\n    names: [alpha]',
    'includes: []\nskills:\n  - source: owner/repo\n    why: reason\n    names:\n      - !!str alpha',
    'includes: []\nskills: []\n# bad\u0001'
  ]) assert.throws(() => config.parseSelection(input), input);
});

test('merge deduplicates identical identities, preserves order and first source reason without mutating', () => {
  const first = selection('example/kit', ['beta', 'alpha', 'alpha'], 'original');
  const second = { includes: [], skills: [selection('example/kit', ['alpha', 'gamma'], 'new').skills[0], selection('other/kit', ['delta']).skills[0]] };
  const before = JSON.stringify([first, second]);
  assert.deepEqual(config.mergeSelection(first, second), { includes: [], skills: [
    { source: 'example/kit', why: 'original', names: ['beta', 'alpha', 'gamma'] },
    { source: 'other/kit', why: 'Writing', names: ['delta'] }
  ] });
  assert.equal(JSON.stringify([first, second]), before);
  assert.equal(config.mergeSelection(selection(), selection('https://github.com/example/kit')).skills.length, 1);
});

test('different source or sanitized installation identity collisions are rejected', () => {
  for (const next of [selection('other/kit'), selection('example/kit', ['Alpha']), selection('other/kit', ['Alpha'])]) {
    assert.throws(() => config.mergeSelection(selection(), next), /conflict/i);
  }
  for (const names of [['Name With Spaces', 'name-with-spaces'], ['..a..', 'a'], ['a'.repeat(255) + 'x', 'a'.repeat(255) + 'y'], ['中文', '日本語']]) {
    assert.throws(() => config.parseSelection(text(selection('example/kit', names))), /conflict/i);
  }
});

test('installName matches upstream sanitizer including length, dots, underscores and fallback', () => {
  assert.equal(config.installName('Name With Spaces'), 'name-with-spaces');
  assert.equal(config.installName('..A__B.C--'), 'a__b.c');
  assert.equal(config.installName('中文'), 'unnamed-skill');
  assert.equal(config.installName('x'.repeat(260)), 'x'.repeat(255));
});

test('canonical sources are minimally normalized only for comparison', () => {
  const canonical = config.canonicalSource;
  assert.equal(canonical('Owner/Repo'), canonical('https://github.com/Owner/Repo'));
  for (const suffix of ['/tree/main/skills/a', '/skills/a', '@feature/ref']) {
    assert.equal(canonical('Owner/Repo' + suffix), canonical('https://github.com/Owner/Repo' + suffix));
    assert.notEqual(canonical('Owner/Repo' + suffix), canonical('Owner/Repo'));
  }
  for (const value of ['git@github.com:Owner/Repo', 'https://example.com/A.git', 'github:Owner/Repo', 'Owner/Repo.git', 'Owner/Repo/']) assert.equal(canonical(value), value);
  assert.notEqual(canonical('Owner/Repo'), canonical('owner/repo'));
  assert.equal(canonical('../kit', '/tmp/project'), path.resolve('/tmp/project', '../kit'));
  assert.equal(canonical('/tmp/kit', '/unrelated'), '/tmp/kit');
  assert.throws(() => canonical('--help'));
});

test('file readers propagate missing and non-file errors', t => {
  const root = temporary(t);
  assert.throws(() => config.readSelection(path.join(root, 'missing')), { code: 'ENOENT' });
  assert.throws(() => config.readSelection(root));
  assert.throws(() => config.readScenario(path.join(root, 'missing')), { code: 'ENOENT' });
  const file = path.join(root, 'selection.yaml');
  fs.writeFileSync(file, text(selection()));
  assert.deepEqual(config.readSelection(file), selection());
});

test('snapshot v1 is strict, normalizes aliases, and accepts existing writer empty null skills', () => {
  const parsed = config.parseSnapshot('schema: skillsman.snapshot.v1\ntargets:\n  claude:\n    skills:\n      - name: Name With Spaces\n        source: example/kit\n  gemini:\n    skills:\n  custom-agent:\n    skills: []\n');
  assert.deepEqual(parsed, { schema: 'skillsman.snapshot.v1', targets: {
    'claude-code': { skills: [{ name: 'Name With Spaces', source: 'example/kit' }] },
    'gemini-cli': { skills: [] }, 'custom-agent': { skills: [] }
  } });
  const row = { name: 'alpha', source: 'example/kit' };
  const valid = skills => ({ schema: 'skillsman.snapshot.v1', targets: { codex: { skills } } });
  assert.deepEqual(config.parseSnapshot(text(valid([row, row]))), valid([row]));
  for (const invalid of [{ targets: {} }, { schema: 'legacy', targets: {} }, { ...valid([]), version: 1 },
    { schema: 'skillsman.snapshot.v1', targets: [] }, { schema: 'skillsman.snapshot.v1', targets: { codex: {} } },
    { schema: 'skillsman.snapshot.v1', targets: { codex: { skills: [], extra: true } } },
    { schema: 'skillsman.snapshot.v1', targets: { '--help': { skills: [] } } },
    valid([{ name: 'alpha' }]), valid([{ ...row, why: 'extra' }]), valid([{ ...row, name: '--help' }]), valid([{ ...row, source: null }]),
    valid([row, { ...row, source: 'another/kit' }])]) assert.throws(() => config.parseSnapshot(text(invalid)), text(invalid));
});

test('scenario metadata, full-source semantics, recursive expansion and repeated includes', t => {
  const root = temporary(t);
  const write = (name, value) => fs.writeFileSync(path.join(root, name + '.yaml'), text(value));
  write('base', { name: 'base', title: 'Base', summary: 'Candidate source', includes: [], skills: [{ source: 'example/kit', why: 'Full' }] });
  write('middle', { includes: ['base'], skills: selection('other/kit', ['beta']).skills });
  write('root', { includes: ['base', 'middle'], skills: [] });
  assert.deepEqual(config.readScenario(path.join(root, 'base.yaml')), { name: 'base', title: 'Base', summary: 'Candidate source', includes: [], skills: [{ source: 'example/kit', why: 'Full', names: null }] });
  assert.deepEqual(config.expandScenario('root', root), [{ source: 'example/kit', why: 'Full', names: null }, { source: 'other/kit', why: 'Writing', names: ['beta'] }]);
  write('bad', { includes: [], skills: [{ source: 'x/y', why: 'r', names: null }] });
  assert.throws(() => config.readScenario(path.join(root, 'bad.yaml')));
  write('bad', { includes: [], skills: [], extra: true });
  assert.throws(() => config.readScenario(path.join(root, 'bad.yaml')));
});

test('scenario traversal, escaping symlinks, missing includes and cycles fail with useful paths', t => {
  const root = temporary(t);
  const dir = path.join(root, 'scenarios'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.yaml'), 'includes:\n  - b\nskills: []\n');
  fs.writeFileSync(path.join(dir, 'b.yaml'), 'includes:\n  - a\nskills: []\n');
  assert.throws(() => config.expandScenario('a', dir), /a.*b.*a/);
  for (const name of ['../outside', '/outside', 'sub/name', '.', '..', '--help']) assert.throws(() => config.expandScenario(name, dir));
  fs.writeFileSync(path.join(root, 'outside.yaml'), 'includes: []\nskills: []\n');
  fs.symlinkSync('../outside.yaml', path.join(dir, 'escape.yaml'));
  assert.throws(() => config.expandScenario('escape', dir), /outside|escape|contain/i);
  fs.writeFileSync(path.join(dir, 'b.yaml'), 'includes:\n  - missing\nskills: []\n');
  assert.throws(() => config.expandScenario('a', dir), { code: 'ENOENT' });
});

test('snapshot aliases merge without silent overwrite and conflicting aliases fail', () => {
  const input = { schema: 'skillsman.snapshot.v1', targets: {
    claude: { skills: [{ name: 'alpha', source: 'example/kit' }] },
    'claude-code': { skills: [{ name: 'beta', source: 'example/kit' }] }
  } };
  assert.deepEqual(config.parseSnapshot(text(input)).targets['claude-code'].skills.map(row => row.name), ['alpha', 'beta']);
  input.targets['claude-code'].skills = [{ name: 'alpha', source: 'other/kit' }];
  assert.throws(() => config.parseSnapshot(text(input)), /conflict/i);
});

test('all checked-in scenario documents remain readable with their original metadata', () => {
  const root = path.resolve(__dirname, '../scenarios');
  for (const file of fs.readdirSync(root).filter(name => name.endsWith('.yaml'))) {
    const scenario = config.readScenario(path.join(root, file));
    assert.equal(scenario.name, file.slice(0, -5));
    assert.equal(typeof scenario.title, 'string');
    assert.equal(typeof scenario.summary, 'string');
    assert(Array.isArray(scenario.skills));
  }
  assert(config.expandScenario('all', root).length > 0);
});

test('local source symlink spellings retain a single canonical identity',t=>{
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'skillsman-source-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'actual'));fs.symlinkSync('actual',path.join(dir,'alias'));
  assert.equal(config.canonicalSource(path.join(dir,'actual')),config.canonicalSource(path.join(dir,'alias')));
});

test('canonical ref encodings preserve the literal skill-filter delimiter', () => {
  assert.equal(config.canonicalSource('owner/repo#release/v2'), 'owner/repo#release%2Fv2');
  assert.equal(config.canonicalSource('owner/repo#release%2fv2'), 'owner/repo#release%2Fv2');
  assert.notEqual(config.canonicalSource('owner/repo#release@v2'), config.canonicalSource('owner/repo#release%40v2'));
  assert.equal(config.canonicalSource('owner/repo#release/v2@Name With Spaces'), 'owner/repo#release%2Fv2@Name%20With%20Spaces');
  assert.equal(config.canonicalSource('owner/repo#main@one@two'), 'owner/repo#main@one%40two');
  assert.notEqual(config.canonicalSource('owner/repo#main'), config.canonicalSource('owner/repo#other'));
  assert.notEqual(config.canonicalSource('owner/repo.git#main'), config.canonicalSource('owner/repo#main'));
  assert.equal(config.canonicalSource('/missing/local#release/v2'), '/missing/local#release/v2');
});

test('replaySource preserves the exact known GitHub skill directory and special ref', () => {
  assert.equal(typeof config.replaySource, 'function');
  const item = { name: 'Same Logical Name', source: 'owner/repo', sourceType: 'github', skillPath: 'nested/alpha/SKILL.md', ref: 'release@v2' };
  const before = JSON.stringify(item);
  assert.equal(config.replaySource(item), 'owner/repo/nested/alpha#release%40v2');
  assert.equal(JSON.stringify(item), before);
  assert.equal(config.replaySource({ ...item, skillPath: 'SKILL.md' }), 'owner/repo#release%40v2');
  assert.equal(config.replaySource({ ...item, source: 'https://github.com/owner/repo/tree/main/nested', ref: 'main' }), 'owner/repo/nested/alpha#main');
  assert.equal(config.replaySource({ ...item, source: 'owner/repo/nested#release%2Fv2', ref: 'release/v2' }), 'owner/repo/nested/alpha#release%2Fv2');
});

test('snapshot source reconstruction keeps local roots and refuses unsafe generic Git subpaths', () => {
  assert.equal(config.replaySource({ source: '/local/root#literal', sourceType: 'local', skillPath: 'nested/SKILL.md', ref: null }), '/local/root#literal');
  assert.equal(config.replaySource({ source: 'https://example.org/team/repo.git', sourceType: 'git', ref: 'release@v2' }), 'https://example.org/team/repo.git#release%40v2');
  for (const sourceType of ['git', 'gitlab']) {
    assert.throws(() => config.replaySource({ source: 'https://example.org/team/repo.git', sourceType, skillPath: 'nested/SKILL.md', ref: 'main' }), /replay|subpath/i);
  }
  for (const skillPath of ['../other/SKILL.md', '/absolute/SKILL.md', 'nested/../other/SKILL.md', 'nested#other/SKILL.md']) {
    assert.throws(() => config.replaySource({ source: 'owner/repo', sourceType: 'github', skillPath }), /path|replay/i);
  }
  assert.throws(() => config.replaySource({ source: null }), /source/i);
});

test('sourceMatches uses skillPath evidence to distinguish identical root and nested logical names', () => {
  assert.equal(typeof config.sourceMatches, 'function');
  const item = { name: 'Same Logical Name', source: 'owner/repo', sourceType: 'github', ref: 'main', skillPath: 'nested/SKILL.md' };
  assert(config.sourceMatches('owner/repo#main', item));
  assert(config.sourceMatches('owner/repo/nested#main', item));
  assert(!config.sourceMatches('owner/repo/nested#main', { ...item, skillPath: 'SKILL.md' }));
  assert(!config.sourceMatches('owner/repo/nested#main', { ...item, skillPath: 'nested-other/SKILL.md' }));
  assert(config.sourceMatches('owner/repo/nested#main', { ...item, skillPath: 'nested/deeper/SKILL.md' }));
  assert(!config.sourceMatches('owner/repo/other#main', item));
  assert(!config.sourceMatches('other/repo/nested#main', item));
  assert(!config.sourceMatches('owner/repo/nested#main', { ...item, skillPath: null }));
  assert(!config.sourceMatches('owner/repo/nested#main', { ...item, source: 'owner/repo/nested#main', skillPath: 'SKILL.md' }));
});

test('GitHub tree requests require the actual observed repo, single-segment ref, and skill directory', () => {
  const item = { name: 'alpha', source: 'owner/repo', sourceType: 'github', ref: 'main', skillPath: 'skills/alpha/SKILL.md' };
  assert(config.sourceMatches('https://github.com/owner/repo/tree/main/skills', item));
  assert(config.sourceMatches('https://github.com/owner/repo/tree/main/skills/alpha', item));
  assert(!config.sourceMatches('https://github.com/owner/repo/tree/other/skills', item));
  assert(!config.sourceMatches('https://github.com/owner/repo/tree/main/other', item));
  assert(!config.sourceMatches('owner/repo/skills#other', item));
  assert(!config.sourceMatches('https://github.com/owner/repo/tree/feature/v2/skills', { ...item, ref: 'feature/v2' }));
  assert(!config.sourceMatches('https://github.com/owner/repo/tree/feature%2Fv2/skills', { ...item, ref: 'feature/v2' }));
  assert(config.sourceMatches('owner/repo/skills#feature%2Fv2', { ...item, ref: 'feature/v2' }));
});

test('sourceMatches does not confuse a special ref with a skill filter or conflicting ref metadata', () => {
  const item = { name: 'v2', source: 'owner/repo', sourceType: 'github', ref: 'release@v2', skillPath: 'nested/SKILL.md' };
  assert(config.sourceMatches('owner/repo/nested#release%40v2', item));
  assert(!config.sourceMatches('owner/repo/nested#release@v2', item));
  assert(!config.sourceMatches('owner/repo/nested#release%40v2', { ...item, source: 'owner/repo#other' }));
  assert(!config.sourceMatches('owner/repo/nested#release%40v2@other', item));
});

test('sourceMatches keeps ordinary generic roots and local realpath comparisons conservative', t => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'actual'));
  fs.symlinkSync('actual', path.join(root, 'alias'));
  assert(config.sourceMatches('./alias', { source: path.join(root, 'actual'), sourceType: 'local' }, root));
  assert(config.sourceMatches('https://example.org/repo.git#release/v2', { source: 'https://example.org/repo.git#release%2Fv2', sourceType: 'git' }));
  assert(!config.sourceMatches('owner/repo', { source: 'owner/repo.git', sourceType: 'github' }));
  assert(!config.sourceMatches('owner/repo/nested', { source: 'owner/repo', sourceType: 'git', skillPath: 'nested/SKILL.md' }));
  assert(!config.sourceMatches('owner/repo', { source: null }));
});
