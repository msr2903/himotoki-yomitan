// Run from the pinned Yomitan checkout. Real HimotokiClient, with controlled Chrome
// storage callbacks and token response; no real account or network is used.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readFileSync} from 'node:fs';
const {HimotokiClient}=await import(pathToFileURL(path.join(process.cwd(),'ext/js/comm/himotoki-client.js')));
const old={uid:'fixture',idToken:'old',refreshToken:'refresh',expiresAt:0,email:'fixture@example.invalid'};
let stored={himotokiSession:old},pendingSet;
globalThis.chrome={runtime:{},identity:{getRedirectURL:()=> 'https://fixture.chromiumapp.org/'},storage:{local:{
 get(keys,cb){cb({...stored});},
 set(data,cb){pendingSet=()=>{Object.assign(stored,data);cb();};},
 remove(key,cb){delete stored[key];cb();}
}}};
globalThis.fetch=async()=>new Response(JSON.stringify({id_token:'refreshed',refresh_token:'refresh-new',expires_in:'3600'}),{status:200,headers:{'Content-Type':'application/json'}});
const client=new HimotokiClient();
const refresh=client.getSaved(false).catch(e=>e.message);
for(let i=0;i<20&&!pendingSet;i++)await new Promise(r=>setImmediate(r));
assert.ok(pendingSet);
await client.signOut();assert.equal(stored.himotokiSession,undefined);
pendingSet();await refresh;
const current=await client.getStatus(),afterRestart=await new HimotokiClient().getStatus();
assert.equal(current.signedIn,false);assert.equal(afterRestart.signedIn,true);
console.log(JSON.stringify({case:'successful old token persistence completes after successful sign-out removal',currentSignedIn:current.signedIn,restartedSignedIn:afterRestart.signedIn,storedToken:stored.himotokiSession.idToken,storageErrors:0}));

const {buildHimotokiFavorite}=await import(pathToFileURL(path.join(process.cwd(),'ext/js/data/himotoki-favorite-builder.js')));
function findEntry(value){
 if(!value||typeof value!=='object')return null;
 if(value.type==='term'&&value.pronunciations?.some(g=>g.headwordIndex===0&&g.pronunciations.filter(p=>p.type==='pitch-accent'&&typeof p.positions==='number').length>1))return value;
 for(const child of Object.values(value)){const found=findEntry(child);if(found)return found;}
 return null;
}
const entry=findEntry(JSON.parse(readFileSync('test/data/translator-test-results.json','utf8')));
assert.ok(entry);
const fav=buildHimotokiFavorite(entry,{sentence:{text:'猫です'},url:'https://fixture.invalid',documentTitle:'fixture'},{folderId:''});
assert.equal(fav.pitch,'0');
console.log(JSON.stringify({case:'saving an existing translator fixture keeps only its first pitch pattern',headword:fav.headword,dictionaryPatterns:entry.pronunciations[0].pronunciations.map(p=>p.positions),savedPitch:fav.pitch,fixture:'test/data/translator-test-results.json'}));
