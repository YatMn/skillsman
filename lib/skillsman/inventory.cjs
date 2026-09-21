const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { installName, canonicalSource } = require('./config.cjs');
const { digestSkill } = require('./state.cjs');

// Upstream JSON contains display labels, not command-line agent identifiers.
const AGENT_IDS = {
  Codex: 'codex',
  'Claude Code': 'claude-code',
  Cursor: 'cursor',
  OpenClaw: 'openclaw',
  Antigravity: 'antigravity',
  'Gemini CLI': 'gemini-cli',
  'GitHub Copilot': 'github-copilot',
  Zed: 'zed',
};
const KNOWN_DIRECTORIES = {
  codex: '.agents/skills',
  'claude-code': '.claude/skills',
  cursor: '.cursor/skills',
};
const AGENT_LABELS = Object.fromEntries(Object.entries(AGENT_IDS).map(([label, id]) => [id, label]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Missing is allowed; malformed or unreadable existing lock evidence is not. */
function readSourceEvidence(project) {
  const file = path.join(project, 'skills-lock.json');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read raw skills lock ${file}: ${error.message}`);
  }
  try {
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('expected a regular file');
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!object(lock) || !Number.isInteger(lock.version) || lock.version < 1 || !object(lock.skills)) {
      throw new Error('expected a versioned lock with a skills object');
    }
    for (const [name, entry] of Object.entries(lock.skills)) {
      if (!name.trim() || !object(entry)) throw new Error(`invalid entry ${name}`);
      for (const key of ['source', 'sourceUrl', 'sourceType', 'ref', 'skillPath', 'computedHash']) {
        if (entry[key] != null && (typeof entry[key] !== 'string' || !entry[key].trim())) {
          throw new Error(`invalid ${key} for ${name}`);
        }
      }
    }
    return lock.skills;
  } catch (error) {
    throw new Error(`Cannot read raw skills lock ${file}: ${error.message}`);
  }
}

function inspectSkill(location) {
  const row = { path: location, realPath: null, name: null, problems: [] };
  try {
    row.realPath = fs.realpathSync(location);
    if (!fs.statSync(location).isDirectory()) throw new Error('skill path is not a directory');
    const content = fs.readFileSync(path.join(location, 'SKILL.md'), 'utf8');
    const match = content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error('missing SKILL.md YAML frontmatter');
    const document = YAML.parseDocument(match[1], { strict: true, uniqueKeys: true });
    if (document.errors.length) throw new Error(document.errors.map(error => error.message).join('; '));
    const metadata = document.toJS({ maxAliasCount: 0 });
    if (!object(metadata) || typeof metadata.name !== 'string' || !metadata.name.trim()) {
      throw new Error('frontmatter name must be a nonempty string');
    }
    row.name = metadata.name;
    installName(row.name);
  } catch (error) {
    row.problems.push({ code: 'SKILL_UNREADABLE', message: `${location}: ${error.message}` });
  }
  return row;
}

/** Check ancestors too: a broken .agents link must not look like no skills. */
function directoryExists(directory) {
  try {
    fs.lstatSync(directory);
    if (!fs.statSync(directory).isDirectory()) throw new Error('expected a directory');
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      fs.lstatSync(directory);
      throw new Error(`broken directory link: ${directory}`);
    } catch (missing) {
      if (missing.code !== 'ENOENT') throw missing;
    }
    const parent = path.dirname(directory);
    if (parent !== directory) directoryExists(parent);
    return false;
  }
}

function scanSkillDirectory(directory) {
  try {
    if (!directoryExists(directory)) return [];
    const rows = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) rows.push(inspectSkill(path.join(directory, entry.name)));
    }
    return rows;
  } catch (error) {
    throw new Error(`Cannot scan skill directory ${directory}: ${error.message}`);
  }
}

function sourceEvidence(raw, lock, project) {
  const entry = { ...lock };
  for (const key of ['source', 'sourceUrl', 'sourceType']) {
    if (entry[key] == null && raw?.[key] != null) entry[key] = raw[key];
  }
  let source = entry.sourceUrl || entry.source || null;
  if (source && entry.sourceType === 'local') source = path.resolve(project, source);
  // A shorthand for a generic Git host is not a reconstructible remote URL.
  if (!entry.sourceUrl && ['git', 'gitlab'].includes(entry.sourceType) && source &&
      !source.includes(':') && !source.startsWith('.') && !path.isAbsolute(source)) source = null;
  if (source && entry.ref && !source.includes('#')) source += `#${encodeURIComponent(entry.ref)}`;
  return {
    source,
    canonicalSource: source ? canonicalSource(source, project) : null,
    sourceType: entry.sourceType ?? null,
    sourceUrl: entry.sourceUrl ?? null,
    ref: entry.ref ?? null,
    skillPath: entry.skillPath ?? null,
  };
}

async function readInventory(project, targets, upstream = require('./upstream.cjs')) {
  project = path.resolve(project);
  const requested = [...new Set(targets)];
  const lock = readSourceEvidence(project);
  const unfiltered = await upstream.listSkills(project, 'all');
  const lists = new Map([['all', unfiltered]]);
  for (const target of requested) {
    if (target !== 'all') lists.set(target, await upstream.listSkills(project, target));
  }
  const problems = [];
  const problemKeys = new Set();
  function report(problem) {
    const key = `${problem.code}\0${problem.message}`;
    if (!problemKeys.has(key)) {
      problemKeys.add(key);
      problems.push(problem);
    }
  }
  const scanned = [];
  for (const [target, directory] of Object.entries(KNOWN_DIRECTORIES)) {
    try {
      for (const row of scanSkillDirectory(path.join(project, directory))) {
        scanned.push({ ...row, target });
        row.problems.forEach(report);
      }
    } catch (error) {
      report({ code: 'DIRECTORY_UNREADABLE', message: error.message });
    }
  }
  const records = new Map();
  const inspections = new Map(scanned.map(row => [row.path, row]));
  const digests = new Map();
  function lockFor(name) {
    if (!name) return {};
    if (Object.hasOwn(lock, name)) return lock[name];
    const slug = installName(name);
    const matches = Object.entries(lock).filter(([key]) => installName(key) === slug);
    if (matches.length > 1) report({ code: 'AMBIGUOUS_SOURCE', message: `Multiple raw lock entries match ${name}` });
    return matches.length === 1 ? matches[0][1] : {};
  }
  function addRecord(target, location, raw, label) {
    if (!inspections.has(location)) inspections.set(location, inspectSkill(location));
    const inspected = inspections.get(location);
    const name = inspected.name ?? raw?.name ?? path.basename(location);
    const identity = `${target}\0${inspected.realPath ?? location}\0${name}`;
    const itemProblems = [...inspected.problems];
    if (raw && inspected.name && raw.name !== inspected.name) {
      itemProblems.push({ code: 'NAME_MISMATCH', message: `${location}: list name ${raw.name} differs from frontmatter ${inspected.name}` });
    }
    if (target.startsWith('unknown:')) itemProblems.push({ code: 'UNKNOWN_AGENT', message: `Unknown agent association ${label || target} for ${name}` });
    const locked = lockFor(name);
    const evidence = sourceEvidence(raw, locked, project);
    if (raw && locked.source) {
      const listed = sourceEvidence(raw, { ref: locked.ref }, project);
      if (listed.canonicalSource && evidence.canonicalSource && listed.canonicalSource !== evidence.canonicalSource) {
        itemProblems.push({ code: 'SOURCE_CONFLICT', message: `Raw list and lock disagree for ${name}: ${listed.source} versus ${evidence.source}` });
      }
    }
    let digest = null;
    if (!itemProblems.some(problem => problem.code !== 'UNKNOWN_AGENT') && inspected.realPath) {
      if (!digests.has(inspected.realPath)) {
        try { digests.set(inspected.realPath, { digest: digestSkill(inspected.realPath) }); } catch (error) {
          digests.set(inspected.realPath, { problem: { code: 'CONTENT_UNREADABLE', message: `${location}: ${error.message}` } });
        }
      }
      const cached = digests.get(inspected.realPath);
      if (cached.problem) itemProblems.push(cached.problem);
      else digest = cached.digest;
    }
    itemProblems.forEach(report);
    if (records.has(identity)) {
      const existing = records.get(identity);
      if (!existing.source && evidence.source) Object.assign(existing, evidence);
      for (const problem of itemProblems) {
        if (!existing.problems.some(previous => previous.code === problem.code && previous.message === problem.message)) existing.problems.push(problem);
      }
      return existing;
    }
    const item = { name, target, ...evidence, path: location, realPath: inspected.realPath, digest,
      revision: null, agentLabels: [], sharedTargets: [], problems: itemProblems };
    records.set(identity, item);
    return item;
  }

  const rawItems = [...unfiltered, ...[...lists.entries()].filter(([target]) => target !== 'all').flatMap(([, rows]) => rows)]
    .filter(row => row.scope === 'project');
  for (const raw of rawItems) {
    const location = path.resolve(project, raw.path);
    const labels = raw.agents.length ? raw.agents : ['unassociated'];
    for (const label of labels) {
      const target = AGENT_IDS[label] ?? `unknown:${label}`;
      // A list can merge same-name copies. Prefer each known target's actual path.
      const ownPaths = scanned.filter(row => row.target === target && row.name === raw.name);
      if (ownPaths.length) {
        for (const row of ownPaths) addRecord(target, row.path, raw, label);
      } else addRecord(target, location, raw, label);
    }
  }
  for (const row of scanned) {
    const raw = rawItems.find(item => item.name === row.name);
    addRecord(row.target, row.path, raw, AGENT_LABELS[row.target]);
  }
  const physicalGroups = new Map();
  for (const item of records.values()) {
    const key = item.realPath ?? item.path;
    if (!physicalGroups.has(key)) physicalGroups.set(key, []);
    physicalGroups.get(key).push(item);
  }
  for (const group of physicalGroups.values()) {
    const sharedTargets = [...new Set(group.map(item => item.target))];
    const agentLabels = sharedTargets.map(target => AGENT_LABELS[target] ?? target.slice('unknown:'.length));
    for (const item of group) {
      item.sharedTargets = [...sharedTargets];
      item.agentLabels = [...agentLabels];
      if (sharedTargets.some(target => target.startsWith('unknown:'))) {
        const problem = { code: 'UNKNOWN_SHARED_TARGET', message: `Unresolved shared agent associations for ${item.name}: ${sharedTargets.join(', ')}` };
        item.problems.push(problem);
        report(problem);
      }
    }
  }
  for (const target of requested) {
    if (target !== 'all' && !AGENT_LABELS[target] && (lists.get(target)?.length || unfiltered.length)) {
      report({ code: 'UNKNOWN_TARGET', message: `Cannot map upstream display labels to target ${target}` });
    }
  }
  const all = requested.includes('all');
  const allItems = [...records.values()];
  const items = allItems.filter(item => {
    if (all) return true;
    if (!requested.includes(item.target)) return false;
    if (scanned.some(row => row.target === item.target && row.path === item.path)) return true;
    // Some upstream versions include unrelated skills even in filtered output.
    // Require the requested display label, not merely presence in that array.
    return (lists.get(item.target) ?? []).some(raw => raw.scope === 'project' && raw.name === item.name &&
      raw.agents.includes(AGENT_LABELS[item.target]) && path.resolve(project, raw.path) === item.path);
  });
  return { items, allItems, problems };
}

module.exports = { readInventory, scanSkillDirectory, readSourceEvidence, AGENT_IDS };
