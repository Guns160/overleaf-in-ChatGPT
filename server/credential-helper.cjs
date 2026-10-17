#!/usr/bin/env node
'use strict';
const {createStore}=require('./credentials');
((async()=>{
 const prompt=process.argv[2];
 if(prompt!==undefined&&!/assword/i.test(String(prompt)))return;
 const token=process.env.OVERLEAF_AUTH_TOKEN||await createStore().get(process.env.OVERLEAF_KEYCHAIN_ACCOUNT||'');
 process.stdout.write(token);
})()).catch(()=>{process.stderr.write('Overleaf credentials unavailable\n');process.exitCode=1;});
