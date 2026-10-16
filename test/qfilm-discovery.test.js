import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createQfilmDiscovery} from '../qfilm-discovery.js';

test('new source films are discovered without local visits or popularity and are persisted once',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cima-new-source-'));let published=0,calls=0;
 try{
  const movie={id:1236045,title:'Animals',release_date:'2026-10-01',genre_ids:[18],vote_count:0};
  const sync=createQfilmDiscovery({directory:pathToFileURL(folder+'/'),now:()=>Date.parse('2026-10-10'),onMovie:async m=>{assert.equal(m.id,movie.id);published++;},loadMovie:async()=>({results:[movie]}),fetcher:async url=>{
   calls++;return {ok:true,text:async()=>url.includes('download.php')?'<title>مشاهدة فيلم Animals 2026 مترجم</title><a class="download-btn" href="https://host.example/d/one">تحميل</a>':url.includes('play.php')?'var servers = '+JSON.stringify(['<iframe src="https://host.example/embed/one"></iframe>'])+';':url.includes('watch.php')?'<title>مشاهدة فيلم Animals 2026 مترجم</title>':'<a href="watch.php?vid=abc" title="مشاهدة فيلم Animals 2026 مترجم"></a>'};
  }});
  await sync.tick();const state=await sync.snapshot();assert.equal(state.entries.abc.tmdbId,1236045);assert.equal(state.jobs.abc.status,'available');assert.equal(published,1);
  const before=calls;await sync.tick();assert.equal(calls,before);assert.equal(published,1);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('ambiguous title/year matches are kept for review instead of attaching another film',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cima-new-review-'));
 try{
  const movie={id:1,title:'Same',release_date:'2026-01-01'};
  const sync=createQfilmDiscovery({directory:pathToFileURL(folder+'/'),loadMovie:async()=>({results:[movie,{...movie,id:2}]}),fetcher:async url=>({ok:true,text:async()=>url.includes('download.php')?'<title>مشاهدة فيلم Same 2026 مترجم</title><a class="download-btn" href="https://host.example/d/one">Download</a>':url.includes('play.php')?'var servers = [];':'<a href="watch.php?vid=abc"></a>'})});
  await sync.tick();const state=await sync.snapshot();assert.equal(state.jobs.abc.status,'review');assert.equal(state.entries.abc,undefined);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('a reviewed source match resolves an ambiguous title and rechecks its identity',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cima-reviewed-source-'));
 try{
  await writeFile(join(folder,'qfilm-match-overrides.json'),JSON.stringify({abc:{verified:true,tmdbId:1236045,title:'Animals',year:'2026',evidence:'Source plot matches the kidnapping of the mayoral candidate’s son.'}}));
  await writeFile(join(folder,'qfilm-new-import.json'),JSON.stringify({entries:{},jobs:{abc:{status:'review',nextAttempt:Date.now()+86400000}},nextDiscovery:Date.now()+86400000}));
  const sync=createQfilmDiscovery({directory:pathToFileURL(folder+'/'),loadMovie:async endpoint=>{assert.equal(endpoint,'movie/1236045');return {id:1236045,title:'Animals',release_date:'2026-10-09',genres:[{id:18}]};},fetcher:async url=>({ok:true,text:async()=>url.includes('download.php')?'<title>مشاهدة فيلم Animals 2026 مترجم</title><a class="download-btn" href="https://host.example/d/one">Download</a>':'var servers = [];'} )});
  await sync.tick();const state=await sync.snapshot();assert.equal(state.jobs.abc.status,'available');assert.equal(state.entries.abc.tmdbId,1236045);assert.match(state.entries.abc.matchEvidence,/kidnapping/);
  // A changed source title must not silently inherit the reviewed identity.
  await writeFile(join(folder,'qfilm-new-import.json'),JSON.stringify({entries:{},jobs:{abc:{status:'queued',nextAttempt:0}},nextDiscovery:Date.now()+86400000}));
  const changed=createQfilmDiscovery({directory:pathToFileURL(folder+'/'),loadMovie:async endpoint=>{assert.equal(endpoint,'search/movie');return {results:[]};},fetcher:async url=>({ok:true,text:async()=>url.includes('download.php')?'<title>مشاهدة فيلم Other 2026 مترجم</title><a class="download-btn" href="https://host.example/d/one">Download</a>':'var servers = [];'} )});
  await changed.tick();assert.equal((await changed.snapshot()).jobs.abc.status,'review');
 }finally{await rm(folder,{recursive:true,force:true});}
});
