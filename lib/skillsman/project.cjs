#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const config = require('./config.cjs');
const stateIO = require('./state.cjs');
const upstream = require('./upstream.cjs');
const { readInventory } = require('./inventory.cjs');
const { buildPlan, assertPlan, sameSource } = require('./plan.cjs');
const ROOT = path.resolve(__dirname, '../..');
const SCENARIOS = path.join(ROOT, 'scenarios');

function fail(message) { throw new Error(message); }
function normalizeTarget(value) {
  const target = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(target)) fail(`invalid target: ${value}`);
  return ({ claude: 'claude-code', gemini: 'gemini-cli' })[target] || target;
}
function parseProjectArgs(mode, args) {
  const allowed = {
    plan: ['file','project','target'], init: ['file','project','target','allow-self-install'],
    add: ['file','project','target','allow-self-install'], update: ['project','target','dry-run','allow-self-install'],
    status: ['project','target'], snapshot: ['project','target','output'],
    apply: ['project','target','dry-run','allow-self-install'], remove: ['project','target','allow-self-install'],
    doctor: ['project','target']
  }[mode];
  if (!allowed) fail(`unknown command: ${mode}`);
  const options = { mode, project: process.cwd(), targets: [], positional: [], dryRun: false, allowSelfInstall: false };
  const seen = new Set();
  for (let i=0; i<args.length; i++) {
    const token = args[i];
    if (!token.startsWith('--')) { options.positional.push(token); continue; }
    const equal = token.indexOf('=');
    const key = token.slice(2, equal < 0 ? undefined : equal);
    if (!allowed.includes(key)) fail(`unknown argument: ${token}`);
    if (key !== 'target' && seen.has(key)) fail(`duplicate option: --${key}`);
    seen.add(key);
    if (key === 'dry-run' || key === 'allow-self-install') {
      if (equal >= 0) fail(`--${key} does not accept a value`);
      options[key === 'dry-run' ? 'dryRun' : 'allowSelfInstall'] = true;
      continue;
    }
    const value = equal >= 0 ? token.slice(equal+1) : args[++i];
    if (!value || value.startsWith('--')) fail(`--${key} requires a value`);
    if (key === 'target') {
      for (const part of value.split(',')) options.targets.push(normalizeTarget(part));
    } else options[key] = value;
  }
  options.targets = [...new Set(options.targets)];
  if (options.targets.includes('all') && options.targets.length !== 1) fail('--target all cannot be combined with other targets');
  if (!options.targets.length && !['status','doctor'].includes(mode)) fail('target is required. Use --target codex or another explicit target.');
  if (!options.targets.length) options.targets = ['all'];
  options.project = fs.realpathSync(options.project);
  if (!fs.statSync(options.project).isDirectory()) fail('project must be a directory');
  for (const key of ['file','output']) if (options[key]) options[key] = path.resolve(options[key]);
  if (['init','add'].includes(mode)) {
    if (options.file && options.positional.length) fail('scenario and --file are mutually exclusive');
    if (!options.file && options.positional.length !== 1) fail(`${mode} requires a scenario or --file`);
    options.scenario = options.positional[0];
    if (options.scenario === 'all') fail('all is an audit-only scenario; choose a functional scenario');
  } else if (mode === 'remove') {
    if (!options.positional.length) fail('remove requires at least one skill name');
    options.positional.forEach(name => { if (!name.trim() || name.startsWith('-') || /[\x00-\x1f\x7f]/.test(name)) fail('invalid skill name'); });
  } else if (mode === 'apply') {
    if (options.positional.length > 1) fail('apply accepts at most one snapshot path');
    options.file = options.positional[0] ? path.resolve(options.positional[0]) : path.join(options.project, '.skillsman/skills.snapshot.yaml');
  } else if (options.positional.length) fail(`${mode} does not accept positional arguments`);
  if (mode === 'plan' && !options.file) fail('plan requires --file');
  return options;
}
function ensureWritableScope(options) {
  if (options.project === fs.realpathSync(ROOT) && !options.allowSelfInstall) fail('refusing to modify skillsman itself; pass --allow-self-install explicitly');
  // These upstream containers may be shared through directory links. A project
  // installation must not follow such a container into another project.
  for (const directory of ['.agents', '.agents/skills', '.claude', '.claude/skills', '.cursor', '.cursor/skills']) {
    const location = path.join(options.project,directory);
    try {
      const relative = path.relative(options.project,fs.realpathSync(location));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail(`${directory} resolves outside the selected project; resolve its placement before installation`);
    } catch(error) { if(error.code !== 'ENOENT') throw error; }
  }
  const managed = path.join(options.project, '.skillsman');
  try { if (fs.lstatSync(managed).isSymbolicLink()) fail('.skillsman must not be a symbolic link'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function paths(options) {
  return { selection: path.join(options.project, '.skillsman/skills.yaml'), state: path.join(options.project, '.skillsman/state.json') };
}
function selectionDigest(selection) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(selection)).digest('hex')}`;
}
function inventoryDigest(inventory) {
  return JSON.stringify(inventory.items.map(row => [row.name,row.target,row.source,row.realPath,row.digest,row.sharedTargets,row.problems]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function showPlan(plan) {
  for (const item of plan.items) {
    console.log(`${item.action}: ${item.name} [${item.target}] from ${item.source}`);
    console.log(`  reason: ${item.why}; state: ${item.observed}`);
    for (const problem of item.problems) console.log(`  ${problem.code}: ${problem.message}`);
  }
  for (const item of plan.extras) console.log(`keep extra: ${item.name} [${item.target}]`);
  for (const problem of plan.problems) console.log(`${problem.code}: ${problem.message}`);
  if (!plan.items.length) console.log('No selected skills; no installation needed.');
}
async function context(options, selection) {
  const files = paths(options);
  const hashes = () => ({selectionHash:stateIO.fileDigest(files.selection), stateHash:stateIO.fileDigest(files.state), inputHash:options.file?stateIO.fileDigest(options.file):null});
  const before = hashes();
  const state = stateIO.readState(files.state);
  const inventory = selection.skills.length ? await readInventory(options.project, options.targets) : {items:[],problems:[]};
  if (JSON.stringify(before) !== JSON.stringify(hashes())) fail('project or input changed while reading inventory; review and retry');
  const mode = options.mode === 'plan' || options.mode === 'apply' ? 'init' : options.mode;
  const args = {mode,selection,inventory,state,targets:options.targets,selectionDigest:selectionDigest(selection),project:options.project};
  const plan = options.targetSelections
    ? {mode, selectionDigest:selectionDigest(selection), items:options.targetSelections.flatMap(item => buildPlan({...args,selection:item.selection,targets:[item.target]}).items), extras:buildPlan(args).extras, problems:inventory.problems}
    : buildPlan(args);
  return {files,inventory,state,plan,...before};
}
async function withProjectLock(project, fn) {
  const managed = path.join(project, '.skillsman');
  fs.mkdirSync(managed, {recursive:true});
  const lock = path.join(managed, 'operation.lock');
  try { fs.mkdirSync(lock); } catch(error) { if (error.code === 'EEXIST') fail(`project operation is locked: ${lock}; check the owning process before removing a stale lock`); throw error; }
  const inode = fs.lstatSync(lock);
  const id = crypto.randomUUID();
  const marker = path.join(lock, 'owner.json');
  function cleanup() {
    try {
      const current = fs.lstatSync(lock);
      if (current.ino !== inode.ino || current.dev !== inode.dev) return;
      if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker,'utf8')).id !== id) return;
      fs.rmSync(lock,{recursive:true});
    } catch(error) { if (error.code !== 'ENOENT') console.error(`warn: operation lock cleanup failed: ${error.message}`); }
  }
  const signal = () => { process.exitCode = 130; };
  process.on('SIGINT',signal); process.on('SIGTERM',signal);
  try {
    fs.writeFileSync(marker,JSON.stringify({id,pid:process.pid}),{flag:'wx'});
    return await fn();
  } finally { cleanup(); process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal); }
}
function mergeStateEntry(state, row, source, project) {
  const scopes = new Set([row.target,...(row.sharedTargets||[]).filter(target=>!target.startsWith('unknown:'))]);
  for (const target of scopes) {
    if (target === 'all') continue;
    const entry = {source,name:row.name,target,digest:row.digest,revision:row.revision??null};
    const index = state.entries.findIndex(old => old.name === row.name && old.target === target && sameSource(old.source,source,project));
    if (index >= 0) state.entries[index] = entry; else state.entries.push(entry);
  }
  state.entries.sort((a,b)=>JSON.stringify([a.source,a.name,a.target]).localeCompare(JSON.stringify([b.source,b.name,b.target])));
}
function groupsFor(plan) {
  const names = new Map();
  for (const item of plan.items.filter(row => ['install', 'update'].includes(row.action))) {
    const key = JSON.stringify([item.source, item.name]);
    if (!names.has(key)) names.set(key, {source:item.source, name:item.name, items:[]});
    names.get(key).items.push(item);
  }
  const groups = new Map();
  for (const row of names.values()) {
    const targets = [...new Set(row.items.map(item => item.target))].sort();
    const key = JSON.stringify([row.source, targets]);
    if (!groups.has(key)) groups.set(key, {source:row.source, targets, names:[], items:[]});
    const group = groups.get(key);
    group.names.push(row.name); group.items.push(...row.items);
  }
  return [...groups.values()];
}
async function probeGroups(options, groups) {
  const observations = new Map();
  for (const group of groups) {
    const probe = await upstream.probeSelected(options.project,group.source,group.names);
    if (probe.problems?.length) fail(probe.problems.map(problem=>problem.message||String(problem)).join('\n'));
    for (const name of group.names) {
      const row = probe.items.find(row=>row.name===name&&row.digest&&config.sourceMatches(group.source,row,options.project));
      if (!row) fail(`upstream cannot verify selected skill: ${group.source} / ${name}`);
      observations.set(JSON.stringify([group.source,name]),row.digest);
      console.log(`upstream verified: ${name}; content ${row.digest.slice(0,20)}`);
    }
  }
  return observations;
}
async function runSelection(options, selection, {saveSelection=true, fullSources=new Set()}={}) {
  const files = paths(options);
  if (options.initialSelectionHash !== undefined && stateIO.fileDigest(files.selection) !== options.initialSelectionHash) fail('selection changed since reading; review and retry');
  if (options.initialInputHash !== undefined && stateIO.fileDigest(options.file) !== options.initialInputHash) fail('input changed since reading; review and retry');
  if (saveSelection && options.mode === 'init' && fs.existsSync(files.selection)) {
    const saved = config.readSelection(files.selection);
    if (selectionDigest(saved) !== selectionDigest(selection)) fail('project already has a different selection; edit it explicitly or use add --file');
  }
  let before = await context(options,selection);
  showPlan(before.plan); assertPlan(before.plan);
  for (const source of fullSources) {
    const rows = before.plan.items.filter(row=>row.source===source);
    if (rows.some(row=>row.action==='keep') && rows.some(row=>row.action==='install')) fail(`${source}: full-source initialization would overwrite existing content; use an explicit --file selection`);
  }
  const groups = groupsFor(before.plan);
  const probes = options.mode === 'update' ? await probeGroups(options,groups) : new Map();
  if (options.mode === 'plan' || options.dryRun) {
    console.log(`summary: would ${options.mode==='update'?'refresh':'install'} ${new Set(groups.flatMap(group=>group.names)).size}; no project files changed`);
    return 0;
  }
  ensureWritableScope(options);
  const serialized = config.serializeSelection(selection);
  const needsSave = saveSelection && (!fs.existsSync(files.selection) || selectionDigest(config.readSelection(files.selection)) !== selectionDigest(selection));
  if (!groups.length && !needsSave) { console.log('summary: no changes needed');return 0; }
  return withProjectLock(options.project, async()=>{
    const fresh = await context(options,selection);
    if (fresh.selectionHash!==before.selectionHash || fresh.stateHash!==before.stateHash || fresh.inputHash!==before.inputHash || inventoryDigest(fresh.inventory)!==inventoryDigest(before.inventory)) fail('project changed since preflight; review the new state and retry');
    assertPlan(fresh.plan);
    if (needsSave) stateIO.writeAtomic(files.selection,serialized,before.selectionHash);
    const expectedSelectionHash = stateIO.fileDigest(files.selection);
    const expectedInputHash = options.file ? stateIO.fileDigest(options.file) : null;
    function assertInputsUnchanged() {
      if (stateIO.fileDigest(files.selection) !== expectedSelectionHash || (options.file && stateIO.fileDigest(options.file) !== expectedInputHash)) fail('selection changed during execution; review and retry');
    }
    let installed=0;
    let expectedStateHash = before.stateHash;
    const workingState = structuredClone(before.state);
    for (const group of groups) {
      if (process.exitCode === 130) fail('operation interrupted');
      ensureWritableScope(options);
      assertInputsUnchanged();
      if (stateIO.fileDigest(files.state) !== expectedStateHash) fail('installation state changed during execution; review and retry');
      // Recheck previously existing content immediately before the next source is touched.
      const current = await readInventory(options.project,options.targets);
      if (current.problems.length) fail(current.problems.map(problem=>problem.message).join('\n'));
      for (const item of group.items) {
        assertPlan(buildPlan({mode:options.mode==='apply'?'init':options.mode, selection:{includes:[],skills:[{source:item.source,why:item.why,names:[item.name]}]}, inventory:current,state:workingState,targets:group.targets,selectionDigest:before.plan.selectionDigest,project:options.project}));
        const observed = current.items.find(row=>row.name===item.name&&(item.target==='all'||row.target===item.target));
        if (item.action==='update' && (!observed || observed.digest!==item.digest || !config.sourceMatches(item.source,observed,options.project))) fail(`${item.name}: content changed during execution; retry after reviewing it`);
        if (item.action==='install' && observed) fail(`${item.name}: appeared during execution; refusing overwrite`);
      }
      let installError;
      try {
        console.log(`add: ${group.source} (${group.names.length} selected)`);
        await upstream.addSkills(options.project,group.source,fullSources.has(group.source)?null:group.names,group.targets.length===1?group.targets[0]:group.targets);
      } catch(error) { installError=error; }
      if (process.exitCode === 130) fail('operation interrupted; inspect partial installation before retrying');
      const after = await readInventory(options.project,options.targets);
      assertInputsUnchanged();
      const previous = current.allItems || current.items;
      const unexpected = (after.allItems || after.items).filter(row => !group.names.includes(row.name) && !previous.some(old => old.name === row.name && old.target === row.target && old.realPath === row.realPath && old.digest === row.digest));
      if (unexpected.length) fail(`upstream changed unrequested skills: ${[...new Set(unexpected.map(row=>row.name))].join(', ')}; inspect the partial installation before retrying`);
      const verified=[]; const missing=[];
      for (const name of group.names) {
        const rows = after.items.filter(row=>row.name===name);
        const targetsOk = group.targets.includes('all') ? rows.length>0 : group.targets.every(target=>rows.some(row=>row.target===target));
        const valid=targetsOk && rows.every(row=>row.digest && !row.problems.length && config.sourceMatches(group.source,row,options.project));
        const expected = probes.get(JSON.stringify([group.source,name]));
        const drift = expected && rows.some(row=>row.digest!==expected);
        if (!valid || drift || after.problems.length) { missing.push(`${name}${drift?' (upstream content changed since preview)':''}`);continue; }
        for (const row of rows) mergeStateEntry(workingState,row,group.source,options.project);
        verified.push(name);installed++;
      }
      if (verified.length) {
        stateIO.writeAtomic(files.state,JSON.stringify(workingState,null,2)+'\n',expectedStateHash);
        expectedStateHash = stateIO.fileDigest(files.state);
        console.log(`verified: ${verified.join(', ')}`);
      }
      if (installError || missing.length) fail(`partial result: verified ${verified.join(', ')||'none'}; unresolved ${missing.join(', ')||'upstream failure'}\n${installError?.message||''}`);
    }
    console.log(`summary: verified ${installed}; preserved unrelated skills`);
    console.log('info: .skillsman/state.json is local installation evidence; exclude it from shared configuration.');
    return 0;
  });
}
async function scenarioSelection(options) {
  const rows=config.expandScenario(options.scenario,SCENARIOS);
  const fullSources=new Set(); const groups=[];
  for (const row of rows) {
    let names=row.names;
    if (names==null) {
      fullSources.add(row.source);
      console.log(`inspect full source: ${row.source}`);
      const probe=await upstream.probeSelected(options.project,row.source,null);
      if(probe.problems?.length)fail(probe.problems.map(p=>p.message||String(p)).join('\n'));
      names=[...new Set(probe.items.map(item=>item.name))];
      if(!names.length)fail(`cannot enumerate source: ${row.source}`);
    }
    groups.push({source:row.source,why:row.why,names});
  }
  const selection=config.parseSelection(YAML.stringify({includes:[],skills:groups}));
  return {selection,fullSources};
}
async function runProjectCommand(mode,args) {
  const options=parseProjectArgs(mode,args);
  const files=paths(options);
  options.initialSelectionHash = stateIO.fileDigest(files.selection);
  if (options.file) options.initialInputHash = stateIO.fileDigest(options.file);
  if (mode==='status') {
    const inventory=await readInventory(options.project,options.targets);
    if(fs.existsSync(files.selection)) showPlan(buildPlan({mode:'status',selection:config.readSelection(files.selection),inventory,state:stateIO.readState(files.state),targets:options.targets,selectionDigest:'status',project:options.project}));
    else for(const row of inventory.items)console.log(`${row.name} [${row.target}] source: ${row.source??'UNKNOWN'}`);
    if(inventory.problems.length)fail(inventory.problems.map(p=>p.message).join('\n'));
    return 0;
  }
  if(mode==='doctor') {
    await upstream.runSkills(options.project,['--help']);console.log('ok: npx skills --help runs');
    const inventory=await readInventory(options.project,options.targets);
    if(inventory.problems.length)fail(inventory.problems.map(p=>p.message).join('\n'));
    console.log('ok: installed project skills can be inspected');
    console.log('info: skills-lock.json is used by snapshot source resolution; source evidence may also be available from the upstream inventory');
    return 0;
  }
  if(mode==='snapshot') {
    const inventory=await readInventory(options.project,options.targets);
    if(inventory.problems.length)fail(inventory.problems.map(p=>p.message).join('\n'));
    const snapshot={schema:'skillsman.snapshot.v1',targets:{}};
    for(const target of options.targets.includes('all')?[...new Set(inventory.items.map(item=>item.target))]:options.targets) snapshot.targets[target]={skills:[]};
    for(const row of inventory.items){if(!row.source||row.problems.length)fail(`snapshot cannot resolve source or content for ${row.name}`);snapshot.targets[row.target]??={skills:[]};snapshot.targets[row.target].skills.push({name:row.name,source:config.replaySource(row)});}
    const output=options.output||path.join(options.project,'.skillsman/skills.snapshot.yaml');
    const text=YAML.stringify(snapshot);config.parseSnapshot(text);
    stateIO.writeAtomic(output,text,stateIO.fileDigest(output));console.log(`Snapshot written to ${output}\nsummary: captured ${inventory.items.length} skills`);return 0;
  }
  if(mode==='remove') {
    ensureWritableScope(options);
    await withProjectLock(options.project,async()=>{
      for(const target of options.targets)await upstream.runSkills(options.project,['remove',...options.positional,'--agent',target==='all'?'*':target,'-y']);
      const after=await readInventory(options.project,options.targets);
      if(after.problems.length||after.items.some(row=>options.positional.includes(row.name)))fail('removal could not be verified');
    });
    console.log('Removed explicitly requested skills. Saved selection is unchanged; edit it if the choice should be removed too.');return 0;
  }
  if(mode==='apply') {
    const snapshot=config.parseSnapshot(fs.readFileSync(options.file,'utf8'));
    const targets = options.targets.includes('all') ? Object.keys(snapshot.targets) : options.targets;
    const selections=[];
    for(const target of targets) {
      if(target === 'all') fail('snapshot must contain concrete target IDs');
      if(!snapshot.targets[target]) fail(`snapshot has no skills for target: ${target}`);
      selections.push({target,selection:config.parseSelection(YAML.stringify({includes:[],skills:snapshot.targets[target].skills.map(item=>({source:item.source,why:'Restore snapshot selection',names:[item.name]}))}))});
    }
    // Merge once to reject cross-target source or installation-name collisions.
    const selection = selections.reduce((all,item)=>config.mergeSelection(all,item.selection),{includes:[],skills:[]});
    return runSelection({...options,targets,targetSelections:selections},selection,{saveSelection:false});
  }
  let selection;let fullSources=new Set();
  if(mode==='update') {
    if(!fs.existsSync(files.selection))fail('update requires .skillsman/skills.yaml; initialize an explicit selection first');
    selection=config.readSelection(files.selection);
  } else if(options.file) selection=config.readSelection(options.file);
  else ({selection,fullSources}=await scenarioSelection(options));
  if(mode==='add'&&fs.existsSync(files.selection)) selection=config.mergeSelection(config.readSelection(files.selection),selection);
  return runSelection(options,selection,{fullSources});
}
function showScenario(name) {
  for(const row of config.expandScenario(name,SCENARIOS)) {
    console.log(`${row.source} | ${row.names==null?'*':row.names.join(' ')}`);
    console.log(`  why: ${row.why}`);
  }
}
function coverage() {
  const sources=new Set(),names=new Set(),seen=new Map();let pairs=0,full=0,overlaps=0;
  for(const file of fs.readdirSync(SCENARIOS).filter(name=>name.endsWith('.yaml'))) {
    const scenario=config.readScenario(path.join(SCENARIOS,file));
    config.expandScenario(file.slice(0,-5),SCENARIOS);
    for(const row of scenario.skills){sources.add(row.source);if(row.names==null){full++;continue;}
      for(const name of row.names){pairs++;names.add(name);if(seen.has(name)){overlaps++;console.error(`overlap: ${name} in ${seen.get(name)} and ${file}`);}else seen.set(name,file);}}
  }
  console.log(`installable sources: ${sources.size}\nscenario skills: ${names.size}\nsource/skill pairs: ${pairs}\nall-source entries: ${full}\noverlap scenario skills: ${overlaps}\nmissing scenario includes: 0`);
  return overlaps?1:0;
}
function help() {
  console.log(`Skillsman — explicit project skill selections
Usage:
  skillsman list
  skillsman show <scenario>
  skillsman plan --file <selection.yaml> --target <targets> [--project <path>]
  skillsman init <scenario> --target <targets> [--project <path>]
  skillsman init --file <selection.yaml> --target <targets> [--project <path>]
  skillsman add <scenario> --target <targets> [--project <path>]
  skillsman add --file <selection.yaml> --target <targets> [--project <path>]
  skillsman update --target <targets> [--project <path>] [--dry-run]
  skillsman status [--target <targets>] [--project <path>]
  skillsman snapshot --target <targets> [--output <path>] [--project <path>]
  skillsman apply [snapshot-path] --target <targets> [--dry-run] [--project <path>]
  skillsman remove <skill...> --target <targets> [--project <path>]
  skillsman doctor [--target <targets>] [--project <path>]
  skillsman coverage
Targets: codex, claude-code (claude), cursor, gemini-cli (gemini), openclaw,
         antigravity, all, or an upstream agent id; comma-separated lists allowed.
Initialization preserves existing skills. Content updates require an explicit
selection and a verified baseline; shared-agent impact must be in scope.
Use --allow-self-install only to explicitly target this Skillsman checkout.`);
}
async function main(args) {
  const [command,...rest]=args;
  if(!command||['help','--help','-h'].includes(command)){help();return 0;}
  if(command==='list'){if(rest.length)fail('list does not accept arguments');console.log(fs.readdirSync(SCENARIOS).filter(f=>f.endsWith('.yaml')).map(f=>f.slice(0,-5)).sort().join('\n'));return 0;}
  if(command==='show'){if(rest.length!==1)fail('show requires exactly one scenario');showScenario(rest[0]);return 0;}
  if(command==='coverage'){if(rest.length)fail('coverage does not accept arguments');return coverage();}
  if(command==='restore')fail('restore is legacy and cannot verify explicit choices; use init --file or apply a current snapshot');
  if(['plan','init','add','update','status','snapshot','apply','remove','doctor'].includes(command))return runProjectCommand(command,rest);
  return runProjectCommand('init',[command.replace(/^--?/,''),...rest]);
}
if(require.main===module) main(process.argv.slice(2)).then(code=>{process.exitCode=process.exitCode||code;}).catch(error=>{console.error(`skillsman: ${error.message}`);process.exitCode=process.exitCode||1;});
module.exports={main,runProjectCommand,parseProjectArgs,withProjectLock};
