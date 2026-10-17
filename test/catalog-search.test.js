import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestedQuery,matchingWorks,searchWithCatalog,presentSearchResults,searchResultCards} from '../catalog-search.js';
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

test('search cards present movies, series, anime and Arabic names without detail enrichment',()=>{
 const source={page:2,total_pages:6,total_results:107,results:[
  {id:1,media_type:'movie',title:'Spider-Man',original_title:'Spider-Man',original_language:'en',release_date:'2002-05-01',genre_ids:[28],overview:'An English search snippet'},
  {id:2,media_type:'tv',name:'Spider-Man',original_language:'en',first_air_date:'1994-11-19',genre_ids:[16]},
  {id:3,media_type:'movie',title:'Spider-Man: Into the Spider-Verse',original_language:'en',release_date:'2018-12-06',genres:[{id:16}]},
  {id:4,media_type:'movie',title:'An Arabic Film',original_title:'فيلم عربي',original_language:'ar'},
  {id:5,media_type:'person',name:'A Person'},
  {id:6,media_type:'movie',title:'Hidden',adult:true}
 ]};
 const presented=presentSearchResults(source),cards=searchResultCards(presented);
 assert.equal(cards.page,2);assert.equal(cards.total_pages,6);assert.equal(cards.total_results,107);
 assert.deepEqual(cards.results.map(item=>item.id),[1,2,3,4]);
 assert.equal(cards.results[0].display_title,'مشاهدة فيلم Spider-Man 2002 مترجم');
 assert.equal(cards.results[1].series_display_title,'مسلسل أنمي Spider-Man 1994 مترجم كامل');
 assert.equal(cards.results[2].display_title,'مشاهدة فيلم أنمي Spider-Man: Into the Spider-Verse 2018 مترجم');
 assert.deepEqual(cards.results[2].genre_ids,[16]);
 assert.equal(cards.results[3].title,'فيلم عربي');assert.equal(cards.results[3].display_title,'مشاهدة فيلم فيلم عربي');
 assert.equal(presented.results[0].overview,undefined,'search must not overwrite a saved localized detail story');
 assert.equal(source.results[0].overview,'An English search snippet','source data stays intact');
});

test('search responses omit saved detail payloads while preserving card links and pagination',()=>{
 const results=Array.from({length:20},(_,id)=>({id:id+1,media_type:'movie',title:'Spider-Man '+id,public_path:'/spider-man-'+id+'/',poster_path:'/poster.jpg',credits:{cast:Array.from({length:50},()=>({name:'Actor',biography:'x'.repeat(1000)}))},videos:{results:[{key:'example'}]},overview:'x'.repeat(5000),recommendations:{results:[{id:999}]},release_dates:{results:[]}}));
 const data={page:3,total_pages:6,total_results:107,corrected_query:'spider man',results};
 const cards=searchResultCards(data);
 assert.equal(cards.corrected_query,'spider man');assert.equal(cards.page,3);assert.equal(cards.total_pages,6);
 assert.equal(cards.results[0].public_path,'/spider-man-0/');assert.equal(cards.results[0].poster_path,'/poster.jpg');
 assert.equal(cards.results[0].credits,undefined);assert.equal(cards.results[0].overview,undefined);assert.equal(cards.results[0].recommendations,undefined);
 assert.ok(JSON.stringify(cards).length<10000,'the result payload contains card fields only');
});
