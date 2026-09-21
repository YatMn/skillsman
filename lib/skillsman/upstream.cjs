const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SKILLS_PACKAGE = 'skills@1.5.26';

/** Run only our own child in a new POSIX process group. */
async function runSkills(project, args, options = {}) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('skills arguments must be strings without NUL bytes');
  }
  const timeoutMs = options.timeoutMs ?? 60000;
  const killGraceMs = options.killGraceMs ?? 500;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(killGraceMs) || killGraceMs < 0) {
    throw new Error('Invalid skills timeout or termination grace period');
  }
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn('npx', ['--yes', SKILLS_PACKAGE, ...args], {
      cwd: project,
      env: { ...process.env, ...options.env },
      shell: false,
      detached: grouped,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stopped = null;
    let closed = false;
    let exitCode = null;
    let exitSignal = null;
    let forceTimer;
    let groupPoll;
    let timeout;
    let finished = false;

    const operation = `${SKILLS_PACKAGE} ${args[0] || '(no operation)'}`;
    function groupExists() {
      if (!child.pid) return false;
      if (!grouped) return !closed;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    }
    function signalChild(signal) {
      if (!child.pid) return;
      try {
        // Negative PID is safe only because this child was spawned detached.
        if (grouped) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== 'ESRCH') stderr += `\nCannot terminate child group: ${error.message}`;
      }
    }
    function finish() {
      if (finished || !closed) return;
      // close alone is insufficient: a grandchild may have closed its output.
      if (stopped && groupExists()) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      clearInterval(groupPoll);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      if (stopped || exitCode !== 0) {
        const message = stopped || `${operation} exited with code ${exitCode}${exitSignal ? ` (${exitSignal})` : ''}`;
        const error = new Error(`${message}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
        Object.assign(error, { stdout, stderr, exitCode, signal: exitSignal, code: stopped ? 'UPSTREAM_TERMINATED' : 'UPSTREAM_FAILED' });
        reject(error);
      } else resolve({ stdout, stderr });
    }
    function stop(reason) {
      if (stopped || finished) return;
      stopped = reason;
      signalChild('SIGTERM');
      forceTimer = setTimeout(() => {
        signalChild('SIGKILL');
        finish();
      }, killGraceMs);
      groupPoll = setInterval(finish, 20);
      finish();
    }
    function onInterrupt() { stop(`${operation} interrupted by SIGINT`); }
    function onTerminate() { stop(`${operation} interrupted by SIGTERM`); }
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { stopped = `${operation} could not start: ${error.message}`; });
    child.on('close', (code, signal) => {
      closed = true;
      exitCode = code;
      exitSignal = signal;
      finish();
    });
    timeout = setTimeout(() => stop(`${operation} timed out after ${timeoutMs}ms`), timeoutMs);
  });
}

async function listSkills(project, target = 'all') {
  const args = ['list', '--json'];
  if (target !== 'all') args.push('--agent', target);
  const { stdout } = await runSkills(project, args);
  let items;
  try { items = JSON.parse(stdout); } catch (error) {
    throw new Error(`skills list returned invalid JSON: ${error.message}`);
  }
  if (!Array.isArray(items)) throw new Error('skills list JSON must be an array');
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.name !== 'string' || !item.name.trim() ||
        typeof item.path !== 'string' || !item.path.trim() ||
        !['project', 'global'].includes(item.scope) ||
        !Array.isArray(item.agents) || item.agents.some(label => typeof label !== 'string' || !label.trim())) {
      throw new Error('skills list contains an invalid item (name, path, scope, or agents)');
    }
    for (const field of ['source', 'sourceUrl', 'sourceType']) {
      if (item[field] != null && typeof item[field] !== 'string') {
        throw new Error(`skills list item has invalid ${field}`);
      }
    }
  }
  return items;
}

async function addSkills(project, source, names, target) {
  if (typeof source !== 'string' || !source.trim() || source.startsWith('-') || /[\x00-\x1f]/.test(source)) {
    throw new Error('Invalid skills source');
  }
  if (names !== null && (!Array.isArray(names) || !names.length || names.some(name =>
    typeof name !== 'string' || !name.trim() || name.startsWith('-') || name === '*' || /[\x00-\x1f]/.test(name)))) {
    throw new Error('Skill names must be a nonempty explicit list, or null for a full source');
  }
  const targets = Array.isArray(target) ? target : [target];
  if (!targets.length || targets.some(value => typeof value !== 'string' || !value.trim() || value.startsWith('-') || /[\x00-\x1f]/.test(value))) {
    throw new Error('An explicit target or nonempty target array is required');
  }
  const args = ['add', source];
  if (names !== null) args.push('--skill', ...names);
  args.push('--agent', ...new Set(targets.map(value => value === 'all' ? '*' : value)), '-y', '--json');
  return runSkills(project, args, { timeoutMs: 120000 });
}

async function probeSelected(project, source, names) {
  const { canonicalSource, sourceMatches } = require('./config.cjs');
  // Lazy dependency: inventory uses this adapter for normal list operations.
  const { readInventory } = require('./inventory.cjs');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsman-probe-'));
  try {
    const input = source.startsWith('.') || path.isAbsolute(source)
      ? path.resolve(project, source) : source;
    const result = await addSkills(temporary, input, names, 'codex');
    const inventory = await readInventory(temporary, ['all']);
    const problems = [...inventory.problems];
    const selected = names === null ? null : new Set(names);
    const observations = new Map();
    for (const item of inventory.items) {
      const key = JSON.stringify([item.name, item.realPath ?? item.path]);
      // Universal agents may all point to this one newly installed directory.
      if (!observations.has(key) || item.target === 'codex') observations.set(key, item);
    }
    const items = [...observations.values()];
    // Add JSON may provide operation-specific provenance even without a lock.
    let installed = [];
    if (result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout);
        if (Array.isArray(parsed)) installed = parsed;
      } catch { /* Fresh inventory remains authoritative when add has no JSON. */ }
    }
    for (const item of items) {
      if (item.source === null) {
        const evidence = installed.find(row => row.name === item.name && row.status === 'installed' &&
          row.scope === 'project' && typeof row.path === 'string' && typeof row.source === 'string' &&
          fs.realpathSync(path.resolve(temporary, row.path)) === item.realPath);
        if (evidence) {
          item.source = evidence.source;
          item.canonicalSource = canonicalSource(evidence.source, temporary);
        }
      }
      if (selected && !selected.has(item.name)) problems.push({ code: 'UNEXPECTED_SKILL', message: `Source installed unrequested skill ${item.name}` });
      if (!item.source || !sourceMatches(source, item, project)) {
        problems.push({ code: 'SOURCE_UNVERIFIED', message: `Cannot verify source for ${item.name}: ${item.source ?? 'unknown'}` });
      }
      if (!item.digest) problems.push({ code: 'CONTENT_UNVERIFIED', message: `Cannot verify content for ${item.name}` });
    }
    if (selected) for (const name of selected) {
      if (!items.some(item => item.name === name)) problems.push({ code: 'MISSING_SKILL', message: `Source did not install selected skill ${name}` });
    }
    if (names === null && !items.length) problems.push({ code: 'EMPTY_SOURCE', message: `Source yielded no verifiable skills: ${source}` });
    return { items, problems };
  } catch (error) {
    return { items: [], problems: [{ code: 'PROBE_FAILED', message: error.message }] };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { SKILLS_PACKAGE, runSkills, listSkills, addSkills, probeSelected };
