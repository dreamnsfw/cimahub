import test from 'node:test';
import assert from 'node:assert/strict';
import {createLatestTV,televisionUpdates} from '../latest-tv.js';
import {presentSeries} from '../series-presentation.js';
import {catalogCard} from '../site-seo.js';

test('today scheduled episodes stay upcoming and enrichment does not mutate provider data',async()=>{
 const today=new Date().toISOString().slice(0,10);
 const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const show={id:1,name:'Show',original_name:'Show',original_language:'en',
  seasons:[{season_number:2,air_date:yesterday,episode_count:3}],
  last_episode_to_air:{season_number:2,episode_number:1,air_date:yesterday},
  next_episode_to_air:{season_number:2,episode_number:3,air_date:today}};
 const before=structuredClone(show);
 const latest=createLatestTV(async endpoint=>{
  if(endpoint==='discover/tv')return {results:[{id:1}]};
  if(endpoint==='tv/1')return show;
  return {episodes:[{episode_number:1,air_date:yesterday},{episode_number:2,air_date:yesterday},{episode_number:3,air_date:today}]};
 });
 const result=await latest();
 assert.deepEqual(result.episodes.map(e=>e.episode_number),[2]);
 assert.deepEqual(show,before);
 assert.equal((await latest()).episodes[0].episode_number,2);
 const scheduled={...show,last_episode_to_air:{season_number:2,episode_number:3,air_date:today}};
 assert.equal(televisionUpdates([scheduled],today,yesterday).episodes.length,0);
});

test('recent episode and season collections exclude stale entries at the period boundary',()=>{
 const shows=[
  {id:1,name:'Stale',last_episode_to_air:{season_number:1,episode_number:4,air_date:'2026-09-13'},seasons:[{season_number:1,air_date:'2026-09-13',episode_count:4}]},
  {id:2,name:'Boundary',last_episode_to_air:{season_number:1,episode_number:1,air_date:'2026-09-14'},seasons:[{season_number:1,air_date:'2026-09-14',episode_count:1}]},
  {id:3,name:'Future',last_episode_to_air:{season_number:1,episode_number:1,air_date:'2026-10-15'},seasons:[{season_number:1,air_date:'2026-10-15',episode_count:1}]}
 ];
 const result=televisionUpdates(shows,'2026-10-14','2026-09-14');
 assert.deepEqual(result.episodes.map(e=>e.id),[2]);
 assert.deepEqual(result.seasons.map(e=>e.id),[2]);
});

test('foreign episode cards show English identity and episode date without the series debut year',async()=>{
 const episode={id:44006,name:'شيكاغو فاير',original_language:'en',first_air_date:'2012-10-10',
  media_type:'tv',season_number:15,episode_number:2,air_date:'2026-10-14',genres:[{id:18}],poster_path:'/poster.jpg'};
 const presented=await presentSeries(episode,'tv/44006',async()=>({name:'Chicago Fire',original_name:'Chicago Fire',original_language:'en'}));
 assert.equal(presented.name,'Chicago Fire');
 const html=catalogCard(presented);
 const heading=html.match(/<h3>[\s\S]*?<\/h3>/)?.[0];
 assert.match(heading,/Chicago Fire/);
 assert.match(heading,/الموسم 15 الحلقة 2/);
 assert.doesNotMatch(heading,/2012|شيكاغو/);
 assert.match(html,/<time>2026-10-14<\/time>/);
 assert.match(catalogCard({...presented,episode_number:undefined}),/Chicago Fire 2012/);
});

test('Arabic series keep their Arabic names when an English localization exists',async()=>{
 const series={id:2,name:'الاختيار',original_name:'الاختيار',original_language:'ar',first_air_date:'2020-04-24',genres:[{id:18}]};
 const presented=await presentSeries(series,'tv/2',async()=>({name:'The Choice',original_name:'الاختيار',original_language:'ar'}));
 assert.equal(presented.name,'الاختيار');
 assert.equal(presented.original_name,'الاختيار');
 assert.doesNotMatch(presented.series_display_title,/مترجم|The Choice/);
});
