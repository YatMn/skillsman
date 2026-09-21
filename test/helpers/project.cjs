const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
function makeProject(t){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'skillsman-test-')));
 const project=path.join(dir,'project'); const bin=path.join(dir,'bin');
 fs.mkdirSync(project);fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'npx'),'#!/usr/bin/env node\nrequire('+JSON.stringify(path.join(root,'test/fixtures/fake-npx.cjs'))+');\n',{mode:0o755});
 const control=path.join(dir,'control.json'),log=path.join(dir,'calls.jsonl');
 const catalog={'example/kit':{alpha:'alpha v1',beta:'beta v1',gamma:'gamma'},'example/other':{delta:'delta'},'obra/superpowers':{brainstorming:'brainstorming'},'YatMn/skillsman':Object.fromEntries(['agents-md','branch','next-prompt','openspec','readme'].map(n=>['skillsman-'+n,n]))};
 const settings={catalog}; fs.writeFileSync(control,JSON.stringify(settings));
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,SKILLSMAN_TEST_CONTROL:control,SKILLSMAN_TEST_LOG:log};
 const result={path:project,root:dir,env,control,log,settings,
  configure(patch){Object.assign(settings,patch);fs.writeFileSync(control,JSON.stringify(settings));},
  calls(){return fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];},
  cleanup(){fs.rmSync(dir,{recursive:true,force:true});},
  run(...args){return spawnSync(path.join(root,'bin/skillsman'),args,{cwd:project,env,encoding:'utf8',timeout:20000});},
  selection(names=['alpha','beta'],source='example/kit',file=path.join(dir,'selection.yaml')){fs.writeFileSync(file,'includes: []\nskills:\n  - source: '+JSON.stringify(source)+'\n    why: Project needs\n    names:\n'+names.map(n=>'      - '+JSON.stringify(n)+'\n').join(''));return file;}
 };
 if(t)t.after(()=>result.cleanup());return result;
}
function treeDigest(project){const rows=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const f=path.join(dir,name),s=fs.lstatSync(f),r=path.relative(project,f);if(s.isSymbolicLink())rows.push([r,'link',fs.readlinkSync(f)]);else if(s.isDirectory()){rows.push([r,'dir']);walk(f);}else rows.push([r,'file',fs.readFileSync(f).toString('base64')]);}}walk(project);return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
module.exports={makeProject,treeDigest};
