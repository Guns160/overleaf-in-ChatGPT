#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),{execFileSync}=require('child_process');
const source=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(source,'plugin.json'),'utf8'));
if(manifest.name!=='overleaf')throw Error('Not an Overleaf plugin package');
const argv=process.argv.slice(2),custom=argv.includes('--codex')?argv[argv.indexOf('--codex')+1]:null;
const candidates=[custom,'codex',...(process.platform==='darwin'?['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex','/Applications/Codex.app/Contents/Resources/codex']:[])].filter(Boolean);
let cli;for(const executable of candidates){try{execFileSync(executable,['plugin','--help'],{stdio:'pipe',timeout:10000});cli=executable;break;}catch(_){}}
if(!cli){console.error('未找到支持本地插件的 Codex 命令。请在桌面插件页上传 ZIP，或用 --codex 指定命令路径。');process.exit(1);}
const root=path.join(os.homedir(),'.agents','overleaf-shared-market'),target=path.join(root,'plugins','overleaf');
if(argv.includes('--dry-run')){console.log(JSON.stringify({plugin:manifest.name,version:manifest.version,marketplace:'overleaf-shared',target,cli,willCopyAccounts:false},null,2));process.exit(0);}
fs.mkdirSync(path.join(root,'.agents','plugins'),{recursive:true});
if(fs.existsSync(target)&&fs.realpathSync(target)!==fs.realpathSync(source)){const backup=path.join(root,'backups','overleaf-'+Date.now());fs.mkdirSync(path.dirname(backup),{recursive:true});fs.cpSync(target,backup,{recursive:true});}
if(path.resolve(source)!==path.resolve(target)){fs.mkdirSync(target,{recursive:true});for(const name of ['plugin.json','mcp.json','.mcp.json','.codex-plugin','package.json','server','assets','skills','scripts','ui-src','README.md','INSTALL.md','THIRD_PARTY_NOTICES.md']){const src=path.join(source,name);if(fs.existsSync(src))fs.cpSync(src,path.join(target,name),{recursive:true,filter:p=>!p.split(path.sep).includes('node_modules')});}}
const marketplace={name:'overleaf-shared',interface:{displayName:'Overleaf Local'},plugins:[{name:'overleaf',source:{source:'local',path:'./plugins/overleaf'},policy:{installation:'AVAILABLE'},category:'Education & Research'}]};
fs.writeFileSync(path.join(root,'.agents/plugins/marketplace.json'),JSON.stringify(marketplace,null,2));
execFileSync(cli,['plugin','marketplace','add',root],{stdio:'inherit'});execFileSync(cli,['plugin','add','overleaf@overleaf-shared'],{stdio:'inherit'});
console.log('安装完成。请刷新桌面插件页并打开 Overleaf；在“账号”中连接自己的账号，或直接打开本地项目。');
