import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleParts,validatePartData,applySeriesParts,applySeasonParts,applyEpisodePart} from '../admin-parts.js';

function fixture(){
 const item={key:'tv:7',kind:'tv',provider_id:7,snapshot:{name:'Series',seasons:[]}},rows=[];
 const provider={name:'Series',seasons:[{id:11,season_number:1,name:'Season 1',episode_count:2}]};
 const season={id:11,season_number:1,name:'Season 1',episodes:[{id:111,episode_number:1,name:'Original episode',overview:'Provider story',air_date:'2026-10-01'},{id:112,episode_number:2,name:'Second episode'}]};
 const queryFn=async(sql,params=[])=>{
  if(sql.startsWith('SELECT * FROM content_items'))return {rows:params[0]===item.key?[item]:[]};
  if(sql.startsWith('SELECT season_number'))return {rows:rows.filter(row=>row.content_key===params[0]&&(params[1]===undefined||row.season_number===params[1]))};
  if(sql.startsWith('INSERT INTO content_parts')){
   let row=rows.find(value=>value.content_key===params[0]&&value.season_number===params[1]&&value.episode_number===params[2]);
   if(row&&!sql.includes('ON CONFLICT'))throw Object.assign(new Error('duplicate'),{code:'23505'});
   if(!row){row={content_key:params[0],season_number:params[1],episode_number:params[2],data:{},updated_at:'2026-10-15'};rows.push(row);}
   row.data={...row.data,...JSON.parse(params[3])};return {rows:[row]};
  }
  throw new Error('Unexpected query');
 };
 const loadTMDB=async endpoint=>endpoint==='tv/7'?provider:endpoint==='tv/7/season/1'?season:{};
 const run=(method,path='',body,extra={})=>handleParts({req:{method},url:new URL('http://admin.test/api/admin/content/tv:7/parts'+path),body,queryFn,loadTMDB,...extra});
 return {item,rows,queryFn,loadTMDB,provider,season,run};
}

test('part validation checks calendar dates, publication status, image paths and bounded numbers',()=>{
 assert.deepEqual(validatePartData({name:' New episode ',air_date:'2024-02-29',runtime:40},{creating:true}),{name:'New episode',air_date:'2024-02-29',runtime:40,status:'published'});
 for(const body of [{air_date:'2026-02-30'},{air_date:'15-10-2026'},{poster_path:'javascript:alert(1)'},{status:'arbitrary'},{episode_count:10001},{noindex:'true'},{name:''}])assert.throws(()=>validatePartData(body),{status:400});
 assert.throws(()=>validatePartData({air_date:'2026-02-30'}),{status:400,message:'Air date is invalid.'});
 assert.deepEqual(validatePartData(JSON.parse('{"name":"Safe","constructor":"ignored","injected":"ignored"}')),{name:'Safe'});
});
test('administrator lists provider seasons and selected-season episodes with consistent identities',async()=>{
 const {run}=fixture();const list=await run('GET');assert.equal(list.data.items.length,1);assert.equal(list.data.items[0].episode_number,0);
 const episodes=await run('GET','?season=1');assert.deepEqual(episodes.data.items.map(item=>item.episode_number),[0,1,2]);assert.equal(episodes.data.items[1].data.name,'Original episode');
});
test('manual seasons and episodes become public without requiring corresponding provider records',async()=>{
 const {run,queryFn,provider}=fixture();await run('POST','',{season_number:2,episode_number:0,name:'Manual season'});
 await run('POST','',{season_number:2,episode_number:1,name:'Manual episode',air_date:'2026-10-15'});
 const work=await applySeriesParts(provider,'tv:7',{queryFn,enabled:true});assert.deepEqual(work.seasons.map(row=>row.season_number),[1,2]);assert.equal(work.seasons[1].name,'Manual season');
 const season=await applySeasonParts({episodes:[]},'tv:7',2,{queryFn,enabled:true});assert.equal(season.name,'Manual season');assert.equal(season.episodes[0].name,'Manual episode');assert.equal(season.episodes[0].episode_number,1);assert.equal('status'in season.episodes[0],false);
});
test('existing provider episodes can be overridden without losing their story and hidden parts are excluded publicly',async()=>{
 const {run,queryFn,season}=fixture();await run('PATCH','/1/1',{name:'Edited name'});
 let merged=await applySeasonParts(season,'tv:7',1,{queryFn,enabled:true});assert.equal(merged.episodes[0].name,'Edited name');assert.equal(merged.episodes[0].overview,'Provider story');
 await run('PATCH','/1/1',{status:'hidden'});merged=await applySeasonParts(season,'tv:7',1,{queryFn,enabled:true});assert.deepEqual(merged.episodes.map(row=>row.episode_number),[2]);
 await assert.rejects(applyEpisodePart(season.episodes[0],'tv:7',1,1,{queryFn,enabled:true}),{status:404});
});
test('draft seasons hide their own route and all their episode routes',async()=>{
 const {run,queryFn,provider,season}=fixture();await run('PATCH','/1/0',{status:'draft'});
 assert.equal((await applySeriesParts(provider,'tv:7',{queryFn,enabled:true})).seasons.length,0);
 await assert.rejects(applySeasonParts(season,'tv:7',1,{queryFn,enabled:true}),{status:404});
 await assert.rejects(applyEpisodePart({},'tv:7',1,1,{queryFn,enabled:true}),{status:404});
});
test('creation rejects duplicates, orphan episodes, invalid coordinates and attempts to move a part',async()=>{
 const {run}=fixture();
 await assert.rejects(run('POST','',{season_number:1,episode_number:0,name:'Duplicate'}),{status:409});
 await assert.rejects(run('POST','',{season_number:9,episode_number:1,name:'Orphan'}),{status:400,message:'Add the season before adding its episodes.'});
 await assert.rejects(run('POST','',{season_number:-1,episode_number:0,name:'Invalid'}),{status:400});
 await assert.rejects(run('POST','',{season_number:0,episode_number:0,name:'Invalid'}),{status:400});
 await assert.rejects(run('POST','',{season_number:'',episode_number:0,name:'Invalid'}),{status:400});
 await assert.rejects(run('PATCH','/1/1',{season_number:2,name:'Move'}),{status:400});
 await assert.rejects(run('PATCH','/99/9',{name:'Missing'}),{status:404});
});
test('manual parts remain editable when the external provider is unavailable',async()=>{
 const {run}=fixture();await run('POST','',{season_number:2,episode_number:0,name:'Manual'});
 const loadTMDB=async()=>{throw new Error('Offline');};
 const list=await run('GET','?season=2',undefined,{loadTMDB});assert.equal(list.data.providerUnavailable,true);assert.equal(list.data.items[0].data.name,'Manual');
 assert.equal((await run('PATCH','/2/0',{name:'Updated offline'},{loadTMDB})).data.item.data.name,'Updated offline');
});
test('parts leave existing rendering untouched when database storage is disabled',async()=>{
 const data={name:'Existing',seasons:[]},queryFn=async()=>{throw new Error('Must not query');};
 assert.equal(await applySeriesParts(data,'tv:7',{queryFn,enabled:false}),data);assert.equal(await applySeasonParts(data,'tv:7',1,{queryFn,enabled:false}),data);assert.equal(await applyEpisodePart(data,'tv:7',1,1,{queryFn,enabled:false}),data);
});
