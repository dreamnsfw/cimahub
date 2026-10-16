import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseAdultCategory,matchCategoryMovie,createAdultCategory} from '../qfilm-category.js';

const row=(id,name,year,duration='1:40:00')=>`<li><span class="pm-label-duration">${duration}</span><a href="watch.php?vid=${id}" title="مشاهدة فيلم ${name} ${year} مترجم HD اون لاين"></a></li>`;
test('source membership comes only from the category grid, excluding featured strips and other categories',()=>{
 const html=`<a href="watch.php?vid=unrelated" title="مشاهدة فيلم Unrelated 2025"></a><ul id="pm-grid">${row('selected','Selected',2025)}</ul><a href="category.php?cat=adult-movies&amp;page=62">62</a><a href="category.php?cat=foreign-movies&page=500">500</a>`;
 const data=parseAdultCategory(html);assert.equal(data.pages,62);assert.deepEqual(data.entries.map(r=>r.vid),['selected']);assert.equal(data.entries[0].sourceRuntime,100);
 assert.throws(()=>parseAdultCategory('<h1>Challenge</h1>'),/grid/);
 const numeric=parseAdultCategory(`<ul id="pm-grid">${row('blade','Blade Runner 2049',2017)}${row('class','Class of 1984',1982)}</ul>`);
 assert.equal(numeric.entries[0].title,'Blade Runner 2049');assert.equal(numeric.entries[0].year,'2017');
 assert.equal(numeric.entries[1].title,'Class of 1984');assert.equal(numeric.entries[1].year,'1982');
});
test('same-name films need runtime evidence to distinguish a feature from a short',()=>{
 const record={title:'Selected',year:'2025',sourceRuntime:100};
 const candidates=[{id:1,title:'Selected',release_date:'2025-01-01',runtime:100},{id:2,title:'Selected',release_date:'2025-01-01',runtime:10}];
 assert.equal(matchCategoryMovie(record,candidates).id,1);
 assert.equal(matchCategoryMovie({...record,sourceRuntime:undefined},candidates),null);
});
test('curated pagination keeps source order, ignores general age ratings and retains the saved list on refresh failure',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cima-category-')),directory=pathToFileURL(folder+'/');
 try{
  await writeFile(join(folder,'qfilm-import.json'),JSON.stringify({entries:{a:{status:'matched',title:'First',year:'2025',tmdbId:11},b:{status:'matched',title:'Second',year:'2024',tmdbId:12}}}));
  let fail=false;
  const category=createAdultCategory({directory,fetcher:async()=>({ok:true,text:async()=>fail?'<h1>Unavailable</h1>':`<ul id="pm-grid">${row('a','First',2025)}${row('b','Second',2024)}</ul>`}),loadMovie:async endpoint=>({id:Number(endpoint.split('/')[1]),title:'Movie',release_date:'2025-01-01',adult:false})});
  await category.refresh();
  const listing=await category.listing(1);assert.deepEqual(listing.results.map(m=>m.id),[11,12]);assert.ok(listing.results.every(m=>m.source_adult_category));
  assert.equal(await category.contains(11),true);assert.equal(await category.contains(13),false);
  await writeFile(join(folder,'qfilm-import.json'),JSON.stringify({entries:{a:{status:'review',title:'First',year:'2025'}}}));
  await category.refresh();assert.deepEqual((await category.listing(1)).results.map(m=>m.id),[11,12]);
  assert.deepEqual((await category.listing(1,'2024')).results.map(m=>m.id),[12]);
  await assert.rejects(category.listing(2),error=>error.status===404);
  fail=true;await assert.rejects(category.refresh(),/grid/);assert.equal((await category.snapshot()).entries.length,2);
 }finally{await unlink(join(folder,'qfilm-import.json'));await unlink(join(folder,'qfilm-adult-category.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(folder);}
});
