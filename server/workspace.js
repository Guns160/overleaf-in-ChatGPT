'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {gitEnvironment,stateDirectory}=require('./credentials');
const idFor=entry=>entry.storageId||entry.projectId||entry.localId;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=content=>crypto.createHash('sha256').update(content).digest('hex');
const editable=/\.(tex|bib|bst|bbl|cls|sty|txt|md|json|ya?ml|csv)$/i;

module.exports=function createWorkspace(options){
 const {getEntry,run}=options;
 const root=options.root||process.env.OVERLEAF_WORKSPACE_ROOT||path.join(os.homedir(),'Documents','Overleaf Local');
 const stateRoot=options.stateRoot||stateDirectory();
 const remoteFor=options.remoteForEntry||(entry=>'https://git@git.overleaf.com/'+entry.projectId);
 const settings=options.settings||require('./settings').createSettings({directory:path.dirname(process.env.OVERLEAF_PROJECTS_MANIFEST||path.join(os.homedir(),'.config/overleaf-mcp/projects.manifest.json'))});
 const delay=()=>options.syncDelayMs??settings.read().syncDelayMs,retryDelay=options.retryDelayMs??30000,longDelay=Math.max(options.longDelayMs??300000,retryDelay*4);
 const timers=new Map(),active=new Map(),hashCache=new Map(),backoff=new Map();let closed=false;
 fs.mkdirSync(root,{recursive:true,mode:0o700});fs.mkdirSync(path.join(stateRoot,'locks'),{recursive:true,mode:0o700});
 const hooks=path.join(stateRoot,'disabled-hooks');fs.mkdirSync(hooks,{recursive:true});
 const repoFor=entry=>entry.localPath||path.join(root,idFor(entry));
 const stateFile=entry=>path.join(stateRoot,idFor(entry)+'.json');
 const safeError=e=>String(e.message||e).replace(/git:[^@]+@/g,'git:[MASKED]@').slice(-2500);

 async function lock(key,fn){
  const dir=path.join(stateRoot,'locks',key),token=crypto.randomUUID(),deadline=Date.now()+45000;
  while(true){
   try{fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'owner.json'),JSON.stringify({pid:process.pid,token}));break;}
   catch(e){
    if(e.code!=='EEXIST')throw e;
    let dead=false;
    try{const owner=JSON.parse(fs.readFileSync(path.join(dir,'owner.json'),'utf8'));try{process.kill(owner.pid,0);}catch(p){dead=p.code==='ESRCH';}}catch(_){if(!fs.existsSync(dir))continue;try{dead=Date.now()-fs.statSync(dir).mtimeMs>10000;}catch(_){continue;}}
    if(dead){try{fs.rmSync(dir,{recursive:true});}catch(_){}continue;}
    if(Date.now()>deadline)throw new Error('项目正在执行另一项操作，请稍后重试。');
    await sleep(60);
   }
  }
  try{return await fn();}finally{try{if(JSON.parse(fs.readFileSync(path.join(dir,'owner.json'))).token===token)fs.rmSync(dir,{recursive:true});}catch(_){}}
 }
 function readState(entry){try{return JSON.parse(fs.readFileSync(stateFile(entry),'utf8'));}catch(_){return {status:'local',lastSavedAt:null,lastSyncedAt:null,conflicts:[]};}}
 async function update(entry,values){return lock(idFor(entry)+'-state',async()=>{const s={...readState(entry),...values};const file=stateFile(entry);fs.writeFileSync(file+'.tmp',JSON.stringify(s));fs.renameSync(file+'.tmp',file);return s;});}
 async function auth(entry){if(entry.accountDisconnected)throw Error('账号已断开。本地文件可继续编辑，请在“账号”中重新连接以恢复同步。');return options.authForEntry?options.authForEntry(entry):gitEnvironment(entry);}
 async function git(repo,args,entry,{allowFailure=false,network=false}={}){
  const timeoutMs=network?25000:15000;
  const r=await run('git',['-c','core.hooksPath='+hooks,'-c','commit.gpgsign=false','-c','user.name=Overleaf Local','-c','user.email=overleaf-local@localhost','-c','credential.helper=','-C',repo,...args],{env:network?await auth(entry):process.env,timeoutMs});
  if(!r.ok&&!allowFailure)throw new Error(r.timedOut?'操作超时（'+Math.round((r.timeoutMs||timeoutMs)/1000)+' 秒）：git '+(args[0]||'同步'):(r.err||r.error||r.out||'Git 操作失败').slice(-3000));
  return r;
 }
 async function entryFor(key){const entry=await getEntry(key);if(!/^[0-9a-f]{24}$/.test(idFor(entry)))throw new Error('无效项目 ID');return entry;}
 async function local(key){
  const entry=await entryFor(key),repo=repoFor(entry);
  if(entry.type==='local'){if(!fs.existsSync(repo)||!fs.statSync(repo).isDirectory())throw Error('本地项目文件夹不存在，请重新选择。');return {entry,repo};}
  if(!fs.existsSync(path.join(repo,'.git')))await lock(idFor(entry)+'-files',async()=>{
   if(fs.existsSync(path.join(repo,'.git')))return;
   const temp=repo+'-clone-'+crypto.randomUUID();
   try{
    const r=await run('git',['-c','credential.helper=','clone','-q','--',remoteFor(entry),temp],{env:await auth(entry),timeoutMs:60000});
    if(!r.ok)throw new Error(r.timedOut?'首次下载项目超时（'+Math.round((r.timeoutMs||60000)/1000)+' 秒），请重试。':'首次下载项目失败：'+(r.err||r.error||'未知错误'));
    try{const exclude=path.join(temp,'.git','info','exclude');fs.mkdirSync(path.dirname(exclude),{recursive:true});let cur='';try{cur=fs.readFileSync(exclude,'utf8');}catch(_){}if(!cur.split('\n').includes('/.local-write-*'))fs.writeFileSync(exclude,(cur&&!cur.endsWith('\n')?cur+'\n':cur)+'/.local-write-*\n');}catch(_){}
    fs.renameSync(temp,repo);
   }catch(e){if(fs.existsSync(temp))fs.rmSync(temp,{recursive:true});throw e;}
  });
  return {entry,repo};
 }
 function files(repo){
  const list=[];function walk(dir,rel=''){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.name.startsWith('.'))continue;const f=rel?rel+'/'+ent.name:ent.name;if(ent.isSymbolicLink())continue;if(ent.isDirectory())walk(path.join(dir,ent.name),f);else if(ent.isFile())list.push(f);}}walk(repo);return list.sort();
 }
 function safePath(repo,file){
  if(typeof file!=='string'||!file||path.isAbsolute(file)||file.includes('\0')||file.split(/[\\/]/).some(p=>!p||p==='..'||p.startsWith('.')))throw new Error('无效文件路径');
  const abs=path.join(repo,file);
  if(!abs.startsWith(repo+path.sep))throw new Error('文件路径越界');
  let parent=abs;while(parent!==repo){if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw new Error('不支持符号链接');parent=path.dirname(parent);}return abs;
 }
 function statSignature(st){return st.dev+':'+st.ino+':'+st.size+':'+st.mtimeMs+':'+st.ctimeMs;}
 function rememberHash(abs,sig,value){hashCache.delete(abs);hashCache.set(abs,{sig,hash:value});if(hashCache.size>64)hashCache.delete(hashCache.keys().next().value);}
 function fileHash(repo,file){
  const abs=safePath(repo,file);let st;try{st=fs.statSync(abs);}catch(_){return null;}
  const sig=statSignature(st),cached=hashCache.get(abs);if(cached&&cached.sig===sig)return cached.hash;
  const value=hash(fs.readFileSync(abs));rememberHash(abs,sig,value);return value;
 }
 function strictFileHash(repo,file){
  const abs=safePath(repo,file);let st;try{st=fs.statSync(abs);}catch(_){return null;}
  const value=hash(fs.readFileSync(abs));rememberHash(abs,statSignature(st),value);return value;
 }
 function cleanContent(repo,file){if(!editable.test(file))throw new Error('该文件不能在源码编辑器中编辑');const abs=safePath(repo,file);const data=fs.readFileSync(abs);if(data.length>1500000)throw new Error('文件超过编辑器的 1.5 MB 上限');return data.toString('utf8');}
 const INDEX_FILE_BYTES=1500000;
 function sourceStat(repo,file){
  const abs=safePath(repo,file);let st;try{st=fs.statSync(abs);}catch(e){if(e.code==='ENOENT')return {abs,missing:true};throw e;}
  if(!st.isFile())return {abs,missing:true};
  return st.size>INDEX_FILE_BYTES?{abs,tooLarge:true}:{abs,stat:{dev:st.dev,ino:st.ino,size:st.size,mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs}};
 }
 async function sourceStats(args){
  const {entry,repo}=await local(args.projectKey),list=Array.isArray(args.files)?args.files.slice(0,1000):[];
  return lock(idFor(entry)+'-files',async()=>({sources:list.map(file=>({filePath:file,...sourceStat(repo,file)}))}));
 }
 function readSource(repo,file){
  const abs=safePath(repo,file);let fd;try{fd=fs.openSync(abs,'r');}catch(e){if(e.code==='ENOENT')return {filePath:file,missing:true};throw e;}
  try{
   const st=fs.fstatSync(fd);
   if(!st.isFile())return {filePath:file,missing:true};
   if(st.size>INDEX_FILE_BYTES)return {filePath:file,tooLarge:true};
   const data=Buffer.alloc(st.size);let off=0;
   while(off<st.size){const n=fs.readSync(fd,data,off,st.size-off,off);if(n<=0)break;off+=n;}
   return {filePath:file,abs,stat:{dev:st.dev,ino:st.ino,size:st.size,mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs},content:data.subarray(0,off).toString('utf8')};
  }finally{fs.closeSync(fd);}
 }
 async function readSources(args){
  const {entry,repo}=await local(args.projectKey),list=Array.isArray(args.files)?args.files.slice(0,1000):[];
  return lock(idFor(entry)+'-files',async()=>({sources:list.map(file=>readSource(repo,file))}));
 }
 function result(data,text=''){return {content:[{type:'text',text:text||'本地项目状态已更新。'}],structuredContent:data};}
 async function status(args){const {entry,repo}=await local(args.projectKey);const list=await lock(idFor(entry)+'-files',async()=>files(repo));return result({projectKey:args.projectKey,projectId:entry.projectId||null,type:entry.type||'overleaf',name:entry.name,localPath:repo,sync:entry.type==='local'?{...readState(entry),status:'local_only'}:readState(entry),files:list,fileHash:args.filePath?fileHash(repo,args.filePath):undefined});}
 async function open(args){const data=await status(args);if(data.structuredContent.type!=='local')schedule(args.projectKey,1000);return data;}
 async function read(args){const {entry,repo}=await local(args.projectKey);return lock(idFor(entry)+'-files',async()=>{const content=cleanContent(repo,args.filePath);return result({projectKey:args.projectKey,filePath:args.filePath,content,hash:hash(content)});});}
 async function save(args){
  const {entry,repo}=await local(args.projectKey);if(!editable.test(args.filePath)||typeof args.content!=='string'||Buffer.byteLength(args.content)>1500000)throw new Error('无效内容或文件类型');
  const data=await lock(idFor(entry)+'-files',async()=>{
   const abs=safePath(repo,args.filePath),current=strictFileHash(repo,args.filePath);
   if(current!==(args.expectedHash??null))throw new Error('文件已在另一个窗口或同步中更新。你的编辑仍保留在编辑器，请先比较版本。');
   const next=hash(args.content);if(next===current)return {hash:next,sync:readState(entry)};
   fs.mkdirSync(path.dirname(abs),{recursive:true});const tmp=path.join(path.dirname(abs),'.local-write-'+crypto.randomUUID());fs.writeFileSync(tmp,args.content,{mode:0o600});fs.renameSync(tmp,abs);
   try{rememberHash(abs,statSignature(fs.statSync(abs)),next);}catch(_){}
   const s=await update(entry,{lastSavedAt:new Date().toISOString(),status:entry.type==='local'?'local_only':readState(entry).status==='conflict'?'conflict':'pending',error:null});
   return {hash:next,sync:s};
  });if(entry.type!=='local')schedule(args.projectKey);return result({...data,projectKey:args.projectKey,filePath:args.filePath},entry.type==='local'?'已保存到本地。':'已保存到本地，后台将同步到 Overleaf。');
 }
 function sweepLocalWrites(dir){
  let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(_){return;}
  for(const ent of entries){
   if(ent.name==='.git')continue;
   const p=path.join(dir,ent.name);
   if(ent.isFile()&&ent.name.startsWith('.local-write-')){try{fs.rmSync(p,{force:true});}catch(_){}}
   else if(ent.isDirectory())sweepLocalWrites(p);
  }
 }
 async function commitLocal(repo,entry){
  sweepLocalWrites(repo);
  const dirty=(await git(repo,['status','--porcelain'],entry)).out.trim();if(!dirty)return;
  await git(repo,['add','-A','--','.'],entry);
  await git(repo,['commit','-m','Update from local LaTeX editor'],entry);
 }
 async function branch(repo,entry){const b=(await git(repo,['branch','--show-current'],entry)).out.trim();if(!b)throw new Error('本地项目未处于可同步的分支');await git(repo,['check-ref-format','--branch',b],entry);return b;}
 async function abortMerge(repo,entry){if(fs.existsSync(path.join(repo,'.git','MERGE_HEAD')))await git(repo,['merge','--abort'],entry);}
 async function performSync(key){
  const {entry,repo}=await local(key);
  if(entry.type==='local'){await update(entry,{status:'local_only'});return {clean:true};}
  return lock(idFor(entry)+'-sync',async()=>{
  if(readState(entry).status!=='synced')await update(entry,{status:'syncing',error:null});
   try{
    const b=await branch(repo,entry);
    await git(repo,['fetch','--quiet','origin',b],entry,{network:true});
    const remote=(await git(repo,['rev-parse','FETCH_HEAD'],entry)).out.trim();
    let conflict=null,sendHead;
    await lock(idFor(entry)+'-files',async()=>{
     await commitLocal(repo,entry);
     const localHead=(await git(repo,['rev-parse','HEAD'],entry)).out.trim();
     if(localHead!==remote){
      const remoteBefore=await git(repo,['merge-base','--is-ancestor',remote,localHead],entry,{allowFailure:true});
      if(!remoteBefore.ok){
       const localBefore=await git(repo,['merge-base','--is-ancestor',localHead,remote],entry,{allowFailure:true});
       if(localBefore.ok){await git(repo,['merge','--ff-only',remote],entry);}
       else {
       const merge=await git(repo,['merge','--no-edit','--no-commit','--no-ff',remote],entry,{allowFailure:true});
       if(!merge.ok){
        const paths=(await git(repo,['diff','--name-only','--diff-filter=U','-z'],entry)).out.split('\0').filter(Boolean);
        await abortMerge(repo,entry);
        if(!paths.length)throw new Error(merge.err||merge.out||'合并失败');
        conflict={id:hash(localHead+remote),localHead,remoteHead:remote,paths};return;
       }
       if(fs.existsSync(path.join(repo,'.git','MERGE_HEAD')))await git(repo,['commit','-m','Merge Overleaf updates'],entry);
       }
      }
     }
     sendHead=(await git(repo,['rev-parse','HEAD'],entry)).out.trim();
    });
   if(conflict){await update(entry,{status:'conflict',conflict,conflicts:conflict.paths,error:'本地与 Overleaf 修改了相同内容，请选择保留的版本。'});return {conflict:true};}
    if(sendHead!==remote)await git(repo,['push','--quiet','origin',sendHead+':refs/heads/'+b],entry,{network:true});
   let dirty=false;
   await lock(idFor(entry)+'-files',async()=>{dirty=!!(await git(repo,['status','--porcelain'],entry)).out.trim();await update(entry,{status:dirty?'pending':'synced',lastSyncedAt:new Date().toISOString(),syncedRevision:sendHead,conflict:null,conflicts:[],error:null});});
   return {clean:!dirty};
  }catch(e){await abortMerge(repo,entry).catch(()=>{});await update(entry,{status:'offline',error:safeError(e)});return {failed:true};}
  });
 }
 function schedule(key,ms=delay()){
  if(closed||settings.read().syncMode==='manual')return;
  if(timers.has(key))clearTimeout(timers.get(key));
  const timer=setTimeout(()=>{timers.delete(key);start(key).catch(()=>{});},ms);timer.unref?.();timers.set(key,timer);
  try{options.onSchedule?.(key,ms);}catch(_){}
 }
 function nextDelay(key,outcome){
  if(outcome&&outcome.conflict){backoff.delete(key);return null;}
  if(outcome&&outcome.failed){const level=Math.min((backoff.get(key)||0)+1,4);backoff.set(key,level);return [retryDelay,retryDelay*2,retryDelay*4,longDelay][level-1];}
  backoff.delete(key);
  return outcome&&outcome.clean?longDelay:delay();
 }
 async function start(key){
  if(timers.has(key)){clearTimeout(timers.get(key));timers.delete(key);}
  if(active.has(key))return;
 const task=performSync(key).then(outcome=>{const ms=nextDelay(key,outcome);if(ms!==null)schedule(key,ms);},async e=>{
  try{const entry=await entryFor(key);await update(entry,{status:'offline',error:safeError(e)});}
  catch(e2){try{process.stderr.write('[overleaf-panel] 同步状态更新失败：'+safeError(e2)+'\n');}catch(_){}}
  const ms=nextDelay(key,{failed:true});if(ms!==null)schedule(key,ms);
 }).finally(()=>{active.delete(key);}).catch(e=>{try{process.stderr.write('[overleaf-panel] 后台同步调度失败：'+safeError(e)+'\n');}catch(_){}});
 active.set(key,task);
 }
 async function sync(args){
  const {entry}=await local(args.projectKey);if(entry.type==='local')return status(args);
  await start(args.projectKey);
  const task=active.get(args.projectKey);
  if(task){let timer;const cap=new Promise(resolve=>{timer=setTimeout(resolve,75000);});timer.unref?.();try{await Promise.race([task.catch(()=>{}),cap]);}finally{clearTimeout(timer);}}
  return status(args);
 }
 async function waitIdle(key){if(active.has(key))await active.get(key);return status({projectKey:key});}
 async function conflictVersion(repo,entry,ref,file){
  const size=await git(repo,['cat-file','-s',ref+':'+file],entry,{allowFailure:true});
  if(!size.ok)return null;
  const bytes=Number(size.out.trim())||0;
  if(bytes>512*1024)return '二进制文件（'+bytes+' 字节）：请在文件树中用预览对比';
  const content=await git(repo,['show',ref+':'+file],entry,{allowFailure:true});
  if(!content.ok)return null;
  return content.out.includes('\0')?'二进制文件（'+bytes+' 字节）：请在文件树中用预览对比':content.out;
 }
 async function conflictDetails(args){
  const {entry,repo}=await local(args.projectKey),s=readState(entry);if(!s.conflict)throw new Error('当前没有待处理的同步冲突');
  const versions=[];for(const file of s.conflict.paths)versions.push({filePath:file,local:await conflictVersion(repo,entry,s.conflict.localHead,file),remote:await conflictVersion(repo,entry,s.conflict.remoteHead,file)});
  return result({conflictId:s.conflict.id,versions});
 }
 async function resolve(args){
  const {entry,repo}=await local(args.projectKey);
  await lock(idFor(entry)+'-sync',async()=>{
   const s=readState(entry),conflict=s.conflict;if(!conflict||conflict.id!==args.conflictId)throw new Error('冲突版本已变化，请刷新后再选择。');
   const choices=args.choices||{};if(!conflict.paths.every(f=>['local','remote'].includes(choices[f])))throw new Error('请为每个冲突文件选择版本');
   const b=await branch(repo,entry);await git(repo,['fetch','--quiet','origin',b],entry,{network:true});
   const remote=(await git(repo,['rev-parse','FETCH_HEAD'],entry)).out.trim();if(remote!==conflict.remoteHead)throw new Error('Overleaf 已有新修改，请重新同步后比较。');
   await lock(idFor(entry)+'-files',async()=>{
    if((await git(repo,['status','--porcelain'],entry)).out.trim()||(await git(repo,['rev-parse','HEAD'],entry)).out.trim()!==conflict.localHead)throw new Error('本地已有新修改，请重新同步后比较。');
    try{
     await git(repo,['merge','--no-edit','--no-commit','--no-ff',remote],entry,{allowFailure:true});
     for(const file of conflict.paths){
      const side=choices[file]==='local'?'ours':'theirs';
      const ref=choices[file]==='local'?conflict.localHead:remote;
      const exists=await git(repo,['cat-file','-e',ref+':'+file],entry,{allowFailure:true});
      if(exists.ok)await git(repo,['checkout','--'+side,'--',file],entry);else {const abs=safePath(repo,file);if(fs.existsSync(abs))fs.rmSync(abs);}
      await git(repo,['add','-A','--',file],entry);
     }
     if((await git(repo,['diff','--name-only','--diff-filter=U'],entry)).out.trim())throw new Error('仍有未解决冲突');
     await git(repo,['commit','-m','Resolve Overleaf synchronization conflicts'],entry);
    }catch(e){await abortMerge(repo,entry);throw e;}
   });
   await update(entry,{status:'pending',conflict:null,conflicts:[],error:null});
  });await start(args.projectKey);return status(args);
 }
 async function snapshot(key,dest=null){
  const {entry,repo}=await local(key);
  return lock(idFor(entry)+'-files',async()=>{
   const all=files(repo),digest=crypto.createHash('sha256');
   for(const file of all){const data=fs.readFileSync(safePath(repo,file));digest.update(file+'\0');digest.update(data);if(dest){const target=path.join(dest,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}}
   const revision=entry.type==='local'?'local':(await git(repo,['rev-parse','HEAD'],entry)).out.trim(),dirty=entry.type==='local'?false:!!(await git(repo,['status','--porcelain'],entry)).out.trim();
   return {files:all,revision,sourceHash:digest.digest('hex'),dirty,localPath:repo};
  });
 }
 function close(){closed=true;for(const t of timers.values())clearTimeout(t);timers.clear();return Promise.allSettled([...active.values()]);}
 return {open,status,read,save,sync,resolve,conflictDetails,snapshot,local,waitIdle,sourceStats,readSources,close,root,stateRoot};
};
