// Run from the pinned Yomitan checkout. Real favorite builder and existing translator fixture.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {readFileSync} from "node:fs";
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
