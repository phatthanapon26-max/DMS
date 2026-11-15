import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import '../scanner-vault.js';
import {createHandler} from '../api/scan-bridge.js';

test('vault leaves no plaintext document or metadata and authenticates owner, record and passphrase',async()=>{
 const {key,config}=await FreshyVault.create('alice','a random series of words');
 const doc={id:'file-a',owner:'alice',title:'private tax document',width:120,height:170,blob:new Blob(['private scan bytes'])};
 const sealed=await FreshyVault.encrypt(key,doc);
 assert.deepEqual(Object.keys(sealed).sort(),['id','image','meta','owner','v']);
 assert(!Buffer.from(sealed.image.ciphertext).includes('private scan bytes'));
 assert(!Buffer.from(sealed.meta.ciphertext).includes('private tax document'));
 await assert.rejects(FreshyVault.unlock(config,'a different set of words'));
 await assert.rejects(FreshyVault.unlock({...config,owner:'natt'},'a random series of words'));
 const reopened=await FreshyVault.unlock(config,'a random series of words');
 assert.equal((await FreshyVault.metadata(reopened,sealed)).title,doc.title);
 assert.equal(await (await FreshyVault.image(reopened,sealed)).text(),'private scan bytes');
 await assert.rejects(FreshyVault.image(reopened,{...sealed,id:'other'}));
 const copy=new Uint8Array(sealed.image.ciphertext.slice(0)); copy[0]^=1;
 await assert.rejects(FreshyVault.image(reopened,{...sealed,image:{...sealed.image,ciphertext:copy}}));
});

test('QR secret and separate pairing code are jointly required to find and decrypt the offer',async()=>{
 const source=await readFile(new URL('../scanner-pair.js',import.meta.url),'utf8');
 const keyOnly=source.replace('window.FreshyPair = { host, join, validCode };','window.derive = keys; window.validCode = validCode;');
 const window={};
 vm.runInNewContext(keyOnly,{window,crypto,TextEncoder,TextDecoder,btoa,atob});
 const secret=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const [a,b,c]=await Promise.all([window.derive(secret,'ABCD-EFGH-JKLM'),window.derive(secret,'abcd efgh jklm'),window.derive(secret,'BBCDEFGHJKLM')]);
 assert.equal(a.room,b.room); assert.notEqual(a.room,c.room);
 assert(window.validCode('ABCD-EFGH-JKLM'));assert(!window.validCode('ABCD'));
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},a.key,new TextEncoder().encode('offer'));
 assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},b.key,cipher)),'offer');
 await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv},c.key,cipher));
});

const publisher='P'.repeat(43), ingest='I'.repeat(43);
const env={SCAN_BRIDGE_ENABLED:'1',SCAN_BRIDGE_PUBLISHER_KEY:publisher,SCAN_BRIDGE_VAULT_INGEST_KEY:ingest};
const generation='27bc95b6-f118-4b5e-a73d-46a62f5c3e6a';
const snapshot={cursor:42,count:1,complete:true,records:[{id:generation,data:{
 state:'registered',media_type:'image/jpeg',byte_count:6000,updated_at:'2026-11-15T02:00:00Z'
}}]};

async function request(handler,method,key,body,extras={}) {
 const req={method,body,headers:{'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{}),...extras}};
 const res={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await handler(req,res); return res;
}
test('bridge sends no snapshot when Vault is disabled, revoked, or unavailable; only allows registry metadata',async()=>{
 let permission=423, duringSubmit=202, checks=0, sent=0;
 const handler=createHandler(env,async(url,opt)=>{
  assert.match(url,/^https:\/\/vault\.freshywater\.in\.th\/v1\/sources\/docs_scan\//);
  assert.equal(opt.headers.Authorization,'Bearer '+ingest);
  assert.equal(opt.redirect,'error');assert.equal(opt.cache,'no-store');
  if(url.endsWith('ingest-status')){
   checks++;assert.equal(opt.body,undefined);
   return permission===200?Response.json({generation,revision:3}):new Response('',{status:permission});
  }
  sent++;
  assert.equal(opt.headers['X-Freshy-Source-Generation'],generation);
  assert.equal(opt.headers['X-Freshy-Gate-Revision'],'3');
  assert.deepEqual(JSON.parse(opt.body),{source:'docs_scan',...snapshot});
  return Response.json({state:'pending'},{status:duringSubmit});
 });
 const post=()=>request(handler,'POST',publisher,snapshot);
 assert.equal((await request(handler,'POST',ingest,snapshot)).code,401);
 assert.equal((await request(handler,'POST',publisher,snapshot,{origin:'https://docs.freshywater.in.th'})).code,403);
 const excessive=structuredClone(snapshot);excessive.records[0].data.title='private document';
 assert.equal((await request(handler,'POST',publisher,excessive)).code,400);
 assert.equal(checks,0);
 assert.equal((await post()).code,423);assert.equal(sent,0);
 permission=409;assert.equal((await post()).code,423);assert.equal(sent,0);
 permission=503;assert.equal((await post()).code,503);assert.equal(sent,0);
 permission=200; assert.equal((await post()).code,202);assert.equal(sent,1);
 duringSubmit=409;assert.equal((await post()).body.error,'transfer_stopped');assert.equal(sent,2);
 assert.equal((await request(createHandler({},async()=>assert.fail()),'POST',publisher,snapshot)).code,503);
});

test('automatic scanner waits for an in-frame document, detail and 900 ms of stability',async()=>{
 const script=await readFile(new URL('../scanner.js',import.meta.url),'utf8');
 const instrumented=script.replace('if (now - state.steadySince >= 900) takePhoto(state, true);',
   'if (now - state.steadySince >= 900) capture();')
   .replace('window.FreshyScanner = { mount, close };','window.frame = checkFrame;');
 let mode='clear',offset=0,t=1000, captures=0;
 const pixelContext={drawImage(){},getImageData(_x,_y,w,h){
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const left=mode==='edge'?0:48+offset;
   const paper=x>=left&&x<=191+offset&&y>=34&&y<=281;
   const ink=mode!=='blur'&&x>left+16&&x<166+offset&&y>67&&y<247&&y%12<2&&x%8<6;
   const shade=mode==='dark'?20:paper?(ink?65:224):44;
   data.fill(shade,(y*w+x)*4,(y*w+x)*4+3);data[(y*w+x)*4+3]=255;
  }
  return {data};
 }};
 const guide={getContext:()=>Object.fromEntries(['clearRect','beginPath','rect','moveTo','lineTo','closePath','fill','stroke','setLineDash'].map(k=>[k,()=>{}]))};
 const fields={video:{videoWidth:240,videoHeight:320,readyState:2},guide,auto:{checked:true},status:{dataset:{}}};
 const state={find:k=>fields[k],steadySince:0};
 const window={addEventListener(){}};
 vm.runInNewContext(instrumented,{window,document:{createElement:()=>({getContext:()=>pixelContext}),addEventListener(){}},
   location:{hash:''},performance:{now:()=>t},capture:()=>captures++});
 function frames(n){for(let i=0;i<n;i++){window.frame(state);t+=175;}}
 for (const condition of ['edge','dark','blur']) {
  mode=condition;frames(8);assert.equal(captures,0,condition);
 }
 mode='clear';
 for(let i=0;i<10;i++){offset=i%2?11:0;frames(1);}
 assert.equal(captures,0,'motion');
 offset=0;frames(5);assert.equal(captures,0,'hold duration');
 frames(2);assert.equal(captures,1);
});
