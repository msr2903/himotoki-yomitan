import {it,expect,vi,afterEach} from 'vitest';import {JSDOM} from 'jsdom';import {HimotokiController} from '../ext/js/pages/settings/himotoki-controller.js';
afterEach(()=>vi.unstubAllGlobals());
it('late saved-list failure overwrites signed-out settings status with old signed-in account text',async()=>{
 const dom=new JSDOM('<div id="himotoki-account-status"></div><div id="himotoki-sign-in-unavailable"></div><div id="himotoki-redirect-url"></div><button id="himotoki-sign-in"></button><button id="himotoki-sign-out"></button><select id="himotoki-folder"></select>');vi.stubGlobal('document',dom.window.document);vi.stubGlobal('CSS',{escape:x=>x});
 let reject;const held=new Promise((_,r)=>reject=r);const api={himotokiGetSaved:vi.fn(()=>held),himotokiSignOut:vi.fn(async()=>({signedIn:false,signInAvailable:true,redirectUrl:'https://example.test/oauth'}))};const controller=new HimotokiController({application:{api}});
 const initial=controller._applyStatus({signedIn:true,signInAvailable:true,email:'old-account@example.test',redirectUrl:'https://example.test/oauth'});
 await controller._onSignOutClick();expect(document.querySelector('#himotoki-account-status').textContent).toContain('Not signed in.');expect(document.querySelector('#himotoki-sign-out').hidden).toBe(true);
 // The actual client rejects an obsolete response after its account generation changes.
 reject(new Error('Account changed while the request was in flight'));await initial;
 const text=document.querySelector('#himotoki-account-status').textContent;expect(text).toContain('Signed in as old-account@example.test');expect(document.querySelector('#himotoki-sign-out').hidden).toBe(true);console.log('After successful sign-out, late rejected read displays:',text,'; sign-out button remains hidden.');
});
