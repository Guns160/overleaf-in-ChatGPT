'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
process.env.PATH=['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin',process.env.PATH||''].join(path.delimiter);
const VERSION='0.7.0',UI='ui://overleaf/editor-v7';
const children=new Set();
process.on('unhandledRejection',e=>{try{process.stderr.write('[overleaf-panel] 未处理的异步错误：'+String((e&&e.stack)||e).slice(-2000)+'\n');}catch(_){}});
const MANIFEST=process.env.OVERLEAF_PROJECTS_MANIFEST||path.join(os.homedir(),'.config/overleaf-mcp/projects.manifest.json');
const CACHE_ROOT=process.env.OVERLEAF_PANEL_CACHE||(process.platform==='darwin'?path.join(os.homedir(),'Library/Caches/overleaf-panel'):process.platform==='win32'?path.join(process.env.LOCALAPPDATA||os.homedir(),'Overleaf Local/Cache'):path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'overleaf-local'));
let clientCapabilities={};const clientRequests=new Map();let clientSequence=1;
function run(command,args,options={}){return new Promise(resolve=>{
 const child=spawn(command,args,{...options,detached:process.platform!=='win32'});let out='',err='',timedOut=false;const timeoutMs=options.timeoutMs||60000;
 children.add(child);
 const timer=setTimeout(()=>{timedOut=true;try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch(_){}},timeoutMs);
 child.stdout?.on('data',d=>{out=(out+d).slice(-5000000);});child.stderr?.on('data',d=>{err=(err+d).slice(-300000);});
 child.on('error',e=>{children.delete(child);clearTimeout(timer);resolve({ok:false,out,err,error:e.message,timedOut,timeoutMs});});
 child.on('close',code=>{children.delete(child);clearTimeout(timer);resolve({ok:code===0,code,out,err,timedOut,timeoutMs});});
});}
const registry=require('./registry')({run,manifest:MANIFEST});
async function getEntry(key){return registry.getEntry(key);}
const settings=require('./settings').createSettings({directory:path.dirname(MANIFEST)});
const localRemote=process.env.OVERLEAF_LOCAL_REMOTE_ROOT;
const workspace=require('./workspace')({getEntry,run,settings,...(localRemote?{remoteForEntry:e=>path.join(localRemote,e.projectId+'.git'),authForEntry:async()=>process.env}:{})});
const preview=require('./preview')({CACHE_ROOT,getEntry,workspace,run});
const resources=require('./resource-preview')({CACHE_ROOT,workspace,run});
const icon=[{src:'data:image/svg+xml;base64,'+fs.readFileSync(path.join(__dirname,'../assets/overleaf-logo.svg')).toString('base64'),mimeType:'image/svg+xml',sizes:['20x20']}];
const tools=[];
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const key={projectKey:{type:'string'}};
function define(name,title,description,properties,required,readOnly=true,meta={ui:{visibility:['app']}}){tools.push({name:'overleaf.'+name,title,description,inputSchema:schema(properties,required),annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:!readOnly},_meta:meta});}
for(const [name,title,type] of [['browse','Overleaf','global'],['tray','LaTeX 编辑器','thread']]){define(name,title,'打开本地 LaTeX 编辑器、文件树及 PDF 面板，后台同步到 Overleaf。',{},[],false,{ui:{resourceUri:UI},'openai/ui':{entrypoints:[{type}]},'openai/iconStyle':'monochrome'});tools[tools.length-1].icons=icon;}
for(const name of ['editor','preview'])define(name,name==='editor'?'打开论文编辑器':'打开论文 PDF 预览','打开指定 Overleaf 论文的本地编辑器与 PDF 预览。',key,['projectKey'],false,{ui:{resourceUri:UI}});
define('listProjects','论文列表','读取登记项目的真实名称、key 和项目 ID。',{},[]);
define('bootstrap','工作台初始化','读取此使用者自己的项目、连接账号和本地能力。',{},[]);
define('connectAccount','连接 Overleaf 账号','使用使用者自己的 Git 令牌验证项目权限，并保存到系统安全凭据库。令牌不向模型公开。',{label:{type:'string'},token:{type:'string'},projectUrl:{type:'string'},accountId:{type:'string'}},['label','token','projectUrl'],false);
define('disconnectAccount','断开账号','删除此账号保存在本机密码库中的令牌。',{accountId:{type:'string'}},['accountId'],false);
define('addOverleafProject','导入 Overleaf 项目','为此使用者登记拥有权限的 Overleaf 项目。项目名称由使用者填写。',{name:{type:'string'},projectUrl:{type:'string'},accountId:{type:'string'}},['name','projectUrl','accountId'],false);
define('inspectLocalProject','检查本地 LaTeX 项目','只读检查使用者选定的文件夹和可选主文件。',{folderPath:{type:'string'}},['folderPath']);
define('addLocalProject','打开本地 LaTeX 项目','登记并直接编辑使用者选定的现有本地文件夹，无需 Overleaf 账号。',{folderPath:{type:'string'},name:{type:'string'},mainFile:{type:'string'}},['folderPath'],false);
define('createLocalProject','新建本地 LaTeX 项目','在新文件夹中创建 LaTeX 项目，不覆盖已有文件夹，也不创建 Overleaf 云端项目。',{name:{type:'string'},parentDirectory:{type:'string'},folderName:{type:'string'},template:{enum:['article','ctex']}},['name'],false);
define('pickDirectory','选择本地文件夹','请求桌面宿主显示目录选择器；未支持时允许使用者粘贴文件夹路径。',{},[]);
define('openProject','打开本地项目','读取持久本地工作副本并启动后台同步。',key,['projectKey'],false);
define('projectStatus','本地保存与同步状态','读取本地文件列表、文件版本和后台同步状态。',{...key,filePath:{type:'string'}},['projectKey']);
define('listFiles','文件列表','列出本地工作副本的文件。',key,['projectKey']);
define('readFile','读取本地源文件','读取本地源文件的完整内容和内容哈希。',{...key,filePath:{type:'string'}},['projectKey','filePath']);
define('saveFile','保存本地源文件','原子保存编辑内容到本地；内容版本不匹配时拒绝覆盖，保存后后台同步。',{...key,filePath:{type:'string'},content:{type:'string'},expectedHash:{type:['string','null']}},['projectKey','filePath','content','expectedHash'],false);
define('syncProject','后台同步','后台拉取、合并和推送本地修改，不强制推送。',key,['projectKey'],false);
define('getSettings','同步设置','读取自动/手动同步模式与自动同步防抖等待时长。',{},[]);
define('updateSettings','更新同步设置','切换自动/手动同步，或调整自动同步防抖等待时长（毫秒）。',{syncMode:{enum:['auto','manual']},syncDelayMs:{type:'integer',minimum:1000,maximum:60000}},[],false);
define('conflictDetails','同步冲突差异','读取冲突文件的本地版本和 Overleaf 版本。',key,['projectKey']);
define('resolveConflicts','处理同步冲突','按用户对每个冲突文件的选择保留版本并同步；不会静默覆盖。',{...key,conflictId:{type:'string'},choices:{type:'object',additionalProperties:{enum:['local','remote']}}},['projectKey','conflictId','choices'],false);
define('startPreview','编译本地 PDF','从本地已保存内容创建独立副本并编译，不等待或读取远端更新。',{...key,force:{type:'boolean'}},['projectKey']);
define('previewStatus','PDF 编译进度','查询本地 PDF 编译进度。',{buildId:{type:'string'}},['buildId']);
define('previewPage','PDF 页面','读取本地编译 PDF 的一页。',{buildId:{type:'string'},page:{type:'integer',minimum:1}},['buildId','page']);
define('resourcePreview','预览项目图片与 PDF','读取项目中的图片、PDF 或兼容 PDF 的 AI 文件，并生成只读预览。',{...key,filePath:{type:'string'},page:{type:'integer',minimum:1}},['projectKey','filePath']);
define('completionIndex','LaTeX 补全索引','读取当前本地项目中的标签、引用键、自定义命令及文件路径。',key,['projectKey']);
define('exportPreview','导出 PDF','将已编译 PDF 导出到本机下载目录中的 Overleaf Local 文件夹，不覆盖已有文件。',{buildId:{type:'string'}},['buildId'],false);
for(const t of tools){if(['openProject','projectStatus','readFile','saveFile','syncProject','conflictDetails','getSettings','updateSettings'].includes(t.name.split('.')[1]))t._meta.ui.visibility=['model','app'];}
function listProjects(){return registry.listProjects();}
function folderPickerAvailable(){return !!clientCapabilities.extensions?.['openai/elicitation']?.form;}
function requestClient(method,params){const id='picker-'+clientSequence++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clientRequests.delete(id);reject(Error('文件夹选择已超时，可粘贴本地路径。'));},150000);clientRequests.set(id,{resolve,reject,timer});process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
async function pickDirectory(){if(!folderPickerAvailable())return {unsupported:true};const r=await requestClient('openai/elicitation/create',{mode:'form',message:'选择本地 LaTeX 项目文件夹或新项目的保存位置',requestedSchema:{type:'object',properties:{folder:{type:'string',title:'本地文件夹',format:'uri','x-openai-input':{type:'resource',options:[],userOptions:{kind:'directory'}}}},required:['folder']}});if(r.action!=='accept')return {cancelled:true};const uri=r.content?.folder;if(typeof uri!=='string'||!uri.startsWith('file:'))throw Error('当前宿主没有返回本地文件夹路径，请粘贴绝对路径。');return {folderPath:require('url').fileURLToPath(uri)};}
function result(data,text){return {content:[{type:'text',text:text||'Overleaf 本地编辑器。'}],structuredContent:data};}
async function call(name,args){
 if(['overleaf.browse','overleaf.tray','overleaf.editor','overleaf.preview'].includes(name))return result({projects:listProjects(),projectKey:args.projectKey||null});
 if(name==='overleaf.listProjects')return result({projects:listProjects()});
 if(name==='overleaf.bootstrap')return result({projects:listProjects(),accounts:registry.listAccounts(),features:{folderPicker:folderPickerAvailable(),platform:process.platform,localProjects:true},version:VERSION,settings:settings.read()});
 if(name==='overleaf.getSettings')return result(settings.read(),'当前同步设置。');
 if(name==='overleaf.updateSettings')return result(settings.update(args),'同步设置已更新。');
 if(name==='overleaf.resourcePreview')return resources.preview(args);
 if(name==='overleaf.completionIndex')return require('./latex-index').projectIndex(workspace,args);
 if(name==='overleaf.pickDirectory')return result(await pickDirectory());
 const management={connectAccount:registry.connectAccount,disconnectAccount:registry.disconnectAccount,addOverleafProject:registry.addRemote,inspectLocalProject:registry.inspectLocal,addLocalProject:registry.openLocal,createLocalProject:registry.createProject};
 const manage=management[name.replace(/^overleaf\./,'')];if(manage)return result(await manage(args));
 const handlers={openProject:workspace.open,projectStatus:workspace.status,listFiles:workspace.status,readFile:workspace.read,saveFile:workspace.save,syncProject:workspace.sync,conflictDetails:workspace.conflictDetails,resolveConflicts:workspace.resolve,startPreview:preview.start,previewStatus:preview.status,previewPage:preview.page,exportPreview:preview.exportPDF};
 const handler=handlers[name.replace(/^overleaf\./,'')];if(!handler)throw Error('未知工具：'+name);return handler(args);
}
function html(){const base=fs.readFileSync(path.join(__dirname,'app.html'),'utf8'),bundle=fs.readFileSync(path.join(__dirname,'../assets/editor.bundle.js'),'utf8').replace(/<\/script/gi,'<\\/script');return base.replace('/*EDITOR_BUNDLE*/',()=>bundle);}
function send(id,result,error){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...(error?{error}:{result})})+'\n');}
async function handle(m){
 if(!m.method&&clientRequests.has(m.id)){const p=clientRequests.get(m.id);clientRequests.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return;}
 if(m.id===undefined)return;
 try{let r;
 switch(m.method){
 case 'initialize':clientCapabilities=m.params?.capabilities||{};r={protocolVersion:'2025-11-25',capabilities:{tools:{},resources:{}},serverInfo:{name:'overleaf-panel',version:VERSION,title:'Overleaf Local'}};break;
 case 'ping':r={};break;
 case 'tools/list':r={tools};break;
 case 'resources/list':r={resources:[{uri:UI,name:'Overleaf 本地 LaTeX 编辑器',mimeType:'text/html;profile=mcp-app'}]};break;
 case 'resources/read':if(m.params.uri!==UI)throw Error('未知界面资源');r={contents:[{uri:UI,mimeType:'text/html;profile=mcp-app',text:html(),_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':{availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'fullscreen'}}}]};break;
 case 'tools/call':try{r=await call(m.params.name,m.params.arguments||{});}catch(e){const message=String((e&&e.message)||e).replace(/git:[^@]+@/g,'git:[MASKED]@');r={isError:true,content:[{type:'text',text:message}]};}break;
 default:throw Error('未知方法：'+m.method);
 }send(m.id,r);
 }catch(e){send(m.id,null,{code:-32603,message:e.message});}
}
let buffer='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;try{handle(JSON.parse(line)).catch(e=>process.stderr.write(e.message+'\n'));}catch(_){send(null,null,{code:-32700,message:'Invalid JSON'});}}});
process.stdin.on('end',()=>{workspace.close().finally(()=>{for(const child of children){try{process.platform==='win32'?child.kill('SIGTERM'):process.kill(-child.pid,'SIGTERM');}catch(_){}}setTimeout(()=>{for(const child of children){try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch(_){}}process.exit(0);},500);});});
process.stderr.write('[overleaf-panel] local editor '+VERSION+' started\n');
