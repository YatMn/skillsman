const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeProject } = require('./helpers/project.cjs');

function api() {
  const inventory = require('../lib/skillsman/inventory.cjs');
  assert.equal(typeof inventory.readInventory, 'function', 'inventory exports readInventory');
  return inventory;
}
function skill(project, directory = '.agents/skills/alpha', name = 'alpha') {
  const location = path.join(project.path, directory);
  fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(path.join(location, 'SKILL.md'), `---\nname: ${JSON.stringify(name)}\ndescription: Test skill\n---\nBody\n`);
  return location;
}
function raw(location, agents = ['Codex'], overrides = {}) {
  return { name: 'alpha', path: location, scope: 'project', agents, source: 'example/kit', sourceType: 'github', sourceUrl: null, ...overrides };
}
function upstream(rows, filtered = {}) {
  const calls = [];
  return { calls, async listSkills(project, target) { calls.push(target); return filtered[target] ?? rows; } };
}
function lock(project, skills) {
  fs.writeFileSync(path.join(project.path, 'skills-lock.json'), JSON.stringify({ version: 1, skills }));
}

test('inventory reads one unfiltered list and each unique requested filter, preserving shared real paths', async t => {
  const p = makeProject(t);
  const location = skill(p);
  fs.mkdirSync(path.join(p.path, '.claude/skills'), { recursive: true });
  fs.symlinkSync(location, path.join(p.path, '.claude/skills/alpha'));
  const adapter = upstream([raw(location, ['Codex', 'Claude Code'])]);
  const result = await api().readInventory(p.path, ['codex', 'claude-code', 'codex'], adapter);
  assert.deepEqual(adapter.calls, ['all', 'codex', 'claude-code']);
  assert.deepEqual(result.problems, []);
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.deepEqual(item.sharedTargets.sort(), ['claude-code', 'codex']);
    assert.deepEqual(item.agentLabels.sort(), ['Claude Code', 'Codex']);
    assert.equal(item.realPath, fs.realpathSync(location));
    assert.match(item.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(item.revision, null);
    assert.equal(item.source, 'example/kit');
  }
});

test('all reuses unfiltered data and keeps actual targets, not the all sentinel', async t => {
  const p = makeProject(t);
  const adapter = upstream([raw(skill(p), ['Codex', 'OpenClaw'])]);
  const result = await api().readInventory(p.path, ['all'], adapter);
  assert.deepEqual(adapter.calls, ['all']);
  assert.deepEqual(result.items.map(item => item.target).sort(), ['codex', 'openclaw']);
});

test('unknown display labels remain explicit unknown associations', async t => {
  const p = makeProject(t);
  const result = await api().readInventory(p.path, ['codex'], upstream([raw(skill(p), ['Codex', 'Mystery Bot'])]));
  assert(result.items[0].sharedTargets.includes('unknown:Mystery Bot'));
  assert(result.problems.some(problem => /unknown/i.test(problem.code)));
});

test('unknown target is filtered upstream without guessing a directory or display name', async t => {
  const p = makeProject(t);
  const adapter = upstream([raw(skill(p), ['Codex', 'Mystery Bot'])]);
  const result = await api().readInventory(p.path, ['mystery-agent'], adapter);
  assert.deepEqual(adapter.calls, ['all', 'mystery-agent']);
  assert(!result.items.some(item => item.target === 'mystery-agent'));
  assert(result.problems.length > 0);
});

test('a filtered result mentioning another agent does not prove requested installation', async t => {
  const p = makeProject(t);
  const location = skill(p, 'elsewhere/alpha');
  const result = await api().readInventory(p.path, ['cursor'], upstream([raw(location, ['Claude Code'])]));
  assert.equal(result.items.length, 0);
});

test('disk scan supplements omitted skills using YAML logical names and raw lock install names', async t => {
  const p = makeProject(t);
  skill(p, '.cursor/skills/name-with-spaces', 'Name With Spaces');
  lock(p, { 'name-with-spaces': { source: 'https://example.org/team/repo.git#stable', sourceType: 'git' } });
  const result = await api().readInventory(p.path, ['cursor'], upstream([]));
  assert.deepEqual(result.problems, []);
  assert.equal(result.items[0].name, 'Name With Spaces');
  assert.equal(result.items[0].source, 'https://example.org/team/repo.git#stable');
  assert.equal(result.items[0].target, 'cursor');
});

test('lock URL, ref and subpath evidence survives inventory normalization', async t => {
  const p = makeProject(t);
  const location = skill(p);
  lock(p, { alpha: { source: 'team/repo', sourceUrl: 'https://example.org/team/repo.git', sourceType: 'git', ref: 'release/v2', skillPath: 'skills/alpha/SKILL.md' } });
  const result = await api().readInventory(p.path, ['codex'], upstream([raw(location, ['Codex'], { source: 'team/repo', sourceType: 'git' })]));
  assert.equal(result.items[0].source, 'https://example.org/team/repo.git#release%2Fv2');
  assert.equal(result.items[0].skillPath, 'skills/alpha/SKILL.md');
});

test('local lock source resolves against the project before comparison', async t => {
  const p = makeProject(t);
  skill(p);
  lock(p, { alpha: { source: '../source', sourceType: 'local' } });
  const result = await api().readInventory(p.path, ['codex'], upstream([]));
  assert.equal(result.items[0].source, path.resolve(p.path, '../source'));
  assert.equal(result.items[0].canonicalSource, path.resolve(p.path, '../source'));
});

test('absent source evidence is null, never inferred from skill name', async t => {
  const p = makeProject(t);
  skill(p);
  const result = await api().readInventory(p.path, ['codex'], upstream([]));
  assert.equal(result.items[0].source, null);
});

for (const data of ['{broken', '[]', '{"version":1,"skills":[]}', '{"version":1,"skills":{"alpha":{"source":4}}}']) {
  test('existing malformed raw lock is not an empty inventory: ' + data, async t => {
    const p = makeProject(t);
    fs.writeFileSync(path.join(p.path, 'skills-lock.json'), data);
    const adapter = upstream([]);
    await assert.rejects(api().readInventory(p.path, ['codex'], adapter), /lock|source/i);
    assert.deepEqual(adapter.calls, []);
  });
}

test('broken skill and top-level directory links are reported even when upstream omits them', async t => {
  const p = makeProject(t);
  fs.mkdirSync(path.join(p.path, '.agents/skills'), { recursive: true });
  fs.symlinkSync('missing', path.join(p.path, '.agents/skills/broken'));
  fs.mkdirSync(path.join(p.path, '.cursor'), { recursive: true });
  fs.symlinkSync('missing', path.join(p.path, '.cursor/skills'));
  const result = await api().readInventory(p.path, ['codex'], upstream([]));
  assert(result.problems.some(problem => /broken/.test(problem.message)));
  assert(result.problems.some(problem => /cursor/.test(problem.message)));
});

test('malformed frontmatter is reported instead of trusting the directory name', async t => {
  const p = makeProject(t);
  const location = skill(p);
  fs.writeFileSync(path.join(location, 'SKILL.md'), '---\nname: [\n---\n');
  const result = await api().readInventory(p.path, ['codex'], upstream([raw(location)]));
  assert(result.problems.length > 0);
  assert(result.items.every(item => item.digest === null));
});

test('separate copies are not confused with physically shared skills', async t => {
  const p = makeProject(t);
  const canonical = skill(p);
  const copy = skill(p, '.claude/skills/alpha');
  const result = await api().readInventory(p.path, ['codex', 'claude-code'], upstream([raw(canonical, ['Codex', 'Claude Code'])]));
  const codex = result.items.find(item => item.target === 'codex');
  const claude = result.items.find(item => item.target === 'claude-code');
  assert.notEqual(codex.realPath, claude.realPath);
  assert.equal(claude.realPath, fs.realpathSync(copy));
  assert.deepEqual(codex.sharedTargets, ['codex']);
  assert.deepEqual(claude.sharedTargets, ['claude-code']);
});

test('list errors propagate instead of permitting a missing-skill installation', async t => {
  const p = makeProject(t);
  await assert.rejects(api().readInventory(p.path, ['codex'], { async listSkills() { throw new Error('upstream unavailable'); } }), /unavailable/);
});


test('unfiltered labels cannot override a missing filtered target without disk evidence', async t => {
  const p = makeProject(t);
  const location = skill(p, 'elsewhere/alpha');
  const result = await api().readInventory(p.path, ['codex'], upstream([raw(location)], { codex: [] }));
  assert.deepEqual(result.items, []);
});

test('actual universal agent labels preserve all shared IDs despite a narrow filter', async t => {
  const p = makeProject(t);
  const location = skill(p);
  const labels = ['Antigravity', 'Codex', 'Cursor', 'Gemini CLI', 'GitHub Copilot', 'Zed'];
  const adapter = upstream([raw(location, labels)], { codex: [raw(location)] });
  const result = await api().readInventory(p.path, ['codex'], adapter);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.items[0].sharedTargets.sort(), ['antigravity', 'codex', 'cursor', 'gemini-cli', 'github-copilot', 'zed']);
});

test('conflicting raw list and lock sources are explicit, not silently preferred', async t => {
  const p = makeProject(t);
  const location = skill(p);
  lock(p, { alpha: { source: 'other/repo', sourceType: 'github' } });
  const result = await api().readInventory(p.path, ['codex'], upstream([raw(location)]));
  assert(result.problems.some(problem => problem.code === 'SOURCE_CONFLICT'));
});

test('unreadable directories and broken raw lock links are explicit failures', async t => {
  const p = makeProject(t);
  const directory = path.join(p.path, '.agents/skills');
  fs.mkdirSync(directory, { recursive: true });
  fs.chmodSync(directory, 0o000);
  try {
    const result = await api().readInventory(p.path, ['codex'], upstream([]));
    assert(result.problems.some(problem => problem.code === 'DIRECTORY_UNREADABLE'));
  } finally { fs.chmodSync(directory, 0o755); }
  fs.symlinkSync('missing-lock', path.join(p.path, 'skills-lock.json'));
  await assert.rejects(api().readInventory(p.path, ['codex'], upstream([])), /lock/);
});

test('an internal escaping link makes the item content unverifiable', async t => {
  const p = makeProject(t);
  const location = skill(p);
  fs.writeFileSync(path.join(p.root, 'external'), 'outside');
  fs.symlinkSync(path.join(p.root, 'external'), path.join(location, 'reference'));
  const result = await api().readInventory(p.path, ['codex'], upstream([raw(location)]));
  assert.equal(result.items[0].digest, null);
  assert(result.problems.some(problem => problem.code === 'CONTENT_UNREADABLE'));
});


test('allItems retains nonrequested occurrences while items stays target filtered', async t => {
  const p = makeProject(t);
  const codexPath = skill(p);
  const cursorPath = skill(p, '.cursor/skills/alpha');
  const rows = [raw(codexPath), raw(cursorPath, ['Cursor'])];
  const result = await api().readInventory(p.path, ['codex'], upstream(rows, { codex: [rows[0]] }));
  assert.deepEqual(result.items.map(item => item.target), ['codex']);
  assert.deepEqual(result.allItems.map(item => item.target).sort(), ['codex', 'cursor']);
  assert(result.allItems.includes(result.items[0]), 'both views preserve the same evidence objects');
  assert.equal(result.allItems.find(item => item.target === 'cursor').realPath, fs.realpathSync(cursorPath));
});

test('relative raw local lock and absolute list source are the same source', async t => {
  const p = makeProject(t);
  const location = skill(p);
  const project = fs.realpathSync(p.path);
  const source = path.resolve(project, '../source');
  fs.mkdirSync(source);
  lock(p, { alpha: { source: '../source', sourceType: 'local' } });
  const adapter = upstream([raw(location, ['Codex'], { source, sourceType: 'local' })]);
  const result = await api().readInventory(project, ['codex'], adapter);
  assert.deepEqual(result.problems, []);
  assert.equal(result.items[0].source, source);
  assert.equal(result.items[0].canonicalSource, source);
});

test('local source aliases compare by existing realpath rather than lexical paths', async t => {
  const p = makeProject(t);
  const location = skill(p);
  const source = path.join(p.root, 'source');
  const alias = path.join(p.root, 'source-alias');
  fs.mkdirSync(source);
  fs.symlinkSync(source, alias);
  lock(p, { alpha: { source: '../source-alias', sourceType: 'local' } });
  const adapter = upstream([raw(location, ['Codex'], { source: fs.realpathSync(source), sourceType: 'local' })]);
  const result = await api().readInventory(p.path, ['codex'], adapter);
  assert.deepEqual(result.problems, []);
  assert.equal(result.items[0].canonicalSource, fs.realpathSync(source));
});


test('fixture-only Test Agent stays an unknown association in production inventory', async t => {
  const p = makeProject(t);
  const result = await api().readInventory(p.path, ['all'], upstream([raw(skill(p), ['Codex', 'Test Agent'])]));
  assert(result.allItems.some(item => item.target === 'unknown:Test Agent'));
  assert(!result.allItems.some(item => item.target === 'test-agent'));
  assert(result.problems.some(problem => problem.code === 'UNKNOWN_AGENT'));
});


test('inventory encodes literal ref delimiters and preserves replayable GitHub subpath evidence', async t => {
  const p = makeProject(t);
  const location = skill(p, '.agents/skills/same-logical-name', 'Same Logical Name');
  lock(p, { 'Same Logical Name': { source: 'owner/repo', sourceType: 'github', ref: 'release@v2', skillPath: 'nested/SKILL.md' } });
  const rows = [raw(location, ['Codex'], { name: 'Same Logical Name', source: 'owner/repo' })];
  const result = await api().readInventory(p.path, ['codex'], upstream(rows));
  assert.deepEqual(result.problems, []);
  assert.equal(result.items[0].source, 'owner/repo#release%40v2');
  assert.equal(result.items[0].ref, 'release@v2');
  const { replaySource, sourceMatches } = require('../lib/skillsman/config.cjs');
  assert.equal(replaySource(result.items[0]), 'owner/repo/nested#release%40v2');
  assert(sourceMatches('owner/repo/nested#release%40v2', result.items[0], p.path));
  assert(!sourceMatches('owner/repo/other#release%40v2', result.items[0], p.path));
});
