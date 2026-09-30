import {expect,it} from 'vitest';import {buildHimotokiFavorite,stableSeq} from '../ext/js/data/himotoki-favorite-builder.js';import {createEmptySavedBlob,upsertFavorite} from '../ext/js/data/himotoki-saved-blob.js';
it('two real Japanese words get the same fallback id and merge into one favorite',()=>{
 const dictionary='Custom Japanese Dictionary';
 const rows=[{term:'ジョーゼット',reading:'ジョーゼット',gloss:'georgette',localSeq:42},{term:'運び込む',reading:'はこびこむ',gloss:'to carry in; to bring in',localSeq:43}];
 const favorites=rows.map(r=>buildHimotokiFavorite({type:'term',headwords:[{index:0,term:r.term,reading:r.reading,sources:[{deinflectedText:r.term}]}],definitions:[{headwordIndices:[0],dictionary,sequences:[r.localSeq],entries:[r.gloss]}],pronunciations:[]},{},{enable:true,folderId:'',includeSentence:false,includeUrl:false}));
 expect(stableSeq(rows[0].term,rows[0].reading,dictionary)).toBe('yt_8e85038f');expect(favorites[0].seq).toBe(favorites[1].seq);
 const first=upsertFavorite(createEmptySavedBlob(1),favorites[0],2),second=upsertFavorite(first.blob,favorites[1],3);
 expect(first.added).toBe(true);expect(second.added).toBe(false);expect(second.blob.favorites).toHaveLength(1);expect(second.blob.favorites[0].headword).toBe('運び込む');console.log(JSON.stringify({favorites,firstAdded:first.added,secondAdded:second.added,result:second.blob.favorites}));
});
