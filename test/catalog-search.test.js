import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestedQuery,matchingWorks,searchWithCatalog} from '../catalog-search.js';
const works=[{id:1,type:'movie',name:'Doomsday',year:'2008'},{id:2,type:'movie',name:'Avengers: Doomsday',year:'2026'},{id:3,type:'movie',name:'Yagonan: The Dark Days of Doom',year:'2007'}];
test('search recognizes reordered letters and close misspellings without guessing unrelated or ambiguous words',()=>{
 assert.equal(suggestedQuery('daysdoom',works),'doomsday');assert.equal(suggestedQuery('doomsdy',works),'doomsday');
 assert.equal(suggestedQuery('zxqwerty',works),undefined);
 assert.equal(suggestedQuery('slient',[{name:'Silent'},{name:'Listen'}]),undefined);
 assert.deepEqual(matchingWorks('daysdoom',works).map(m=>m.id),[3]);assert.deepEqual(matchingWorks('Doomsday',works).map(m=>m.id),[1,2]);
});
test('related search uses the corrected keyword and preserves provider pagination instead of replacing it with one local film',async()=>{
 const calls=[];const result=await searchWithCatalog({query:'daysdoom',page:2,works:async()=>works,load:()=>assert.fail('Use provider results'),remote:async(q,page)=>{calls.push([q,page]);return q==='doomsday'?{page,total_pages:8,total_results:142,results:[{id:13460,media_type:'movie',title:'Doomsday'}]}:{page,total_pages:0,total_results:0,results:[]};}});
 assert.deepEqual(calls,[['daysdoom',2],['doomsday',2]]);assert.equal(result.corrected_query,'doomsday');assert.equal(result.total_results,142);assert.equal(result.page,2);
});
test('normal results stay intact and locally corrected names remain searchable when the provider has no match',async()=>{
 const data={page:1,total_pages:1,total_results:1,results:[{id:1,media_type:'movie',title:'Doomsday'}]};
 assert.strictEqual(await searchWithCatalog({query:'Doomsday',remote:async()=>data,works:()=>assert.fail('Normal search needs no correction')}),data);
 const result=await searchWithCatalog({query:'darkdaysdoom',remote:async()=>({results:[]}),works:async()=>works,load:async m=>({id:m.id,title:m.name})});
 assert.equal(result.total_results,1);assert.equal(result.results[0].id,3);assert.equal(result.results[0].media_type,'movie');
});
