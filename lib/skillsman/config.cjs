'use strict';
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const controls = /[\u0000-\u001f\u007f-\u009f]/u;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function objectKeys(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
  for (const key of required) if (!own(value, key)) throw new Error(`Missing ${label} field: ${key}`);
}
function string(value, label, argument = false) {
  if (typeof value !== 'string' || !value.trim() || controls.test(value)) throw new Error(`${label} must be a nonempty string without control characters`);
  if (argument && /^\s*-/.test(value)) throw new Error(`${label} must not be a command option`);
  return value;
}
function parseDocument(text) {
  if (typeof text !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) throw new Error('Invalid YAML text or control characters');
  const docs = YAML.parseAllDocuments(text, { uniqueKeys: true, strict: true });
  if (docs.length !== 1 || docs[0].errors.length || docs[0].warnings.length) throw new Error('Expected one valid YAML document');
  YAML.visit(docs[0], (_key, node) => {
    if (YAML.isAlias(node) || node?.anchor || node?.tag) throw new Error('Anchors, aliases and explicit tags are not supported');
    if (node?.flow && node?.items?.length) throw new Error('Use block collections; only empty flow collections are supported');
  });
  return docs[0].toJS({ maxAliasCount: 0 });
}

// Mirrors skills@1.5.26 src/installer.ts sanitizeName; it is an identity for
// collision checks, never a replacement for the user's complete skill name.
function installName(name) {
  string(name, 'name', true);
  return name.toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '').substring(0, 255) || 'unnamed-skill';
}
function canonicalSource(source, project) {
  string(source, 'source', true);
  if (path.isAbsolute(source) || (project !== undefined && /^(?:\.{1,2}(?:\/|$))/.test(source))) {
    const resolved = path.resolve(project || '.', source);
    try { return fs.realpathSync(resolved); } catch (error) { if (error.code !== 'ENOENT') throw error; return resolved; }
  }
  // Do not drop case, .git, trailing slashes, subpaths, query strings or refs.
  return normalizeFragment(source.replace(/^https?:\/\/github\.com\/(?=[^/]+\/[^/]+)/, ''));
}
// Upstream splits at the first literal @ before percent-decoding either part.
function sourceFragment(source) {
  const hash = source.indexOf('#');
  if (hash < 0) return { base: source, ref: null, filter: null, fragment: false };
  const fragment = source.slice(hash + 1);
  const at = fragment.indexOf('@');
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };
  return { base: source.slice(0, hash), ref: decode(at < 0 ? fragment : fragment.slice(0, at)),
    filter: at < 0 ? null : decode(fragment.slice(at + 1)), fragment: true };
}
function fragmentSuffix(ref, filter = null) {
  if (ref == null && filter == null) return '';
  return '#' + encodeURIComponent(ref ?? '') + (filter == null ? '' : '@' + encodeURIComponent(filter));
}
function normalizeFragment(source) {
  const parts = sourceFragment(source);
  return parts.base + (parts.fragment ? fragmentSuffix(parts.ref, parts.filter) : '');
}
function sourceDirectory(value) {
  if (typeof value !== 'string' || /[\\#?:\u0000-\u001f]/.test(value) || value.startsWith('/') || value.split('/').includes('..')) {
    throw new Error(`Cannot safely replay source subpath: ${value}`);
  }
  return value.split('/').filter(part => part && part !== '.').join('/');
}
function skillDirectory(item) {
  if (item.skillPath == null) return null;
  const value = sourceDirectory(item.skillPath);
  return value === 'SKILL.md' ? '' : value.replace(/\/SKILL\.md$/, '');
}
function githubSource(source) {
  const parts = sourceFragment(source);
  const url = /^https?:\/\/github\.com\//.test(parts.base);
  const base = url ? parts.base.replace(/^https?:\/\/github\.com\//, '') : parts.base;
  const match = base.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/(.*))?$/);
  if (!match) return null;
  let directory = match[2] || '';
  let ref = parts.ref || null;
  if (url && directory) {
    const tree = directory.match(/^tree\/([^/]+)(?:\/(.*))?$/);
    if (!tree) return null;
    // skills@1.5.26 takes this path segment literally, without decoding it.
    ref = tree[1];
    directory = tree[2] || '';
  }
  return { repo: match[1], directory: sourceDirectory(directory), ref, filter: parts.filter || null };
}
function localSource(item) {
  return item.sourceType === 'local' || path.isAbsolute(item.source) || /^(?:\.{1,2})(?:\/|$)/.test(item.source);
}
function observedSource(item) {
  string(item?.source, 'source', true);
  if (localSource(item)) return item.source;
  const parts = sourceFragment(item.source);
  const github = githubSource(item.source);
  const existingRef = github?.ref ?? (parts.ref || null);
  if (item.ref != null) {
    string(item.ref, 'source ref');
    if (existingRef != null && existingRef !== item.ref) throw new Error('Conflicting source ref evidence');
    if (existingRef == null) return parts.base + fragmentSuffix(item.ref, parts.filter);
  }
  return normalizeFragment(item.source);
}
function withinDirectory(directory, parent) {
  return parent === '' || directory === parent || directory.startsWith(parent + '/');
}

function replaySource(item) {
  const source = observedSource(item);
  if (localSource(item)) return source;
  const directory = skillDirectory(item);
  if (directory == null) return source;
  const github = (item.sourceType == null || item.sourceType === 'github') ? githubSource(source) : null;
  if (!github) {
    if (directory) throw new Error(`Cannot safely replay ${item.sourceType || 'unknown'} source subpath: ${item.skillPath}`);
    return source;
  }
  if (!withinDirectory(directory, github.directory)) throw new Error('Source subpath conflicts with observed skillPath');
  if (github.filter && github.filter !== item.name) throw new Error('Source skill filter conflicts with observed name');
  return github.repo + (directory ? '/' + directory : '') + fragmentSuffix(github.ref, github.filter);
}

function sourceMatches(requested, item, project) {
  if (!item?.source) return false;
  try {
    const observed = observedSource(item);
    if (localSource(item)) return canonicalSource(requested, project) === canonicalSource(observed, project);
    const wanted = githubSource(requested);
    const actual = (item.sourceType == null || item.sourceType === 'github') ? githubSource(observed) : null;
    if (wanted && actual) {
      if (wanted.repo !== actual.repo || wanted.ref !== actual.ref) return false;
      if ((wanted.filter && wanted.filter !== item.name) || (actual.filter && actual.filter !== item.name)) return false;
      if (wanted.directory || actual.directory) {
        const directory = skillDirectory(item);
        return directory !== null && withinDirectory(directory, wanted.directory) && withinDirectory(directory, actual.directory);
      }
    }
    return canonicalSource(requested, project) === canonicalSource(observed, project);
  } catch {
    return false;
  }
}
function namesList(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('names must be an explicit nonempty list');
  return value.map(name => {
    string(name, 'name', true);
    if (/[\*?\[\]]/.test(name)) throw new Error('Wildcard names are not supported');
    return name;
  });
}
function skillEntries(value, scenario = false) {
  if (!Array.isArray(value)) throw new Error('skills must be a list');
  return value.map(entry => {
    objectKeys(entry, ['source', 'why', 'names'], scenario ? ['source', 'why'] : ['source', 'why', 'names'], 'skill');
    return { source: string(entry.source, 'source', true), why: string(entry.why, 'why'), names: scenario && !own(entry, 'names') ? null : namesList(entry.names) };
  });
}
function normalizeSelection(entries) {
  const sources = new Map(); const installations = new Map();
  for (const entry of entries) {
    const source = canonicalSource(entry.source);
    let group = sources.get(source);
    if (!group) { group = { source: entry.source, why: entry.why, names: [] }; sources.set(source, group); }
    for (const name of entry.names) {
      const key = installName(name); const previous = installations.get(key);
      if (previous && (previous.source !== source || previous.name !== name)) throw new Error(`Skill identity conflict: ${previous.name} (${previous.source}) and ${name} (${source}) share ${key}`);
      if (!previous) { installations.set(key, { source, name }); group.names.push(name); }
    }
  }
  return { includes: [], skills: [...sources.values()] };
}
function validateSelection(value) {
  objectKeys(value, ['includes', 'skills'], ['includes', 'skills'], 'selection');
  if (!Array.isArray(value.includes) || value.includes.length) throw new Error('Selection includes must be []');
  return normalizeSelection(skillEntries(value.skills));
}
function parseSelection(text) { return validateSelection(parseDocument(text)); }
function readSelection(file) { return parseSelection(fs.readFileSync(file, 'utf8')); }
function serializeSelection(selection) { return YAML.stringify(validateSelection(selection), { lineWidth: 0 }); }
function mergeSelection(existing, addition) {
  return normalizeSelection([...validateSelection(existing).skills, ...validateSelection(addition).skills]);
}
function targetName(value) {
  string(value, 'target', true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) throw new Error(`Invalid target: ${value}`);
  return value === 'claude' ? 'claude-code' : value === 'gemini' ? 'gemini-cli' : value;
}
function parseSnapshot(text) {
  const value = parseDocument(text);
  objectKeys(value, ['schema', 'targets'], ['schema', 'targets'], 'snapshot');
  if (value.schema !== 'skillsman.snapshot.v1') throw new Error('Unsupported snapshot schema');
  if (!value.targets || typeof value.targets !== 'object' || Array.isArray(value.targets)) throw new Error('Snapshot targets must be an object');
  const groups = new Map();
  for (const [rawTarget, entry] of Object.entries(value.targets)) {
    const target = targetName(rawTarget);
    objectKeys(entry, ['skills'], ['skills'], 'snapshot target');
    // The existing v1 writer emits `skills:` for an empty target.
    const rows = entry.skills === null ? [] : entry.skills;
    if (!Array.isArray(rows)) throw new Error('Snapshot skills must be a list');
    const seen = groups.get(target) || new Map(); groups.set(target, seen);
    for (const row of rows) {
      objectKeys(row, ['name', 'source'], ['name', 'source'], 'snapshot skill');
      const name = namesList([row.name])[0]; const source = string(row.source, 'source', true);
      const key = installName(name); const previous = seen.get(key);
      if (previous && (previous.name !== name || canonicalSource(previous.source) !== canonicalSource(source))) throw new Error(`Snapshot skill conflict: ${name}`);
      if (!previous) seen.set(key, { name, source });
    }
  }
  return { schema: value.schema, targets: Object.fromEntries([...groups].map(([target, entries]) => [target, { skills: [...entries.values()] }])) };
}
function scenarioName(name) {
  string(name, 'scenario', true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw new Error(`Invalid scenario name or path traversal: ${name}`);
  return name;
}
function readScenario(file) {
  const value = parseDocument(fs.readFileSync(file, 'utf8'));
  objectKeys(value, ['name', 'title', 'summary', 'includes', 'skills'], ['includes', 'skills'], 'scenario');
  if (!Array.isArray(value.includes)) throw new Error('Scenario includes must be a list');
  const result = { includes: value.includes.map(scenarioName), skills: skillEntries(value.skills, true) };
  for (const key of ['name', 'title', 'summary']) if (own(value, key)) result[key] = string(value[key], key);
  return result;
}
function expandScenario(name, scenarioDir) {
  const base = fs.realpathSync(scenarioDir); const done = new Set(); const active = []; const result = [];
  function expand(current) {
    scenarioName(current);
    if (active.includes(current)) throw new Error(`Scenario cycle: ${[...active, current].join(' -> ')}`);
    if (done.has(current)) return;
    const file = fs.realpathSync(path.join(base, current + '.yaml'));
    const relative = path.relative(base, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Scenario escapes directory: ${current}`);
    active.push(current);
    const scenario = readScenario(file);
    for (const included of scenario.includes) expand(included);
    result.push(...scenario.skills);
    active.pop(); done.add(current);
  }
  expand(name);
  return result;
}
module.exports = { parseSelection, readSelection, serializeSelection, mergeSelection, parseSnapshot, readScenario, expandScenario, canonicalSource, installName, replaySource, sourceMatches };
