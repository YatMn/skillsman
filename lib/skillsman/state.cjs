'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const hash = bytes => 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
const stat = file => fs.lstatSync(file, { bigint: true });
const fingerprint = value => ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(value[key])).join(':');
function unchanged(before, after, file) {
  if (fingerprint(before) !== fingerprint(after)) throw new Error(`File changed during read; retry: ${file}`);
}
function identity(source, name, target) { return JSON.stringify([source, name, target]); }

function stableRead(file) {
  const before = stat(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile()) throw new Error(`Expected a regular file: ${file}`);
    if (!before.isSymbolicLink()) unchanged(before, opened, file);
    const bytes = fs.readFileSync(fd);
    unchanged(opened, fs.fstatSync(fd, { bigint: true }), file);
    unchanged(before, stat(file), file);
    unchanged(opened, fs.statSync(file, { bigint: true }), file);
    return bytes;
  } finally { fs.closeSync(fd); }
}
function fileDigest(file) {
  // Only initial absence is an empty observation. Disappearance during reading
  // is a race and must propagate, never masquerade as an absent baseline.
  try { fs.statSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return hash(stableRead(file)); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`File changed during read; retry: ${file}`, { cause: error });
    throw error;
  }
}
function digestSkill(directory) {
  const original = stat(directory); const root = fs.realpathSync.native(directory);
  if (!fs.statSync(root).isDirectory()) throw new Error(`Skill root must be a directory: ${directory}`);
  const hasher = crypto.createHash('sha256'); const observed = new Map(); const active = new Set();
  function contained(file) {
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Skill link outside root: ${file}`);
  }
  function record(...parts) {
    for (const part of parts) {
      const bytes = Buffer.isBuffer(part) ? part : Buffer.from(String(part));
      hasher.update(String(bytes.length) + ':'); hasher.update(bytes);
    }
  }
  function walk(file, relative) {
    contained(file);
    const before = stat(file); const signature = fingerprint(before);
    if (observed.has(file) && observed.get(file) !== signature) throw new Error(`Skill changed during read: ${file}`);
    observed.set(file, signature);
    if (active.has(file)) throw new Error(`Skill link cycle: ${file}`);
    active.add(file);
    try {
      const real = fs.realpathSync.native(file); contained(real);
      if (before.isSymbolicLink()) {
        const link = fs.readlinkSync(file);
        record(relative, 'link', Number(before.mode & 0o7777n), link);
        const target = path.resolve(path.dirname(file), link); contained(target);
        // Native realpath respects .. after directory symlinks; lexical
        // path.resolve alone can identify a different (or missing) target.
        walk(real, relative);
        if (fs.readlinkSync(file) !== link) throw new Error(`Skill link changed during read: ${file}`);
      } else if (before.isDirectory()) {
        record(relative, 'directory', Number(before.mode & 0o7777n));
        for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name), relative ? relative + '/' + name : name);
      } else if (before.isFile()) {
        record(relative, 'file', Number(before.mode & 0o7777n), stableRead(file));
      } else throw new Error(`Unsupported special file in skill: ${file}`);
      unchanged(before, stat(file), file);
    } finally { active.delete(file); }
  }
  walk(root, '');
  for (const [file, signature] of observed) if (fingerprint(stat(file)) !== signature) throw new Error(`Skill changed during read: ${file}`);
  unchanged(original, stat(directory), directory);
  if (fs.realpathSync.native(directory) !== root) throw new Error(`Skill root changed during read: ${directory}`);
  return 'sha256:' + hasher.digest('hex');
}
function objectKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`Invalid ${label} fields`);
}
function validString(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || /^\s*-/.test(value)) throw new Error(`Invalid state ${label}`);
}
function readState(file) {
  try { stat(file); } catch (error) { if (error.code === 'ENOENT') return { version: 1, entries: [] }; throw error; }
  const state = JSON.parse(stableRead(file).toString('utf8'));
  objectKeys(state, ['version', 'entries'], 'state');
  if (state.version !== 1 || !Array.isArray(state.entries)) throw new Error('Unsupported state version or entries');
  const entries = new Map();
  for (const entry of state.entries) {
    objectKeys(entry, ['source', 'name', 'target', 'digest', 'revision'], 'state entry');
    for (const field of ['source', 'name', 'target']) validString(entry[field], field);
    if (typeof entry.digest !== 'string' || !hashPattern.test(entry.digest)) throw new Error('Invalid state digest');
    if (entry.revision !== null && typeof entry.revision !== 'string') throw new Error('Invalid state revision');
    const key = identity(entry.source, entry.name, entry.target); const previous = entries.get(key);
    if (previous && (previous.digest !== entry.digest || previous.revision !== entry.revision)) throw new Error(`Conflicting state entries: ${key}`);
    if (!previous) entries.set(key, entry);
  }
  return { version: 1, entries: [...entries.values()] };
}
function writeAtomic(file, text, expectedDigest) {
  if (expectedDigest !== null && (typeof expectedDigest !== 'string' || !hashPattern.test(expectedDigest))) throw new Error('Expected digest must be explicit sha256 or null for absence');
  if (typeof text !== 'string') throw new Error('Atomic write text must be a string');
  function check() {
    try { if (!stat(file).isFile()) throw new Error(`Atomic destination must be a regular file, not a link: ${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (fileDigest(file) !== expectedDigest) throw new Error(`File changed: expected digest conflict for ${file}`);
  }
  check();
  const parent = path.dirname(file); fs.mkdirSync(parent, { recursive: true });
  const temp = path.join(parent, '.' + path.basename(file) + '.' + crypto.randomUUID() + '.tmp');
  let created = false;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600); created = true;
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    check();
    if (expectedDigest === null) {
      // Atomic no-clobber creation closes the check/rename race for absence.
      fs.linkSync(temp, file);
    } else {
      // Caller holds the project lock. A non-cooperating editor can still race
      // the final check/rename; this is detection, not cross-tool isolation.
      fs.renameSync(temp, file); created = false;
    }
  } finally { if (created) fs.unlinkSync(temp); }
}
module.exports = { identity, digestSkill, fileDigest, readState, writeAtomic };
