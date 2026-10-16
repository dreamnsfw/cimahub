import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyMoviePresentation, presentMovie, selectMovieImage} from '../movie-presentation.js';

const movie = {id:2034, media_type:'movie', title:'يوم التدريب', original_title:'Training Day', original_language:'en', release_date:'2001-10-05', overview:'القصة بالعربية', genre_ids:[18,80], poster_path:'/arabic.jpg'};
const english = {title:'Training Day', images:{posters:[{iso_639_1:'ar',file_path:'/arabic.jpg',vote_average:10},{iso_639_1:'en',file_path:'/english.jpg',vote_average:5}],backdrops:[{iso_639_1:null,file_path:'/neutral.jpg'}]}};
test('movie title includes English name, release year, and Arabic prefix/suffix; story stays Arabic',()=>{
  const result=presentMovie(movie,english);
  assert.equal(result.display_title,'مشاهدة فيلم Training Day 2001 مترجم');
  assert.equal(result.overview,movie.overview);
  assert.equal(result.poster_path,'/english.jpg');
  assert.equal(result.backdrop_path,'/neutral.jpg');
  assert.equal(movie.title,'يوم التدريب');
});
test('image fallback prefers original-language then neutral, never unrelated translations',()=>{
  const images=[{iso_639_1:'ar',file_path:'/ar.jpg'},{iso_639_1:'ko',file_path:'/ko.jpg'},{iso_639_1:null,file_path:'/neutral.jpg'}];
  assert.equal(selectMovieImage(images,'ko'),'/ko.jpg');
  assert.equal(selectMovieImage(images,'fr'),'/neutral.jpg');
  assert.equal(selectMovieImage(images.slice(0,1),'en'),null);
});
test('mixed search leaves series, anime, cartoons and people unchanged and only fetches movies',async()=>{
  const tv={id:1,media_type:'tv',name:'مسلسل عربي',poster_path:'/tv.jpg'};
  const anime={...movie,id:2,original_language:'ja',genre_ids:[16]};
  const person={id:3,media_type:'person',name:'ممثل'};
  const calls=[];
  const data=await applyMoviePresentation({results:[movie,tv,anime,person]},'search/multi',async(endpoint,params)=>{calls.push(endpoint);assert.equal(params.get('language'),'en-US');return english;});
  assert.deepEqual(calls,['movie/2034']);
  assert.strictEqual(data.results[1],tv);assert.strictEqual(data.results[2],anime);assert.strictEqual(data.results[3],person);
});
test('movie recommendations inherit the rule, TV details and genres do not',async()=>{
  const data=await applyMoviePresentation({...movie,recommendations:{results:[{...movie,id:2}]}},'movie/2034',async()=>english);
  assert.equal(data.recommendations.results[0].display_title,'مشاهدة فيلم Training Day 2001 مترجم');
  const tv={id:1,name:'مسلسل',recommendations:{results:[{id:2,name:'مسلسل آخر'}]}};
  const unchanged=await applyMoviePresentation(tv,'tv/1',()=>assert.fail('TV must not request English metadata'));
  assert.deepEqual(unchanged,tv);
});
test('future movie without release date never gets the current year invented',()=>{
  const result=presentMovie({...movie,release_date:''},english);
  assert.equal(result.display_title,'مشاهدة فيلم Training Day مترجم');
});

test('Arabic films keep their Arabic name without translated suffix',()=>{
 const m={...movie,original_language:'ar',original_title:'الفيل الأزرق',title:'الفيل الأزرق',release_date:'2014-07-28'};
 const result=presentMovie(m,{...english,title:'The Blue Elephant'});
 assert.equal(result.display_title,'مشاهدة فيلم الفيل الأزرق 2014');
 assert.equal(result.title,'الفيل الأزرق');
});

test('untranslated English locale resolves a documented English alternative before naming the page',async()=>{
 const greek='Γιαγκόναν: Οι σκοτεινές μέρες του χαμού';
 const item={id:636865,title:greek,original_title:greek,original_language:'el',release_date:'2007-11-18',genres:[{id:28}],overview:`قصة فيلم ${greek}.`};
 const calls=[];
 const load=async(endpoint,params)=>{calls.push(params.get('append_to_response'));return params.get('append_to_response')==='images,release_dates'?{...item,images:{posters:[]}}:{...item,alternative_titles:{titles:[{iso_3166_1:'GR',title:greek},{iso_3166_1:'GB',title:'Yagonan: The Dark Days of Doom',type:'World-wide (English title)'}]}};};
 const result=await applyMoviePresentation(item,'movie/636865',load);
 assert.deepEqual(calls,['images,release_dates','alternative_titles,translations']);
 assert.equal(result.title,'Yagonan: The Dark Days of Doom');
 assert.equal(result.english_title,result.title);
 assert.equal(result.overview,'قصة فيلم Yagonan: The Dark Days of Doom.');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {pathToFileURL}=await import('node:url');const {createSeoCatalog}=await import('../seo-catalog.js');
 const directory=await mkdtemp(join(tmpdir(),'cimahub-english-title-'));
 try{const catalog=createSeoCatalog(pathToFileURL(directory+'/'));const named=await catalog.decorate(result);assert.equal(named.public_path,'/yagonan-the-dark-days-of-doom-2007/');}finally{await rm(directory,{recursive:true,force:true});}
});

test('numeric film names and invisible formatting marks do not force alternative or numeric ID names',async()=>{
 for(const name of ['1917','2012','7500','Chompoo: Lost\u200b &\u200b Forgotten\u200b']){
  let calls=0;const m={...movie,title:name,original_title:name};
  const result=await applyMoviePresentation(m,'movie/2034',async()=>{assert.equal(++calls,1);return {...english,title:name};});
  assert.equal(result.title,name.replace(/\u200b/g,''));
 }
});

test('a Latin Spanish original resolves its documented English translation before movie presentation',async()=>{
 const item={...movie,id:9001,title:'اليوم الأخير',original_title:'El último día',original_language:'es'};
 const calls=[];
 const result=await applyMoviePresentation(item,'movie/9001',async(endpoint,params)=>{
  calls.push(params.get('append_to_response'));
  return params.get('append_to_response')==='images,release_dates'
   ?{...item,title:item.original_title,images:{posters:[]}}
   :{translations:{translations:[{iso_639_1:'en',data:{title:'The Last Day'}}]},alternative_titles:{titles:[]}};
 });
 assert.deepEqual(calls,['images,release_dates','alternative_titles,translations']);
 assert.equal(result.title,'The Last Day');
 assert.equal(result.english_title,'The Last Day');
 assert.equal(result.display_title,'مشاهدة فيلم The Last Day 2001 مترجم');
});

test('a Latin Portuguese original stays intact when no English translation or alias is documented',async()=>{
 const original='O Último Dia';
 const item={...movie,id:9002,title:'اليوم الأخير',original_title:original,original_language:'pt'};
 const result=await applyMoviePresentation(item,'movie/9002',async(endpoint,params)=>
  params.get('append_to_response')==='images,release_dates'
   ?{...item,title:original,images:{posters:[]}}
   :{translations:{translations:[{iso_639_1:'pt',data:{title:original}}]},alternative_titles:{titles:[{iso_3166_1:'BR',title:original}]}}
 );
 assert.equal(result.title,original);
 assert.equal(result.display_title,'مشاهدة فيلم '+original+' 2001 مترجم');
 assert.equal(item.title,'اليوم الأخير');
});
