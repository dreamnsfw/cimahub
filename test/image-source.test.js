import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createImageSourceResolver} from '../image-source.js';

test('named images missing from a fresh catalog map recover from their owning work',async()=>{
 const calls=[];
 const source=createImageSourceResolver({catalog:{imageSource:async name=>name.includes('backdrop')?'/'+name:undefined,resolve:async slug=>{assert.equal(slug,'the-kapil-sharma-show-2016');return {type:'tv',id:66465};}},load:async(endpoint,params)=>{calls.push(endpoint);assert.equal(params.get('language'),'en-US');return {poster_path:'/real-provider-poster.jpg',backdrop_path:'/real-backdrop.jpg'};}});
 assert.equal(await source('the-kapil-sharma-show-2016-poster.jpg'),'/real-provider-poster.jpg');
 assert.equal(await source('the-kapil-sharma-show-2016-backdrop-2.jpg'),'/real-backdrop.jpg');
 assert.deepEqual(calls,['tv/66465','tv/66465']);
});
test('saved mappings and raw provider hashes do not request work details',async()=>{
 const source=createImageSourceResolver({catalog:{imageSource:async name=>name==='film-2026-poster.jpg'?'/saved.jpg':undefined,resolve:()=>{throw new Error('unexpected work lookup');}},load:()=>{throw new Error('unexpected provider call');}});
 assert.equal(await source('film-2026-poster.jpg'),'/saved.jpg');
 assert.equal(await source('rawProviderHash.jpg'),'/rawProviderHash.jpg');
 assert.equal(await source('../private.jpg'),null);
});
test('recovery coalesces concurrent work lookups and rejects unsafe or missing sources',async()=>{
 let calls=0;
 const source=createImageSourceResolver({catalog:{imageSource:async()=>undefined,resolve:async()=>({type:'movie',id:1})},load:async()=>{calls++;await Promise.resolve();return {poster_path:'https://untrusted.test/image.jpg'};}});
 assert.deepEqual(await Promise.all([source('film-2026-poster.jpg'),source('film-2026-poster.jpg')]),[null,null]);
 assert.equal(calls,1);
 const absent=createImageSourceResolver({catalog:{imageSource:async()=>undefined,resolve:async()=>undefined},load:()=>{throw new Error('unknown work must not fetch');}});
 assert.equal(await absent('missing-poster.jpg'),null);
});
