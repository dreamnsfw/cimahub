import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presentMovie,applyMoviePresentation} from '../movie-presentation.js';
import {presentSeries} from '../series-presentation.js';
import {createLatestTV} from '../latest-tv.js';
test('existing posters survive missing localized images and enrichment outages',async()=>{
 const movie={id:1,title:'Movie',original_language:'en',poster_path:'/valid.jpg',genre_ids:[18]};
 assert.equal(presentMovie(movie,{images:{posters:[]}}).poster_path,'/valid.jpg');
 const data=await applyMoviePresentation({results:[movie]},'discover/movie',async()=>{throw new Error('network');});
 assert.equal(data.results[0].poster_path,'/valid.jpg');
});
test('animated films use the anime keyword regardless of original language',async()=>{
 for(const [language,label] of [['en','أنمي'],['ja','أنمي']]){
  const result=await presentSeries({id:2,title:'Batman',original_language:language,genres:[{id:16}],poster_path:'/valid.jpg'},'movie/2',async()=>{throw new Error('network');});
  assert.ok(result.display_title.startsWith(['مشاهدة فيلم',label].filter(Boolean).join(' ')));
  assert.equal(result.poster_path,'/valid.jpg');
 }
});
test('latest episodes are verified against aired season entries, excluding future episodes',async()=>{
 const date=new Date().toISOString().slice(0,10);
 const latest=createLatestTV(async endpoint=>endpoint==='discover/tv'?{results:[{id:1}]}:endpoint==='tv/1'?{id:1,name:'Show',seasons:[{season_number:2,air_date:date,episode_count:60}],last_episode_to_air:{season_number:2,episode_number:41,air_date:date}}:{episodes:[{episode_number:42,air_date:date},{episode_number:43,air_date:'2099-01-01'}]});
 const result=await latest();assert.equal(result.episodes[0].episode_number,42);assert.equal(result.episodes[0].season_number,2);
});

test('anime series keywords cover all languages while Arabic titles omit translated',async()=>{
 const load=async()=>{throw new Error('network');};
 for(const language of ['en','ja','ar']){
  const result=await presentSeries({id:1434,name:'Family Guy',original_name:'Family Guy',first_air_date:'1999-01-31',original_language:language,genres:[{id:16}]},'tv/1434',load);
  assert.equal(result.series_display_title,`مسلسل أنمي Family Guy 1999${language==='ar'?'':' مترجم'} كامل`);
  assert.doesNotMatch(result.series_display_title,/رسوم متحركة/);
 }
 const drama=await presentSeries({id:1,name:'Drama',original_name:'Drama',original_language:'en',genres:[{id:18}]},'tv/1',load);
 assert.doesNotMatch(drama.series_display_title,/أنمي/);
});
