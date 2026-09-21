const fs=require('node:fs'),path=require('node:path');
const control=JSON.parse(fs.readFileSync(process.env.SKILLSMAN_TEST_CONTROL,'utf8'));
let args=process.argv.slice(2);if(args[0]==='--yes'||args[0]==='-y')args.shift();
if(!/^skills(?:@[^ ]+)?$/.test(args.shift()||''))process.exit(90);
fs.appendFileSync(process.env.SKILLSMAN_TEST_LOG,JSON.stringify({cwd:process.cwd(),args})+'\n');
const command=args.shift();
if(command==='list' && control.editOnList && process.cwd()===control.editOnList.project){fs.writeFileSync(control.editOnList.file,control.editOnList.text);delete control.editOnList;fs.writeFileSync(process.env.SKILLSMAN_TEST_CONTROL,JSON.stringify(control));}
const project=process.cwd();const canonical=path.join(project,'.agents/skills');
const dirs={codex:'.agents/skills','claude-code':'.claude/skills',cursor:'.cursor/skills','test-agent':'.custom/skills'};
const labels={codex:'Codex','claude-code':'Claude Code',cursor:'Cursor','test-agent':'Test Agent'};
function values(flag){const i=args.indexOf(flag);if(i<0)return [];const r=[];for(let j=i+1;j<args.length&&!args[j].startsWith('--')&&args[j]!=='-y';j++)r.push(args[j]);return r;}
const agents=values('--agent');const requested=agents.includes('*')?Object.keys(dirs):agents;
const lockPath=path.join(project,'skills-lock.json');
const lock=fs.existsSync(lockPath)?JSON.parse(fs.readFileSync(lockPath,'utf8')):{version:1,skills:{}};
function slug(n){return n.toLowerCase().replace(/[^a-z0-9._]+/g,'-').replace(/^[.\-]+|[.\-]+$/g,'').slice(0,255)||'unnamed-skill';}
function installed(){if(!fs.existsSync(canonical))return [];return fs.readdirSync(canonical).flatMap(name=>{const p=path.join(canonical,name);if(!fs.existsSync(path.join(p,'SKILL.md')))return [];const active=Object.entries(dirs).filter(([_,d])=>fs.existsSync(path.join(project,d,name,'SKILL.md'))).map(([a])=>a);if(agents.length&&!agents.some(a=>active.includes(a)))return [];const data=fs.readFileSync(path.join(p,'SKILL.md'),'utf8');const raw=(data.match(/^name: (.+)$/m)||[])[1];const full=raw?(raw.startsWith('"')?JSON.parse(raw):raw):name;const e=lock.skills[full]||lock.skills[name];return [{name:full,path:p,scope:'project',agents:active.map(a=>labels[a]),source:e?.source??null,sourceType:e?.sourceType??null,sourceUrl:e?.sourceUrl??null}];});}
if(command==='--help'){console.log('skills add list --json remove --agent');process.exit(0);}
if(command==='list'){
 if(control.listFailure){console.error('fixture list failed');process.exit(7);}
 if(agents.includes('*')){console.error('Invalid agents: *');process.exit(1);}
 if(control.invalidJson){console.log('{broken');process.exit(0);}
 console.log(JSON.stringify(installed()));process.exit(0);
}
if(command==='remove'){for(const name of args.filter(a=>!a.startsWith('-')).slice(0,args.indexOf('--agent')<0?args.length:args.indexOf('--agent'))){for(const a of requested)fs.rmSync(path.join(project,dirs[a]||'.custom/skills',slug(name)),{recursive:true,force:true});}process.exit(0);}
if(command==='add' && control.stallMarker && project===control.stallProject){fs.writeFileSync(control.stallMarker,String(process.pid));setInterval(()=>{},1000);return;}
if(command==='add'){
 const source=args[0],cat={...control.catalog[source]};
 if(control.driftInProject===project)for(const n of Object.keys(cat))cat[n]+=' changed after probe';
 if(!control.catalog[source]||control.failSources?.includes(source)){console.error('fixture source unavailable: '+source);process.exit(9);}
 const names=values('--skill').length?values('--skill'):Object.keys(cat);
 if(control.extraName && !names.includes(control.extraName)) names.push(control.extraName);
 if(args.includes('--list')){console.log(Object.keys(cat).join('\n'));process.exit(0);}
 for(const name of names)if(!(name in cat)){console.error('Requested skill missing: '+name);process.exit(1);}
 for(const name of names){
  if(control.skipNames?.includes(name))continue;
  const p=path.join(canonical,slug(name));fs.rmSync(p,{recursive:true,force:true});fs.mkdirSync(path.join(p,'references'),{recursive:true});
  fs.writeFileSync(path.join(p,'SKILL.md'),'---\nname: '+JSON.stringify(name)+'\ndescription: Fixture skill\n---\n'+cat[name]+'\n');fs.writeFileSync(path.join(p,'references/example.md'),'reference '+cat[name]);
  for(const a of requested){const d=path.join(project,dirs[a]||'.custom/skills');fs.mkdirSync(d,{recursive:true});const link=path.join(d,slug(name));if(link!==p&&!fs.existsSync(link))fs.symlinkSync(path.relative(d,p),link);}
  lock.skills[name]={source:control.lockSourceBySource?.[source]||source,sourceType:source.startsWith('/')?'local':'github',computedHash:'fixture',...(control.skillPathByName?.[name]?{skillPath:control.skillPathByName[name]}:{})};fs.writeFileSync(lockPath,JSON.stringify(lock));
  if(control.failAfterName===name){console.error('partial fixture failure');process.exit(8);}
 }
 process.exit(0);
}
process.exit(91);
