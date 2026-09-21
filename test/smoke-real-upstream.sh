#!/usr/bin/env bash
# Deliberate, network-enabled acceptance run; never part of the default test suite.
set -euo pipefail

REPOSITORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LOG_BASE="${TMPDIR:-/tmp}"
if [[ -d /private/tmp ]]; then LOG_BASE=/private/tmp; fi
LOG_DIRECTORY="$(mktemp -d "${LOG_BASE%/}/skillsman-smoke-logs.XXXXXX")"
SMOKE_ROOT="$(mktemp -d "${LOG_BASE%/}/skillsman-smoke-work.XXXXXX")"
cleanup() {
  result=$?
  trap - EXIT
  rm -rf -- "$SMOKE_ROOT"
  printf '\nSmoke exit status: %s\nRaw outputs retained: %s\n' "$result" "$LOG_DIRECTORY"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
exec > >(tee "$LOG_DIRECTORY/run.log") 2>&1
printf 'Packaged Skillsman acceptance run\nRepository: %s\nRaw outputs: %s\n' "$REPOSITORY" "$LOG_DIRECTORY"

print_command() {
  printf '\n$'
  printf ' %q' "$@"
  printf '\n'
}
run() {
  print_command "$@"
  "$@"
}
run_to() {
  local output="$1"
  shift
  print_command "$@"
  "$@" | tee "$output"
}

mkdir -p "$SMOKE_ROOT/cache" "$SMOKE_ROOT/tmp" "$SMOKE_ROOT/tarballs" "$SMOKE_ROOT/prefix" "$SMOKE_ROOT/bin"
export npm_config_cache="${npm_config_cache:-$SMOKE_ROOT/cache}"
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
export TMPDIR="$SMOKE_ROOT/tmp"
# The shim records argv, but executes the real npx; it does not simulate skills.
export SKILLSMAN_SMOKE_REAL_NPX="$(command -v npx)"
export SKILLSMAN_SMOKE_CALLS="$LOG_DIRECTORY/upstream-calls.jsonl"
: > "$SKILLSMAN_SMOKE_CALLS"
cat > "$SMOKE_ROOT/bin/npx" <<'NODE'
#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SKILLSMAN_SMOKE_CALLS, JSON.stringify({ cwd: process.cwd(), args }) + '\n');
const result = spawnSync(process.env.SKILLSMAN_SMOKE_REAL_NPX, args, { stdio: 'inherit', env: process.env });
if (result.error) { console.error(result.error.message); process.exit(1); }
if (result.signal) { console.error(`npx terminated by ${result.signal}`); process.exit(1); }
process.exit(result.status ?? 1);
NODE
chmod +x "$SMOKE_ROOT/bin/npx"
export PATH="$SMOKE_ROOT/bin:$PATH"

run node --version
run npm --version
run_to "$LOG_DIRECTORY/pack.json" npm pack "$REPOSITORY" --pack-destination "$SMOKE_ROOT/tarballs" --json --ignore-scripts
TARBALL_NAME="$(node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(data.length!==1)throw Error("Expected one packed artifact");process.stdout.write(data[0].filename);' "$LOG_DIRECTORY/pack.json")"
run npm install --prefix "$SMOKE_ROOT/prefix" "$SMOKE_ROOT/tarballs/$TARBALL_NAME" --ignore-scripts --no-audit --no-fund
PACKAGE_NAME="$(node -p 'require(process.argv[1]).name' "$REPOSITORY/package.json")"
PACKAGE_ROOT="$SMOKE_ROOT/prefix/node_modules/$PACKAGE_NAME"
CLI="$SMOKE_ROOT/prefix/node_modules/.bin/skillsman"
run node -e 'const p=require(process.argv[1]);console.log(JSON.stringify({name:p.name,version:p.version,engines:p.engines},null,2));' "$PACKAGE_ROOT/package.json"
UPSTREAM_PACKAGE="$(node -p 'require(process.argv[1]).SKILLS_PACKAGE' "$PACKAGE_ROOT/lib/skillsman/upstream.cjs")"
run npx --yes "$UPSTREAM_PACKAGE" --version
run "$CLI" --help

# Assertions run against the installed artifact. No module is loaded from the
# source checkout, and all generated projects/manifests stay in SMOKE_ROOT.
cat > "$SMOKE_ROOT/assertions.cjs" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const [packageRoot, operation, ...args] = process.argv.slice(2);
const config = require(path.join(packageRoot, 'lib/skillsman/config.cjs'));
const { readInventory } = require(path.join(packageRoot, 'lib/skillsman/inventory.cjs'));
const { digestSkill, readState } = require(path.join(packageRoot, 'lib/skillsman/state.cjs'));
const names = ['skillsman-agents-md', 'skillsman-readme'];
function tree(project) {
  const rows = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, entry);
      const stat = fs.lstatSync(file);
      const relative = path.relative(project, file);
      if (stat.isSymbolicLink()) rows.push([relative, 'link', fs.readlinkSync(file)]);
      else if (stat.isDirectory()) { rows.push([relative, 'directory']); walk(file); }
      else { assert(stat.isFile()); rows.push([relative, 'file', fs.readFileSync(file).toString('base64')]); }
    }
  }
  walk(project);
  return rows;
}
function calls(project) {
  const canonical = fs.realpathSync(project);
  return fs.readFileSync(process.env.SKILLSMAN_SMOKE_CALLS, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    .filter(call => call.cwd === canonical);
}
async function main() {
  if (operation === 'selection') {
    fs.writeFileSync(args[0], config.serializeSelection({ includes: [], skills: [{
      source: args[1], why: 'Maintain project instructions and README', names,
    }] }));
    return;
  }
  if (operation === 'tree') {
    console.log(crypto.createHash('sha256').update(JSON.stringify(tree(args[0]))).digest('hex'));
    return;
  }
  if (operation === 'add-count') {
    console.log(calls(args[0]).filter(call => call.args[2] === 'add').length);
    return;
  }
  if (operation === 'snapshot') {
    const snapshot = config.parseSnapshot(fs.readFileSync(args[0], 'utf8'));
    assert.equal(snapshot.schema, 'skillsman.snapshot.v1');
    assert.deepEqual(Object.keys(snapshot.targets), ['codex']);
    assert.deepEqual(snapshot.targets.codex.skills.map(item => item.name).sort(), names);
    console.log('PASS: snapshot contains exactly the two selected Codex skills');
    return;
  }
  if (operation === 'observe') {
    const [project, source, output] = args;
    const inventory = await readInventory(project, ['all']);
    assert.deepEqual(inventory.problems, [], 'Inventory must be fully readable and mapped');
    assert.deepEqual([...new Set(inventory.items.map(item => item.name))].sort(), names);
    const baseline = readState(path.join(project, '.skillsman/state.json'));
    assert(baseline.entries.length, 'Verified installation needs saved state');
    assert(baseline.entries.every(item => names.includes(item.name)), 'State must not add unselected skills');
    for (const name of names) {
      assert(inventory.items.some(item => item.name === name && item.target === 'codex'));
      assert(baseline.entries.some(item => item.name === name && item.target === 'codex'));
    }
    for (const item of inventory.items) {
      assert.deepEqual(item.problems, []);
      assert.match(item.digest, /^sha256:[a-f0-9]{64}$/);
      assert.equal(config.canonicalSource(item.source, project), config.canonicalSource(source, project));
      if (path.isAbsolute(source)) {
        assert.equal(item.digest, digestSkill(path.join(source, 'skills', item.name)), 'Installed package-local content differs from source');
      }
    }
    const selectionFile = path.join(project, '.skillsman/skills.yaml');
    if (fs.existsSync(selectionFile)) {
      const selection = config.readSelection(selectionFile);
      assert.deepEqual(selection.skills.flatMap(item => item.names).sort(), names);
    } else assert.equal(args[3], 'snapshot', 'A selection is required outside legacy snapshot apply');
    const observations = {
      associations: inventory.items.map(item => ({ name: item.name, target: item.target, sharedTargets: [...item.sharedTargets].sort() }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      layout: tree(project).map(row => row.slice(0, 2)),
      addCount: calls(project).filter(call => call.args[2] === 'add').length,
    };
    fs.writeFileSync(output, JSON.stringify(observations, null, 2));
    console.log(`PASS: ${project} contains only ${names.join(', ')} with verified sources and content`);
    return;
  }
  if (operation === 'update-scope') {
    const [project, beforeFile, afterFile] = args;
    const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
    const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
    assert.deepEqual(after.associations, before.associations, 'Update all expanded or changed target associations');
    assert.deepEqual(after.layout, before.layout, 'Update all expanded installed paths');
    const allowed = new Set(before.associations.map(item => item.target));
    const adds = calls(project).filter(call => call.args[2] === 'add').slice(before.addCount);
    assert(adds.length, 'Expected real scoped reinstall calls during explicit update');
    for (const call of adds) {
      const start = call.args.indexOf('--agent');
      assert(start >= 0);
      const targets = [];
      for (let i = start + 1; i < call.args.length && !call.args[i].startsWith('-'); i++) targets.push(call.args[i]);
      assert(targets.length);
      assert(targets.every(target => target !== '*' && allowed.has(target)), 'Update used wildcard or a new agent target');
      const skillsIndex = call.args.indexOf('--skill');
      assert(skillsIndex >= 0, 'Update must use explicit selected skill names');
      const selected = [];
      for (let i = skillsIndex + 1; i < call.args.length && !call.args[i].startsWith('-'); i++) selected.push(call.args[i]);
      assert(selected.length && selected.every(name => names.includes(name)), 'Update changed the selected skill scope');
    }
    assert(!calls(project).some(call => call.args[2] === 'update'), 'Never call broad upstream update');
    console.log('PASS: update all refreshed only selected skills and existing agent IDs');
    return;
  }
  throw new Error(`Unknown smoke assertion: ${operation}`);
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
NODE
assertion() { node "$SMOKE_ROOT/assertions.cjs" "$PACKAGE_ROOT" "$@"; }

FIRST="$SMOKE_ROOT/project-one"
SECOND="$SMOKE_ROOT/project-two"
REMOTE="$SMOKE_ROOT/project-remote"
RESTORED="$SMOKE_ROOT/project-snapshot"
mkdir -p "$FIRST" "$SECOND" "$REMOTE" "$RESTORED"
LOCAL_SELECTION="$SMOKE_ROOT/local-selection.yaml"
assertion selection "$LOCAL_SELECTION" "$PACKAGE_ROOT"

printf '\nPhase 1: installed tarball, package-local source, two selected skills\n'
BEFORE="$(assertion tree "$FIRST")"
run "$CLI" plan --file "$LOCAL_SELECTION" --target codex --project "$FIRST"
[[ "$BEFORE" == "$(assertion tree "$FIRST")" ]] || { printf 'FAIL: plan changed project files\n'; exit 1; }
run "$CLI" init --file "$LOCAL_SELECTION" --target codex --project "$FIRST"
assertion observe "$FIRST" "$PACKAGE_ROOT" "$LOG_DIRECTORY/local-initial.json"
BEFORE="$(assertion tree "$FIRST")"
ADD_COUNT="$(assertion add-count "$FIRST")"
run "$CLI" init --file "$LOCAL_SELECTION" --target codex --project "$FIRST"
[[ "$BEFORE" == "$(assertion tree "$FIRST")" ]] || { printf 'FAIL: idempotent init changed files\n'; exit 1; }
[[ "$ADD_COUNT" == "$(assertion add-count "$FIRST")" ]] || { printf 'FAIL: idempotent init called upstream add\n'; exit 1; }
printf 'PASS: second initialization made no project changes or installation calls\n'
run "$CLI" snapshot --target codex --project "$FIRST" --output "$SMOKE_ROOT/snapshot.yaml"
assertion snapshot "$SMOKE_ROOT/snapshot.yaml"
cp "$SMOKE_ROOT/snapshot.yaml" "$LOG_DIRECTORY/snapshot.yaml"
BEFORE="$(assertion tree "$RESTORED")"
run "$CLI" apply "$SMOKE_ROOT/snapshot.yaml" --target codex --project "$RESTORED" --dry-run
[[ "$BEFORE" == "$(assertion tree "$RESTORED")" ]] || { printf 'FAIL: snapshot apply preview changed files\n'; exit 1; }
run "$CLI" apply "$SMOKE_ROOT/snapshot.yaml" --target codex --project "$RESTORED"
assertion observe "$RESTORED" "$PACKAGE_ROOT" "$LOG_DIRECTORY/snapshot-applied.json" snapshot
printf 'PASS: packaged Codex snapshot/apply restored exactly the two selected skills\n'

printf '\nPhase 2: independent project reuses the copied selection\n'
BEFORE="$(assertion tree "$FIRST")"
cp "$FIRST/.skillsman/skills.yaml" "$SMOKE_ROOT/copied-selection.yaml"
run "$CLI" init --file "$SMOKE_ROOT/copied-selection.yaml" --target codex --project "$SECOND"
assertion observe "$SECOND" "$PACKAGE_ROOT" "$LOG_DIRECTORY/local-reused.json"
[[ "$BEFORE" == "$(assertion tree "$FIRST")" ]] || { printf 'FAIL: cross-project reuse changed the original project\n'; exit 1; }
run cmp "$FIRST/.skillsman/skills.yaml" "$SECOND/.skillsman/skills.yaml"
printf 'PASS: selection reused independently; the first project is unchanged\n'

printf '\nPhase 3: update all preserves existing target coverage\n'
assertion observe "$FIRST" "$PACKAGE_ROOT" "$LOG_DIRECTORY/before-update.json"
BEFORE="$(assertion tree "$FIRST")"
run "$CLI" update --target all --project "$FIRST" --dry-run
[[ "$BEFORE" == "$(assertion tree "$FIRST")" ]] || { printf 'FAIL: update preview changed project files\n'; exit 1; }
run "$CLI" update --target all --project "$FIRST"
assertion observe "$FIRST" "$PACKAGE_ROOT" "$LOG_DIRECTORY/after-update.json"
assertion update-scope "$FIRST" "$LOG_DIRECTORY/before-update.json" "$LOG_DIRECTORY/after-update.json"

printf '\nPhase 4: actual remote source YatMn/skillsman, the same two chosen skills\n'
assertion selection "$SMOKE_ROOT/remote-selection.yaml" YatMn/skillsman
BEFORE="$(assertion tree "$REMOTE")"
run "$CLI" plan --file "$SMOKE_ROOT/remote-selection.yaml" --target codex --project "$REMOTE"
[[ "$BEFORE" == "$(assertion tree "$REMOTE")" ]] || { printf 'FAIL: remote plan changed project files\n'; exit 1; }
run "$CLI" init --file "$SMOKE_ROOT/remote-selection.yaml" --target codex --project "$REMOTE"
assertion observe "$REMOTE" YatMn/skillsman "$LOG_DIRECTORY/remote-installed.json"
printf '\nPhase 5: remote snapshot preserves repository skill subdirectories\n'
REMOTE_APPLIED="$SMOKE_ROOT/project-remote-applied"
mkdir -p "$REMOTE_APPLIED"
run "$CLI" snapshot --target codex --project "$REMOTE" --output "$SMOKE_ROOT/remote-snapshot.yaml"
run "$CLI" apply "$SMOKE_ROOT/remote-snapshot.yaml" --target codex --project "$REMOTE_APPLIED"
run cmp "$REMOTE/.agents/skills/skillsman-agents-md/SKILL.md" "$REMOTE_APPLIED/.agents/skills/skillsman-agents-md/SKILL.md"
run cmp "$REMOTE/.agents/skills/skillsman-readme/SKILL.md" "$REMOTE_APPLIED/.agents/skills/skillsman-readme/SKILL.md"
printf 'PASS: remote snapshot restored the selected skill subdirectories\n'
printf '\nPASS: packaged local and remote acceptance checks completed\n'
