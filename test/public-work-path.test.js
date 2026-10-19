import test from 'node:test';
import assert from 'node:assert/strict';
import {publicWorkSlug,createPublicWorkResolver} from '../public-work-path.js';
test('automatic movie names resolve with exact title and year without persistent storage',async()=>{
 const movie={id:1003598,media_type:'movie',title:'Avengers: Secret Wars',release_date:'2027-12-15'};
 assert.equal(publicWorkSlug(movie),'avengers-secret-wars-2027');
 let calls=0;
 const resolve=createPublicWorkResolver(async()=>{calls++;return {results:[{...movie,id:1,release_date:'2026-12-15'},movie,{...movie,id:2,adult:true}]};});
 assert.deepEqual(await resolve('avengers-secret-wars-2027'),{id:1003598,type:'movie',slug:'avengers-secret-wars-2027'});
 await resolve('avengers-secret-wars-2027');assert.equal(calls,1);
 assert.equal(await resolve('movies'),null);assert.equal(await resolve('undefined'),null);assert.equal(calls,1);
});
test('an ambiguous name never resolves to a guessed film',async()=>{
 const item={id:1,media_type:'movie',title:'Same Title',release_date:'2027-01-01'};
 const resolve=createPublicWorkResolver(async()=>({results:[item,{...item,id:2}]}));
 assert.equal(await resolve('same-title-2027'),null);
});
