const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {makeProject,treeDigest}=require('./helpers/project.cjs');
const {withProjectLock}=require('../lib/skillsman/project.cjs');
test('lock excludes concurrent work and is released on success or failure',async t=>{const p=makeProject(t),lock=path.join(p.path,'.skillsman/operation.lock');await withProjectLock(p.path,async()=>{assert(fs.existsSync(lock));await assert.rejects(withProjectLock(p.path,async()=>assert.fail('entered competing operation')),/locked/);});assert(!fs.existsSync(lock));await assert.rejects(withProjectLock(p.path,async()=>{throw new Error('test failure');}),/test failure/);assert(!fs.existsSync(lock));});
test('externally replaced lock owner is never removed',async t=>{const p=makeProject(t),marker=path.join(p.path,'.skillsman/operation.lock/owner.json');await withProjectLock(p.path,async()=>fs.writeFileSync(marker,JSON.stringify({id:'another-owner'})));assert.equal(JSON.parse(fs.readFileSync(marker)).id,'another-owner');});
test('marker creation failure releases the newly created empty lock',async t=>{const p=makeProject(t),original=fs.writeFileSync;fs.writeFileSync=function(file,...rest){if(String(file).endsWith('owner.json'))throw new Error('marker injection');return original.call(this,file,...rest);};try{await assert.rejects(withProjectLock(p.path,async()=>{}),/marker injection/);}finally{fs.writeFileSync=original;}assert(!fs.existsSync(path.join(p.path,'.skillsman/operation.lock')));});
test('existing operation lock blocks installation without changing its owner',t=>{const p=makeProject(t),file=p.selection(['alpha']),lock=path.join(p.path,'.skillsman/operation.lock');fs.mkdirSync(lock,{recursive:true});fs.writeFileSync(path.join(lock,'owner.json'),'existing owner');const before=treeDigest(p.path),r=p.run('init','--file',file,'--target','codex');assert.notEqual(r.status,0);assert.match(r.stderr,/locked/);assert.equal(treeDigest(p.path),before);});
test('managed directory links are not followed for writes',t=>{const p=makeProject(t),f=p.selection(['alpha']),outside=path.join(p.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(p.path,'.skillsman'));const before=treeDigest(outside),r=p.run('init','--file',f,'--target','codex');assert.notEqual(r.status,0);assert.match(r.stderr,/symbolic link/);assert.equal(treeDigest(outside),before);});

test('interrupt terminates its installer and releases only its operation lock',async t=>{
 const p=makeProject(t),file=p.selection(['alpha']),marker=path.join(p.root,'installer.pid');p.configure({stallMarker:marker,stallProject:p.path});
 const child=require('node:child_process').spawn(path.resolve(__dirname,'../bin/skillsman'),['init','--file',file,'--target','codex'],{cwd:p.path,env:p.env,stdio:'ignore'});
 t.after(()=>{try{child.kill('SIGKILL');}catch{}});
 const deadline=Date.now()+8000;while(!fs.existsSync(marker)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 assert(fs.existsSync(marker),'installer started');const installer=Number(fs.readFileSync(marker));
 const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));child.kill('SIGINT');
 let timer;const result=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('interrupt timed out')),5000);})]).finally(()=>clearTimeout(timer));
 assert.equal(result.code,130);assert(!fs.existsSync(path.join(p.path,'.skillsman/operation.lock')));
 assert.throws(()=>process.kill(installer,0),{code:'ESRCH'});
});

test('installation refuses a skill container linked outside the selected project',t=>{const p=makeProject(t),f=p.selection(['alpha']),outside=path.join(p.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(p.path,'.agents'));const before=treeDigest(outside),r=p.run('init','--file',f,'--target','codex');assert.notEqual(r.status,0);assert.match(r.stderr,/outside.*project|escapes.*project/i);assert.equal(treeDigest(outside),before);});
