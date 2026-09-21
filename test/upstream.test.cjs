const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { makeProject, treeDigest } = require('./helpers/project.cjs');

function api() {
  const upstream = require('../lib/skillsman/upstream.cjs');
  assert.equal(typeof upstream.runSkills, 'function', 'upstream exports runSkills');
  return upstream;
}

function useEnvironment(t, project) {
  for (const key of ['PATH', 'SKILLSMAN_TEST_CONTROL', 'SKILLSMAN_TEST_LOG']) {
    const previous = process.env[key];
    process.env[key] = project.env[key];
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
}

function executable(project, body) {
  fs.writeFileSync(path.join(project.root, 'bin/npx'), '#!' + process.execPath + '\n' + body, { mode: 0o755 });
}

test('runSkills pins the package and inherits environment while keeping stderr separate', async t => {
  const p = makeProject(t);
  executable(p, `console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),flag:process.env.SKILLSMAN_TEST_FLAG})); console.error('diagnostic');`);
  const result = await api().runSkills(p.path, ['list', '--json'], { env: { ...p.env, SKILLSMAN_TEST_FLAG: 'inherited' } });
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.args, ['--yes', 'skills@1.5.26', 'list', '--json']);
  assert.equal(payload.cwd, fs.realpathSync(p.path));
  assert.equal(payload.flag, 'inherited');
  assert.equal(result.stderr.trim(), 'diagnostic');
});

test('nonzero upstream exit exposes operation, exit code, and stderr', async t => {
  const p = makeProject(t);
  await assert.rejects(api().runSkills(p.path, ['add', 'missing/source'], { env: p.env }), error => {
    assert.match(error.message, /add/);
    assert.match(error.message, /9/);
    assert.match(error.message, /fixture source unavailable/);
    assert.equal(error.exitCode, 9);
    return true;
  });
});

test('list all is unfiltered and unknown target is passed intact', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  assert.deepEqual(await api().listSkills(p.path), []);
  assert.deepEqual(await api().listSkills(p.path, 'test-agent'), []);
  assert.deepEqual(p.calls().map(call => call.args), [
    ['list', '--json'], ['list', '--json', '--agent', 'test-agent'],
  ]);
});

for (const value of ['{broken', '{}', '[{}]', '[{"name":"a","path":"/tmp/a","agents":"Codex","scope":"project"}]']) {
  test('list rejects invalid upstream JSON contract: ' + value, async t => {
    const p = makeProject(t);
    useEnvironment(t, p);
    executable(p, `console.log(${JSON.stringify(value)});`);
    await assert.rejects(api().listSkills(p.path), /JSON|array|item|agents/i);
  });
}

test('add preserves full names and maps all only for installation', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  p.configure({ catalog: { 'example/kit': { 'Name With Spaces': 'body', beta: 'body' } } });
  await api().addSkills(p.path, 'example/kit', ['Name With Spaces'], 'test-agent');
  assert.deepEqual(p.calls()[0].args, ['add', 'example/kit', '--skill', 'Name With Spaces', '--agent', 'test-agent', '-y', '--json']);
  await api().addSkills(p.path, 'example/kit', null, 'all');
  assert.deepEqual(p.calls()[1].args, ['add', 'example/kit', '--agent', '*', '-y', '--json']);
  await assert.rejects(api().addSkills(p.path, 'example/kit', [], 'codex'), /names|empty|nonempty/i);
});

test('timeout kills only its own process group, including detached-output descendants', async t => {
  const p = makeProject(t);
  const marker = path.join(p.root, 'orphan-write');
  const ready = path.join(p.root, 'child-ready');
  const childBody = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'orphan'),3000);setInterval(()=>{},1000);`;
  executable(p, `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childBody)}],{stdio:'ignore'});setInterval(()=>{},1000);`);
  await assert.rejects(api().runSkills(p.path, ['add', 'example/kit'], {
    env: p.env, timeoutMs: 1500, killGraceMs: 100,
  }), /timed out|timeout/i);
  assert(fs.existsSync(ready), 'descendant actually started');
  const pid = Number(fs.readFileSync(ready, 'utf8'));
  // A killed child may briefly remain a zombie until the OS reaps it.
  await delay(3200);
  assert.equal(fs.existsSync(marker), false, 'no descendant writes after rejection');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('probe observes selected digest evidence in a temporary project, then cleans it', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  const before = treeDigest(p.path);
  const result = await api().probeSelected(p.path, 'example/kit', ['alpha']);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.items.map(item => item.name), ['alpha']);
  assert.equal(result.items[0].source, 'example/kit');
  assert.match(result.items[0].digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(treeDigest(p.path), before);
  const installation = p.calls().find(call => call.args[0] === 'add');
  assert.notEqual(installation.cwd, p.path);
  assert.deepEqual(installation.args, ['add', 'example/kit', '--skill', 'alpha', '--agent', 'codex', '-y', '--json']);
  assert.equal(fs.existsSync(installation.cwd), false);
});

test('probe reports silently skipped names and unavailable sources', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  p.configure({ skipNames: ['alpha'] });
  assert((await api().probeSelected(p.path, 'example/kit', ['alpha'])).problems.length > 0);
  assert((await api().probeSelected(p.path, 'missing/source', ['alpha'])).problems.length > 0);
  for (const call of p.calls()) assert.equal(fs.existsSync(call.cwd), false);
});

test('probe resolves local source against caller while preserving relative intent', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  const source = path.join(p.root, 'local-source');
  fs.mkdirSync(source);
  p.configure({ catalog: { [source]: { alpha: 'local' } } });
  const result = await api().probeSelected(p.path, '../local-source', ['alpha']);
  assert.deepEqual(result.problems, []);
  assert.equal(p.calls()[0].args[1], source);
  assert.equal(result.items[0].source, source);
});

test('probe can deliberately enumerate a full source using null names', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  const result = await api().probeSelected(p.path, 'example/kit', null);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.items.map(item => item.name).sort(), ['alpha', 'beta', 'gamma']);
  assert(!p.calls()[0].args.includes('--skill'));
});

test('UTF-8 output survives multibyte characters split across pipe chunks', async t => {
  const p = makeProject(t);
  executable(p, "const b=Buffer.from('技能');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),40);");
  const result = await api().runSkills(p.path, ['list'], { env: p.env });
  assert.equal(result.stdout, '技能');
});

test('failed spawn returns a concrete error and leaves no signal handlers', async t => {
  const p = makeProject(t);
  const before = process.listenerCount('SIGTERM');
  await assert.rejects(api().runSkills(p.path, ['list'], { env: { PATH: path.join(p.root, 'missing') } }), /could not start.*ENOENT/);
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('probe detects unexpected installation outside the requested target', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  const fixture = path.resolve(__dirname, 'fixtures/fake-npx.cjs');
  executable(p, `
    const fs=require('fs'),path=require('path');
    if(process.argv.includes('add')) {
      const extra=path.join(process.cwd(),'.claude/skills/extra');
      fs.mkdirSync(extra,{recursive:true});
      fs.writeFileSync(path.join(extra,'SKILL.md'),'---\\nname: extra\\ndescription: extra\\n---\\n');
    }
    require(${JSON.stringify(fixture)});
  `);
  const result = await api().probeSelected(p.path, 'example/kit', ['alpha']);
  assert(result.problems.some(problem => problem.code === 'UNEXPECTED_SKILL'));
});

test('add accepts an explicit array of targets in one upstream call', async t => {
  const p = makeProject(t);
  useEnvironment(t, p);
  await api().addSkills(p.path, 'example/kit', ['alpha'], ['codex', 'cursor']);
  assert.deepEqual(p.calls()[0].args, ['add', 'example/kit', '--skill', 'alpha', '--agent', 'codex', 'cursor', '-y', '--json']);
  await assert.rejects(api().addSkills(p.path, 'example/kit', ['alpha'], []), /target/i);
});
