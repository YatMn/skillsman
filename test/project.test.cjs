const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {makeProject,treeDigest}=require('./helpers/project.cjs');
function ok(r){assert.equal(r.status,0,r.stderr+'\n'+r.stdout);}
function installed(p,n){return fs.existsSync(path.join(p.path,'.agents/skills',n,'SKILL.md'));}
test('preview is read-only; selected initialization is minimal and repeatable',t=>{
 const p=makeProject(t),file=p.selection(),before=treeDigest(p.path);
 ok(p.run('plan','--file',file,'--target','codex'));assert.equal(treeDigest(p.path),before);
 ok(p.run('init','--file',file,'--target','codex'));assert(installed(p,'alpha'));assert(installed(p,'beta'));assert(!installed(p,'gamma'));
 const saved=fs.readFileSync(path.join(p.path,'.skillsman/skills.yaml'),'utf8');assert(saved.includes('Project needs'));
 const adds=p.calls().filter(x=>x.args[0]==='add').length;const after=treeDigest(p.path);
 ok(p.run('init','--file',file,'--target','codex'));assert.equal(p.calls().filter(x=>x.args[0]==='add').length,adds);assert.equal(treeDigest(p.path),after);
});
test('selection reuse is independent and extra skills are preserved',t=>{
 const p=makeProject(t),q=makeProject(t),file=p.selection(['alpha']);ok(p.run('init','--file',file,'--target','codex'));
 const saved=path.join(p.path,'.skillsman/skills.yaml'),original=fs.readFileSync(saved,'utf8');ok(q.run('init','--file',saved,'--target','codex'));
 const beta=q.selection(['beta']);ok(q.run('add','--file',beta,'--target','codex'));assert(installed(q,'alpha'));assert(installed(q,'beta'));assert.equal(fs.readFileSync(saved,'utf8'),original);
});
test('source conflict blocks all writes',t=>{
 const p=makeProject(t),file=p.selection(['alpha']);ok(p.run('init','--file',file,'--target','codex'));
 p.configure({catalog:{...p.settings.catalog,'example/conflict':{alpha:'other'}}});const other=p.selection(['alpha'],'example/conflict',path.join(p.root,'other.yaml'));const before=treeDigest(p.path);assert.notEqual(p.run('add','--file',other,'--target','codex').status,0);assert.equal(treeDigest(p.path),before);
});
test('inventory error does not become an empty inventory',t=>{
 const p=makeProject(t),file=p.selection();p.configure({listFailure:true});const before=treeDigest(p.path);assert.notEqual(p.run('init','--file',file,'--target','codex').status,0);assert.equal(treeDigest(p.path),before);assert.equal(p.calls().filter(x=>x.args[0]==='add').length,0);
});
test('partial installation persists only verified successes and retries missing names',t=>{
 const p=makeProject(t),file=p.selection();p.configure({failAfterName:'alpha'});assert.notEqual(p.run('init','--file',file,'--target','codex').status,0);assert(installed(p,'alpha'));assert(!installed(p,'beta'));
 const state=JSON.parse(fs.readFileSync(path.join(p.path,'.skillsman/state.json'),'utf8'));assert.deepEqual(state.entries.map(e=>e.name),['alpha']);p.configure({failAfterName:null});ok(p.run('init','--file',file,'--target','codex'));assert(installed(p,'beta'));
});
test('updates are scoped, read-only in preview, and refuse local modifications',t=>{
 const p=makeProject(t),file=p.selection(['alpha']);ok(p.run('init','--file',file,'--target','codex'));
 p.settings.catalog['example/kit'].alpha='alpha v2';p.configure({});const before=treeDigest(p.path);ok(p.run('update','--target','codex','--dry-run'));assert.equal(treeDigest(p.path),before);
 ok(p.run('update','--target','codex'));assert(fs.readFileSync(path.join(p.path,'.agents/skills/alpha/SKILL.md'),'utf8').includes('v2'));assert(!installed(p,'gamma'));
 fs.writeFileSync(path.join(p.path,'.agents/skills/alpha/references/example.md'),'local edit');const edited=treeDigest(p.path);assert.notEqual(p.run('update','--target','codex').status,0);assert.equal(treeDigest(p.path),edited);
});
test('update requires explicit target and selection; empty selection does nothing',t=>{
 const p=makeProject(t);assert.notEqual(p.run('update').status,0);assert.notEqual(p.run('update','--target','codex').status,0);
 const f=path.join(p.root,'empty.yaml');fs.writeFileSync(f,'includes: []\nskills: []\n');ok(p.run('plan','--file',f,'--target','codex'));assert.equal(p.calls().filter(x=>x.args[0]==='add').length,0);
});

test('a selection edited during first inventory read is never overwritten',t=>{const p=makeProject(t),file=p.selection(['alpha']);const text='includes: []\nskills:\n  - source: example/kit\n    why: Changed intention\n    names:\n      - beta\n';p.configure({editOnList:{project:p.path,file,text}});const r=p.run('init','--file',file,'--target','codex');assert.notEqual(r.status,0);assert.match(r.stderr,/changed/);assert.equal(fs.readFileSync(file,'utf8'),text);assert(!p.calls().some(c=>c.args[0]==='add'));});
test('new target cannot overwrite another target local edits',t=>{const p=makeProject(t),file=p.selection(['alpha']);ok(p.run('init','--file',file,'--target','codex'));fs.writeFileSync(path.join(p.path,'.agents/skills/alpha/references/example.md'),'user work');const before=treeDigest(p.path),r=p.run('init','--file',file,'--target','claude');assert.notEqual(r.status,0);assert.match(r.stderr,/SHARED_IMPACT/);assert.equal(treeDigest(p.path),before);});

test('a failed second source leaves first-source evidence and retry fills only the failed source',t=>{
 const p=makeProject(t),file=path.join(p.root,'two-sources.yaml');
 fs.writeFileSync(file,'includes: []\nskills:\n  - source: example/kit\n    why: First responsibility\n    names:\n      - alpha\n  - source: example/other\n    why: Second responsibility\n    names:\n      - delta\n');
 p.configure({failSources:['example/other']});assert.notEqual(p.run('init','--file',file,'--target','codex').status,0);
 const state=JSON.parse(fs.readFileSync(path.join(p.path,'.skillsman/state.json'),'utf8'));assert.deepEqual(state.entries.map(row=>row.name),['alpha']);
 const count=p.calls().filter(c=>c.cwd===p.path&&c.args[0]==='add'&&c.args[1]==='example/kit').length;
 p.configure({failSources:[]});ok(p.run('init','--file',file,'--target','codex'));assert(installed(p,'delta'));
 assert.equal(p.calls().filter(c=>c.cwd===p.path&&c.args[0]==='add'&&c.args[1]==='example/kit').length,count);
});

test('an occupied directory with a different logical name cannot be overwritten',t=>{
 const p=makeProject(t),file=p.selection(['alpha']),dir=path.join(p.path,'.agents/skills/alpha');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'SKILL.md'),'---\nname: "beta"\ndescription: User-owned content\n---\nDo not overwrite');
 const before=treeDigest(p.path),r=p.run('init','--file',file,'--target','codex');assert.notEqual(r.status,0);assert.match(r.stderr,/NAME_CONFLICT/);assert.equal(treeDigest(p.path),before);assert(!p.calls().some(c=>c.args[0]==='add'));
});
