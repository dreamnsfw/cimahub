import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRecentAdditions} from './recent-additions.js';

test('recent feed merges episodes and movies, deduplicates and preserves first addition',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-recent-'));
 try{
  const write=(file,data)=>writeFile(join(folder,file),JSON.stringify(data));
  await mkdir(join(folder,'series-links'));
  const movie={status:'matched',tmdbId:1,title:'Movie',checkedAt:'2026-01-01T00:00:00Z',playback:[{url:'https://example.com'}]};
  await write('qfilm-import.json',{entries:{a:movie,b:movie}});
  await write('series-links/2.json',{tmdbId:2,title:'Series',episodes:{'1-1':{checkedAt:'2026-01-02T00:00:00Z',downloads:[{url:'https://example.com'}]}}});
  const feed=createRecentAdditions(pathToFileURL(folder+'/'));
  const first=await feed();assert.equal(first.total_results,2);assert.equal(first.results[0].media_type,'tv');
  await write('qfilm-import.json',{entries:{a:{...movie,checkedAt:'2026-03-01T00:00:00Z'},c:{...movie,tmdbId:3}}});
  const next=await feed();assert.equal(next.results[0].id,3);assert.equal(next.results.find(m=>m.id===1).added_at,first.results.find(m=>m.id===1).added_at);
  assert.equal((await feed(999)).page,1);
 }finally{await rm(folder,{recursive:true,force:true});}
});
