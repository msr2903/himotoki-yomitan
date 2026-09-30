import {describe,expect,it,vi} from 'vitest';
import {AudioDownloader} from '../ext/js/media/audio-downloader.js';
describe('audit: Wikimedia audio terms',()=>{
 it('C++ has a supplied matching filename but is rejected and query pluses become spaces',async()=>{
  const fetchAnonymous=vi.fn(async(url)=>Response.json(fetchAnonymous.mock.calls.length===1?{query:{search:[{title:'File:Ja-C++.ogg'}]}}:{query:{pages:{1:{imageinfo:[{url:'https://upload.wikimedia.org/example.ogg',user:'Reader'}]}}}}));
  const downloader=new AudioDownloader({fetchAnonymous});
  const result=await downloader.getTermAudioInfoList({type:'wiktionary'},'C++','シープラスプラス',{iso:'ja'});
  expect(result).toEqual([]);const search=new URL(fetchAnonymous.mock.calls[0][0]).searchParams.get('srsearch');expect(search).toContain('C  ');console.log('Decoded srsearch:',search,'matching result count:',result.length);
 });
 it('regex syntax in a dictionary term rejects an otherwise literal matching recording',async()=>{
  const fetchAnonymous=vi.fn(async()=>Response.json(fetchAnonymous.mock.calls.length===1?{query:{search:[{title:'File:Ja-(笑).ogg'}]}}:{query:{pages:{1:{imageinfo:[{url:'https://upload.wikimedia.org/example.ogg',user:'Reader'}]}}}}));
  const downloader=new AudioDownloader({fetchAnonymous});const result=await downloader.getTermAudioInfoList({type:'wiktionary'},'(笑)','わらい',{iso:'ja'});expect(result).toEqual([]);console.log('Literal (笑) recording rejected:',result.length===0);
 });
});
