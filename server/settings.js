'use strict';
const fs=require('fs'),path=require('path');
const DEFAULTS={syncMode:'auto',syncDelayMs:3000};
function envDelay(){const raw=process.env.OVERLEAF_SYNC_DELAY_MS;if(raw===undefined||raw==='')return null;const n=Number(raw);return Number.isInteger(n)&&n>=1000&&n<=60000?n:null;}
function validate(data){
 if(data.syncMode!=='auto'&&data.syncMode!=='manual')throw new Error('syncMode 仅允许 auto 或 manual。');
 if(!Number.isInteger(data.syncDelayMs)||data.syncDelayMs<1000||data.syncDelayMs>60000)throw new Error('syncDelayMs 必须是 1000–60000 之间的整数毫秒值。');
 return {syncMode:data.syncMode,syncDelayMs:data.syncDelayMs};
}
function createSettings({directory}){
 const file=path.join(directory,'settings.json');
 function read(){
  const env=envDelay(),base={...DEFAULTS,...(env===null?{}:{syncDelayMs:env})};
  let saved=null;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return base;
  try{return validate({...base,...saved});}catch(_){return base;}
 }
 function update(patch){
  const next=validate({...read(),...patch});
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n',{mode:0o600});
  fs.renameSync(file+'.tmp',file);
  return next;
 }
 return {read,update,file};
}
module.exports={createSettings,DEFAULTS};
