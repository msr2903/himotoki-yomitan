process.env.SQLITE_READONLY='true';
const {buildHimotokiFavorite}=await import(`${process.env.YOMITAN_ROOT}/ext/js/data/himotoki-favorite-builder.js`);
const options={enable:true,folderId:'',includeSentence:true,includeUrl:true};const ctx={url:'https://example.test/lesson',sentence:{text:'猫が好きです。'},documentTitle:'Audit fixture',query:'猫',fullQuery:'猫が好きです。'};
const word={type:'term',headwords:[{index:0,term:'猫',reading:'ねこ',sources:[{deinflectedText:'猫'}]}],definitions:[{headwordIndices:[0],dictionary:'Custom Japanese Dictionary',sequences:[42],entries:['cat']}],pronunciations:[]};
const kanji={type:'kanji',character:'猫',dictionary:'KANJIDIC',definitions:['cat']};
const favorites=[word,kanji].map(e=>({...buildHimotokiFavorite(e,ctx,options),savedAt:Date.now()}));
const {app}=await import(`${process.env.APP_ROOT}/packages/api/src/app.ts`);
for(const f of favorites){const path=`/api/entry/${f.source}/${f.seq}`;const r=await app.request(path);console.log(JSON.stringify({favorite:f,path,status:r.status,response:await r.json()}));if(r.status!==404)throw new Error('Expected 404');}
const {writeFileSync}=await import('node:fs');writeFileSync('/tmp/himotoki-yomitan-custom-favorites.json',JSON.stringify(favorites,null,2));
