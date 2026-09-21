const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const firstPartySkills = ['agents-md', 'branch', 'manage', 'next-prompt', 'openspec', 'readme']
  .map(suffix => `skillsman-${suffix}`);
const requiredModules = ['config', 'inventory', 'plan', 'project', 'state', 'upstream'];

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsman-package-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function filesUnder(directory, relative = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.posix.join(relative, entry.name);
    const location = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Bundled source must not be a symbolic link: ${location}`);
    if (entry.isDirectory()) return filesUnder(location, name);
    assert(entry.isFile(), `Expected a regular bundled file: ${location}`);
    return [name];
  });
}

function verifyPackage(directory, cache) {
  // This is npm's real packing decision; offline mode and disabled lifecycle
  // scripts keep this test independent of the network and repository writes.
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--offline', '--ignore-scripts', '--cache', cache], {
    cwd: directory, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  const result = JSON.parse(output);
  assert.equal(result.length, 1, 'npm pack should describe exactly one package');
  const packed = new Map(result[0].files.map(file => [file.path, file]));
  for (const name of firstPartySkills) {
    const relative = `skills/${name}`;
    const skillDirectory = path.join(directory, relative);
    assert(fs.lstatSync(skillDirectory).isDirectory(), `Expected a real first-party directory: ${relative}`);
    const markdown = fs.readFileSync(path.join(skillDirectory, 'SKILL.md'), 'utf8');
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    assert(match, `Missing frontmatter: ${relative}/SKILL.md`);
    const metadata = YAML.parse(match[1], { uniqueKeys: true });
    assert.equal(metadata.name, name, `Frontmatter name must match ${relative}`);
    assert.equal(typeof metadata.description, 'string', `${relative} needs a description`);
    assert(metadata.description.trim(), `${relative} needs a nonempty description`);
    const agentMetadata = path.join(skillDirectory, 'agents/openai.yaml');
    assert(fs.statSync(agentMetadata).isFile(), `Missing agents/openai.yaml: ${relative}`);
    assert(YAML.parse(fs.readFileSync(agentMetadata, 'utf8')), `Invalid agent metadata: ${relative}`);
    for (const file of filesUnder(skillDirectory)) {
      assert(packed.has(`${relative}/${file}`), `Package omitted bundled skill resource: ${relative}/${file}`);
    }
    // Validate explicit bundled-resource references without interpreting README
    // examples or external URLs as files that belong to a skill.
    const references = [...markdown.matchAll(/(?:`|\]\()((?:references|scripts|agents)\/[^\s`\)]+)(?:`|\))/g)];
    for (const [, reference] of references) {
      const resource = reference.split('#')[0];
      assert(fs.statSync(path.join(skillDirectory, resource)).isFile(), `Missing referenced resource: ${relative}/${resource}`);
      assert(packed.has(`${relative}/${resource}`), `Package omitted referenced resource: ${relative}/${resource}`);
    }
  }
  for (const document of ['README.md', 'README.zh-CN.md']) {
    assert(packed.has(document), `Package omitted README: ${document}`);
    const markdown = fs.readFileSync(path.join(directory, document), 'utf8');
    for (const [, target] of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const resource = target.split('#')[0];
      assert(fs.statSync(path.join(directory, resource)).isFile(), `Broken README reference: ${document} -> ${resource}`);
      assert(packed.has(resource), `Package omitted README reference: ${document} -> ${resource}`);
    }
  }
  for (const name of requiredModules) {
    assert(packed.has(`lib/skillsman/${name}.cjs`), `Package omitted runtime module: lib/skillsman/${name}.cjs`);
  }
  for (const file of filesUnder(path.join(directory, 'lib'))) {
    assert(packed.has(`lib/${file}`), `Package omitted runtime module or resource: lib/${file}`);
  }
  for (const file of ['bin/skillsman', 'test/smoke-real-upstream.sh']) {
    assert(packed.has(file), `Package omitted executable entry: ${file}`);
  }
  assert(packed.get('bin/skillsman').mode & 0o111, 'Packaged CLI must be executable');
  for (const file of packed.keys()) {
    assert(!/^(?:\.agents|\.codex|node_modules)\//.test(file), `Package includes workspace-only content: ${file}`);
  }
  return result[0];
}

function copySource(destination) {
  fs.mkdirSync(destination);
  for (const name of ['package.json', 'bin', 'lib', 'scenarios', 'skills', 'test', 'examples', 'README.md', 'README.zh-CN.md', 'LICENSE']) {
    const source = path.join(root, name);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(destination, name), { recursive: true, dereference: false });
  }
}

test('actual npm pack includes six real skills, their resources, and every runtime module', t => {
  const cache = temporary(t);
  verifyPackage(root, cache);
});

test('package guard catches a linked first-party directory in a disposable copy', t => {
  const scratch = temporary(t);
  const copy = path.join(scratch, 'repository');
  copySource(copy);
  const skill = path.join(copy, 'skills/skillsman-agents-md');
  const external = path.join(scratch, 'external-skill');
  fs.renameSync(skill, external);
  fs.symlinkSync(external, skill);
  assert.throws(() => verifyPackage(copy, path.join(scratch, 'cache')), /real first-party directory/);
  fs.unlinkSync(skill);
  fs.renameSync(external, skill);
  verifyPackage(copy, path.join(scratch, 'cache'));
});

test('package guard catches omitted lib files even though source modules still exist', t => {
  const scratch = temporary(t);
  const copy = path.join(scratch, 'repository');
  copySource(copy);
  const metadataPath = path.join(copy, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  metadata.files = metadata.files.filter(entry => entry.replace(/\/$/, '') !== 'lib');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  assert.throws(() => verifyPackage(copy, path.join(scratch, 'cache')), /omitted runtime module/);
});
