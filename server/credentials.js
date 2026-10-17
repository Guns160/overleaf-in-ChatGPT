'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawn}=require('child_process');
const SERVICE='codex-overleaf-mcp';
function execute(command,args,input){return new Promise(resolve=>{const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill(),15000);child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});child.on('error',()=>{clearTimeout(timer);resolve({ok:false,out:'',err});});child.on('close',code=>{clearTimeout(timer);resolve({ok:code===0,code,out,err});});child.stdin.on('error',()=>{});child.stdin.end(input||'');});}
const tailOf=err=>{const lines=String(err||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);return lines.length?'：'+lines[lines.length-1].slice(-200):'';};
function stateDirectory(){return process.env.OVERLEAF_EDITOR_STATE||(process.platform==='win32'?path.join(process.env.APPDATA||os.homedir(),'Overleaf Local'):process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support/Overleaf Local'):path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'overleaf-local'));}
function createStore({platform=process.platform,executeCommand=execute,directory=stateDirectory()}={}){
 const valid=account=>{if(!/^[a-zA-Z0-9:_-]{1,200}$/.test(account))throw Error('无效凭据账号');};
 const encryptedFile=account=>path.join(directory,'credentials',crypto.createHash('sha256').update(account).digest('hex')+'.dpapi');
 async function put(account,token){valid(account);let r;
  if(platform==='darwin')r=await executeCommand('/usr/bin/security',['add-generic-password','-U','-a',account,'-s',SERVICE,'-w'],token+'\n'+token+'\n');
  else if(platform==='linux')r=await executeCommand('secret-tool',['store','--label=Overleaf Local','application',SERVICE,'account',account],token);
  else if(platform==='win32'){r=await executeCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'],token);if(r.ok){const file=encryptedFile(account);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,r.out.trim(),{mode:0o600});}}
  else throw Error('当前系统尚无可用的安全凭据存储，可先使用纯本地项目。');
  if(!r?.ok)throw Error((platform==='linux'?'无法使用系统密码库，请先配置 Secret Service（secret-tool）。':'无法保存系统凭据，请检查系统密码库是否可用。')+tailOf(r?.err));
 }
 async function get(account){valid(account);let r;
  if(platform==='darwin')r=await executeCommand('/usr/bin/security',['find-generic-password','-w','-a',account,'-s',SERVICE]);
  else if(platform==='linux')r=await executeCommand('secret-tool',['lookup','application',SERVICE,'account',account]);
  else if(platform==='win32'){const file=encryptedFile(account);if(!fs.existsSync(file))throw Error('尚未连接此账号');r=await executeCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'],fs.readFileSync(file,'utf8'));}
  if(!r?.ok||!r.out.trim())throw Error('无法读取账号凭据，请重新连接 Overleaf 账号。'+tailOf(r?.err));return r.out.trim();
 }
 async function remove(account){valid(account);
  if(platform==='darwin'){const r=await executeCommand('/usr/bin/security',['delete-generic-password','-a',account,'-s',SERVICE]);if(!r.ok&&r.code!==44)throw Error('系统密码库未允许删除凭据，账号仍保持原状态。'+tailOf(r.err));}
  else if(platform==='linux'){const r=await executeCommand('secret-tool',['clear','application',SERVICE,'account',account]);if(!r.ok&&r.code!==1)throw Error('系统密码库未允许删除凭据，账号仍保持原状态。'+tailOf(r.err));}
  else if(platform==='win32'){const file=encryptedFile(account);if(fs.existsSync(file))fs.unlinkSync(file);}
 }return {put,get,remove};
}
function quote(value){return "'"+String(value).replace(/'/g,"'\\''")+"'";}
function gitEnvironment(entry,temporaryToken){
 const dir=stateDirectory();fs.mkdirSync(dir,{recursive:true,mode:0o700});const helper=path.join(__dirname,'credential-helper.cjs');
 const script=process.platform==='win32'?path.join(dir,'git-askpass.cmd'):path.join(dir,'git-askpass.sh');
 const content=process.platform==='win32'?'@echo off\r\n"'+process.execPath.replace(/%/g,'%%')+'" "'+helper.replace(/%/g,'%%')+'" %*\r\n':'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(helper)+' "$@"\n';
 if(!fs.existsSync(script)||fs.readFileSync(script,'utf8')!==content)fs.writeFileSync(script,content,{mode:0o700});
 fs.chmodSync(script,0o700);
 const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:script,OVERLEAF_KEYCHAIN_ACCOUNT:entry.keychainAccount};delete env.OVERLEAF_AUTH_TOKEN;if(temporaryToken)env.OVERLEAF_AUTH_TOKEN=temporaryToken;return env;
}
module.exports={createStore,gitEnvironment,stateDirectory,SERVICE};
