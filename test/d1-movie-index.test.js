import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {d1Statement} from '../d1-sql.js';
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../db/d1-schema.sql',import.meta.url),'utf8'));
let written=0;
globalThis[Symbol.for('cimahub.d1-index-test')]={
 query:async(sql,params=[])=>{const converted=d1Statement(sql,params);return {rows:db.prepare(converted.sql).all(...converted.params)};},
 batch:async statements=>{for(const {sql,params} of statements){const s=d1Statement(sql,params);written+=db.prepare(s.sql).run(...s.params).changes;}}
};
registerHooks({resolve(name,context,next){return name==='./database.js'?{url:'cimahub:test-index-db',shortCircuit:true}:next(name,context);},load(url,context,next){return url==='cimahub:test-index-db'?{format:'module',shortCircuit:true,source:`const db=globalThis[Symbol.for('cimahub.d1-index-test')];export const query=db.query,batchQuery=db.batch,dbEnabled=()=>true,transaction=()=>{throw new Error('Unexpected transaction');};`}:next(url,context);}});
process.env.D1_GATEWAY_URL='https://unused.example';process.env.D1_GATEWAY_TOKEN='fixture';
const {createMovieIndex}=await import('../movie-seo.js');
test('D1 movie index writes changed records only and independent instances retain each other’s records',async()=>{
 const first=createMovieIndex(),second=createMovieIndex();
 const work={id:1,title:'One',media_type:'movie',overview:'Story',release_date:'2026-01-01',poster_path:'/one.jpg',public_path:'/one-2026/'};
 await first.remember([work]);assert.equal(written,1);const before=(await first.all())[1];
 await first.remember([work]);assert.equal(written,1);assert.deepEqual((await first.all())[1],before);
 await second.remember([{...work,id:2,title:'Two',public_path:'/two-2026/'}]);assert.equal(written,2);
 const all=await first.all();assert.equal(all[1].path,'/one-2026/');assert.equal(all[2].path,'/two-2026/');db.close();
});
