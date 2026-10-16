import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLinkSync,searchCandidates} from '../movie-link-sync.js';
const movie={id:42,title:'Example',original_title:'Example',release_date:'2025-01-01',genres:[{id:18}],genre_ids:[18]};
test('search discovery rejects different years, titles, and external links',()=>{
  const html='<a href="watch.php?vid=abc" title="مشاهدة فيلم Example 2025 مترجم"></a><a href="watch.php?vid=old" title="مشاهدة فيلم Example 2024 مترجم"></a><a href="https://evil.example/watch.php?vid=bad" title="مشاهدة فيلم Example 2025 مترجم"></a>';
  assert.deepEqual(searchCandidates(html,movie),['abc']);
});
test('automatic search persists servers, deduplicates jobs, and excludes TV/animation',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'cima-sync-')),directory=pathToFileURL(folder+'/');let calls=0;
  try{
    const fetcher=async url=>{calls++;return {ok:true,text:async()=>url.includes('search.php')?'<a href="watch.php?vid=abc" title="مشاهدة فيلم Example 2025 مترجم"></a>':url.includes('download.php')?'<title>مشاهدة فيلم Example 2025 مترجم</title><a class="download-btn" href="https://host.example/d/abc">Download</a>':'var servers = '+JSON.stringify(['<iframe src="https://host.example/embed/abc"></iframe>'])+';'};};
    const sync=createLinkSync({directory,fetcher,loadMovie:async endpoint=>endpoint==='search/movie'?{results:[movie]}:movie});
    await sync.enqueue([movie,movie,{id:43,media_type:'tv'},{id:44,title:'Animation',genre_ids:[16]}]);
    assert.equal(Object.keys((await sync.snapshot()).jobs).length,1);
    await sync.tick();
    assert.equal((await sync.snapshot()).jobs[42].status,'available');
    const saved=JSON.parse(await readFile(new URL('auto-movie-links/42.json',directory)));
    assert.equal(saved[0].playback[0].url,'https://host.example/embed/abc');
    const previous=calls;await sync.tick();assert.equal(calls,previous);
    const restarted=createLinkSync({directory,fetcher,loadMovie:async()=>movie});assert.equal((await restarted.snapshot()).jobs[42].status,'available');
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('absent links retry after six hours',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'cima-sync-')),directory=pathToFileURL(folder+'/');let time=1000,calls=0;
  try{
    const sync=createLinkSync({directory,now:()=>time,loadMovie:async()=>movie,fetcher:async()=>{calls++;return {ok:true,text:async()=>'<html>No matching film</html>'};}});
    await sync.enqueue([movie]);await sync.tick();assert.equal((await sync.snapshot()).jobs[42].status,'waiting');
    const previous=calls;await sync.tick();assert.equal(calls,previous);
    time+=21600001;await sync.tick();assert.ok(calls>previous);
    await assert.rejects(readFile(new URL('auto-movie-links/42.json',directory)),{code:'ENOENT'});
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('site title and year suffice without reverse TMDB search',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'cima-sync-')),directory=pathToFileURL(folder+'/');
  try{
    const fetcher=async url=>({ok:true,text:async()=>url.includes('search.php')?'<a href="watch.php?vid=abc" title="مشاهدة فيلم Example 2025 مترجم"></a>':url.includes('download.php')?'<title>مشاهدة فيلم Example 2025 مترجم</title><a class="download-btn" href="https://host.example/d/abc">Download</a>':'var servers = [];'});
    const sync=createLinkSync({directory,fetcher,loadMovie:async endpoint=>endpoint==='search/movie'?{results:[movie,{...movie,id:43}]}:movie});
    await sync.enqueue([movie]);await sync.tick();
    assert.equal((await sync.snapshot()).jobs[42].status,'available');
    assert.ok(await readFile(new URL('auto-movie-links/42.json',directory)));
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('automatic sync records title/year evidence without story matching',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cima-sync-')),directory=pathToFileURL(folder+'/');
 const story='جندي سابق شحنة طبية خطيرة عصابة اجرامية طفلة بريئة مطاردات عنيفة';
 try{
  const fetcher=async url=>({ok:true,text:async()=>url.includes('search.php')?'<a href="watch.php?vid=abc" title="مشاهدة فيلم Example 2025 مترجم"></a>':url.includes('download.php')?'<title>مشاهدة فيلم Example 2025 مترجم</title><a class="download-btn" href="https://host.example/d/abc">Download</a>':'<div class="StoryBoxText">'+story+'</div>var servers = [];'});
  const loadMovie=async endpoint=>endpoint==='search/movie'?{results:[movie,{...movie,id:43}]}:{...movie,overview:endpoint==='movie/42'?story:'عداء رياضي بطولة عالمية مدرب منافسة سباق ميدالية'};
  const sync=createLinkSync({directory,fetcher,loadMovie});await sync.enqueue([movie]);await sync.tick();
  assert.equal((await sync.snapshot()).jobs[42].status,'available');
  const saved=JSON.parse(await readFile(new URL('auto-movie-links/42.json',directory)));
  assert.equal(saved[0].matchEvidence,'Exact site movie title and release year');
 }finally{await rm(folder,{recursive:true,force:true});}
});
