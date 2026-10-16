import {test} from 'node:test';
import assert from 'node:assert/strict';
import {movieGenres,movieTopicSections,comingSoonMovieCategory,movieComingSoonWindow,isFutureMovie,movieDisplayTitle,parseMovieListing,listingContent,movieContent,movieDescription,movieMetadata,renderSeoPage} from '../movie-seo.js';
import {catalogCard,collectionPage} from '../site-seo.js';
import {parseCategoryListing,categoryContent} from '../category-seo.js';

const listing=(path,now)=>parseMovieListing(new URL('https://example.test'+path),now);
const released={id:701,title:'Example Film',display_title:'مشاهدة فيلم Example Film 2001 مترجم',original_language:'en',release_date:'2001-10-05',overview:'قصة الفيلم وأبطاله.',genres:[{id:18,name:'دراما'}],genre_ids:[18],movie_presentation_version:1,public_path:'/example-film/',vote_count:0,vote_average:0};
const future={...released,release_date:'2099-10-05',display_title:'مشاهدة فيلم Example Film 2099 مترجم'};

test('biography is a keyword collection with genuine genre filters and stable canonical paths',()=>{
  assert.equal(movieTopicSections.biography.keyword,5565);
  assert.equal(Object.values(movieGenres).some(([id])=>id===5565),false);
  const base=listing('/movies/genre/biography/');
  assert.equal(base.topic,'biography');assert.equal(base.comingSoon,false);
  assert.equal(base.params.get('with_keywords'),'5565');assert.equal(base.params.get('with_genres'),null);
  assert.equal(base.canonicalPath,movieTopicSections.biography.path);assert.equal(base.noindex,false);
  const filtered=listing('/movies/genre/biography/?genre=18&year=2026&page=2');
  assert.equal(filtered.params.get('with_keywords'),'5565');assert.equal(filtered.params.get('with_genres'),'18');
  assert.equal(filtered.params.get('primary_release_year'),'2026');assert.equal(filtered.page,2);assert.equal(filtered.noindex,true);
  assert.equal(filtered.canonicalPath,'/movies/genre/biography/?genre=18&year=2026&page=2');
  assert.equal(listing('/movies/genre/biography/?genre=5565'),null);
  assert.equal(listing('/movies/genre/biography/?genre=').canonicalPath,movieTopicSections.biography.path);
  assert.equal(listing('/movies/genre/horror/?genre=53').params.get('with_genres'),'27,53');
});

test('upcoming uses a UTC tomorrow-through-180-days window without minimum votes',()=>{
  const now=new Date('2026-12-31T23:30:00Z');
  assert.deepEqual(movieComingSoonWindow(now),{start:'2027-01-01',end:'2027-06-29'});
  const upcoming=listing(comingSoonMovieCategory.path,now);
  assert.equal(upcoming.comingSoon,true);assert.equal(upcoming.topic,undefined);
  assert.equal(upcoming.params.get('primary_release_date.gte'),'2027-01-01');
  assert.equal(upcoming.params.get('primary_release_date.lte'),'2027-06-29');
  assert.equal(upcoming.params.get('sort_by'),'primary_release_date.asc');
  assert.equal(upcoming.params.get('vote_count.gte'),null);
  assert.equal(upcoming.params.get('include_adult'),'false');assert.equal(upcoming.params.get('without_genres'),'16');
  assert.equal(upcoming.canonicalPath,comingSoonMovieCategory.path);assert.equal(upcoming.noindex,false);
  assert.equal(listing('/movies/coming-soon/?sort=vote_average.desc',now),null);
  const popular=listing('/movies/coming-soon/?genre=80&sort=popularity.desc',now);
  assert.equal(popular.params.get('with_genres'),'80');assert.equal(popular.params.get('vote_count.gte'),null);
  assert.equal(popular.params.get('primary_release_date.gte'),'2027-01-01');assert.equal(popular.noindex,true);
});

test('regional filters preserve biography membership and the upcoming date window',()=>{
  for(const path of ['/movies/genre/biography/','/movies/coming-soon/']){
    const base=listing(path),regional=listing(path+'?region=foreign&genre=18');
    assert.equal(regional.params.get('with_original_language'),'en');assert.equal(regional.params.get('with_genres'),'18');
    assert.equal(regional.params.get('with_keywords'),base.params.get('with_keywords'));
    assert.equal(regional.params.get('primary_release_date.gte'),base.params.get('primary_release_date.gte'));
    assert.equal(regional.params.get('primary_release_date.lte'),base.params.get('primary_release_date.lte'));
    assert.equal(regional.canonicalPath,path+'?genre=18&region=foreign');assert.equal(regional.noindex,true);
    assert.equal(listing(path+'?region=').canonicalPath,path);
    assert.equal(listing(path+'?region=unknown'),null);
  }
});

test('existing year and standard listing policies remain intact',()=>{
  const year=new Date().getFullYear();
  const current=listing('/movies/year/'+year+'/');
  assert.equal(current.params.get('primary_release_year'),String(year));assert.equal(current.params.get('vote_count.gte'),'10');
  assert.equal(current.params.get('sort_by'),'popularity.desc');assert.equal(current.noindex,false);
  assert.ok(listing('/movies/year/'+(year+1)+'/'));
  assert.equal(listing('/movies/year/'+(year+2)+'/'),null);
  assert.equal(listing('/movies/genre/horror/?sort=vote_average.desc').params.get('vote_count.gte'),'200');
});

test('topic navigation never inserts a keyword ID into the genre selector',()=>{
  const html=listingContent(listing('/movies/genre/biography/'),{results:[released],total_pages:1});
  assert.match(html,/href="\/movies\/genre\/biography\/">أفلام سيرة ذاتية/);
  assert.match(html,/href="\/movies\/coming-soon\/">يعرض قريبًا/);
  const genreSelect=html.match(/<select name="genre"[\s\S]*?<\/select>/)[0];
  assert.doesNotMatch(genreSelect,/5565/);assert.match(genreSelect,/value="18"/);
  assert.match(html,/name="region"/);
  const empty=listingContent(listing('/movies/genre/biography/'),{results:[],total_pages:1});
  assert.match(empty,/href="\/movies\/genre\/biography\/">مسح الفلاتر/);
  assert.doesNotMatch(empty,/\$\{listing.path\}/);
});

test('upcoming cards keep ordinary titles with only a poster badge and no zero ratings',()=>{
  const upcoming=listing('/movies/coming-soon/'),date=upcoming.params.get('primary_release_date.gte');
  const html=listingContent(upcoming,{results:[{...future,release_date:date}, {...released,id:702,title:'Past Film'}, {...released,id:703,title:'Unknown Date',release_date:''}, {...future,id:704,title:'Invalid Date',release_date:'2099-02-30'}, {...future,id:705,title:'Outside Window'}],total_pages:1});
  assert.equal((html.match(/<article\b/g)||[]).length,1);
  assert.match(html,/href="\/example-film\/"/);
  const article=html.match(/<article\b[\s\S]*?<\/article>/)[0];
  assert.match(article,/<span class="poster-upcoming">قريبًا<\/span>/);
  assert.match(article,/<h3><a href="\/example-film\/" dir="rtl">مشاهدة فيلم <bdi dir="ltr">Example Film<\/bdi> 2099 مترجم<\/a><\/h3>/);
  assert.doesNotMatch(article,/★|0\.0| — يعرض قريبًا|موعد الإصدار|card-info|datetime=|تحميل|HD/);
  assert.doesNotMatch(html,/Past Film|Unknown Date|Invalid Date|Outside Window/);
  const years=html.match(/<select name="year"[\s\S]*?<\/select>/)[0];
  for(const value of [upcoming.params.get('primary_release_date.gte').slice(0,4),upcoming.params.get('primary_release_date.lte').slice(0,4)])assert.ok(years.includes('value="'+value+'"'));
});

test('only complete valid future dates classify a film as forthcoming',()=>{
  const now=new Date('2026-10-13T00:30:00Z');
  for(const release_date of ['',undefined,'2099','2099-02-30','2099-13-01','2026-10-13','2001-10-05'])assert.equal(isFutureMovie({release_date},now),false);
  assert.equal(isFutureMovie({release_date:'2026-10-14'},now),true);
});

test('future details keep ordinary identity and classification while availability checks remain safe',()=>{
  const preview={...future,poster_path:'/example.jpg',externalSources:[{quality:'HD',playback:[{url:'javascript:alert(1)'}]}]};
  const metadata=movieMetadata(preview,'https://example.test'),html=movieContent(preview);
  assert.equal(metadata.canonical,'https://example.test/example-film/');
  assert.equal(metadata.title,future.display_title+' | سيما هَب');
  assert.doesNotMatch(metadata.title,/قريبًا|موعد الإصدار|HD|الإعلان التشويقي/);
  assert.doesNotMatch(movieDescription(preview),/مشاهدة|تحميل|مترجم|HD|الإعلان التشويقي/);
  assert.match(html,/<h1>مشاهدة فيلم Example Film 2099 مترجم<\/h1>/);
  assert.match(html,/<div class="movie-cover-wrap"><img class="movie-cover"[^>]+><span class="poster-upcoming">قريبًا<\/span><\/div>/);
  assert.match(html,/datetime="2099-10-05"/);assert.match(html,/href="\/movies\/foreign\/">أفلام أجنبية/);
  assert.doesNotMatch(html,/upcoming-release-note|قد يتغير|يعرض قريبًا|أفلام تعرض قريبًا|\/movies\/coming-soon\//);
  assert.doesNotMatch(movieDescription(preview),/قريبًا/);
  assert.doesNotMatch(html,/★ 0\.0|data-trailer=|movie-watch|سيرفرات التحميل|جودة الفيلم/);
  assert.doesNotMatch(JSON.stringify(metadata.schema),/WatchAction/);
  const withTrailer={...preview,videos:{results:[{site:'YouTube',type:'Trailer',key:'abcdefghijk'}]}};
  assert.match(movieContent(withTrailer),/data-trailer="movie-701"/);
  assert.equal(movieMetadata(withTrailer,'https://example.test').title,metadata.title);
  assert.doesNotMatch(movieContent({...preview,poster_path:null}),/poster-upcoming|movie-cover-wrap/);
});

test('future movies use the same category priority as released biography and adult films',()=>{
  for(const flags of [{is_biography:true},{source_adult_category:true}]){
    assert.deepEqual(movieMetadata({...future,...flags},'https://example.test').schema['@graph'][1].itemListElement,movieMetadata({...released,...flags},'https://example.test').schema['@graph'][1].itemListElement);
  }
});

test('old derived titles are normalized in cards, metadata and hydration without changing collection labels',()=>{
  const stale={...future,media_type:'movie',display_title:'فيلم Example Film 2099 — يعرض قريبًا'};
  assert.equal(movieDisplayTitle(stale),future.display_title);
  const generic=catalogCard(stale);
  assert.match(generic,/<span class="poster-upcoming">قريبًا<\/span>/);assert.doesNotMatch(generic,/يعرض قريبًا/);
  assert.equal(collectionPage('/search/',{results:[stale]},'https://example.test').metadata.schema.mainEntity.itemListElement[0].name,future.display_title);
  const template='<html><head><title>Site</title></head><body><main id="main" tabindex="-1"></main></body></html>';
  const hydrated=renderSeoPage(template,movieMetadata(stale,'https://example.test'),'', [stale]);
  const data=JSON.parse(hydrated.match(/id="movie-page-data">([^<]+)<\/script>/)[1]);
  assert.equal(data[0].display_title,future.display_title);assert.equal(data[0].original_language,'en');
  const arabic={...stale,original_language:'ar'};
  assert.equal(movieDisplayTitle(arabic),'مشاهدة فيلم Example Film 2099');
  assert.equal(listing('/movies/coming-soon/').name,comingSoonMovieCategory.name);
});

test('poster badges cover recommendations and anime cards while missing or invalid dates stay unbadged',()=>{
  const related=movieContent({...released,recommendations:{results:[future]}}).match(/<article\b[\s\S]*?<\/article>/)[0];
  assert.match(related,/poster-upcoming/);assert.doesNotMatch(related,/يعرض قريبًا/);
  const animeMovie={...future,genres:[{id:16,name:'أنمي'}],genre_ids:[16],media_type:'movie'};
  const animeListing=parseCategoryListing(new URL('https://example.test/anime/movies/'));
  assert.match(categoryContent(animeListing,[animeMovie],1),/poster-upcoming/);
  for(const release_date of ['',undefined,'2099-02-30','2001-10-05'])assert.doesNotMatch(catalogCard({...future,release_date}),/poster-upcoming/);
});

test('released films and future films with safe playback preserve existing viewing behavior',()=>{
  const playable={...future,externalSources:[{playback:[{url:'https://host.example/play'}]}]};
  for(const item of [released,playable]){
    assert.match(movieDisplayTitle(item),/^مشاهدة فيلم/);
    assert.match(movieDescription(item),/^مشاهدة وتحميل/);
    assert.match(movieMetadata(item,'https://example.test').title,/مشاهدة فيلم/);
  }
  assert.match(movieContent(playable),/href="#movie-watch"/);
  assert.match(JSON.stringify(movieMetadata(playable,'https://example.test').schema),/WatchAction/);
  assert.doesNotMatch(movieContent({...released,release_date:''}),/يعرض قريبًا/);
});

test('biography detail tags and structured data use the topic flag without inventing a genre ID',()=>{
  const movie={...released,is_biography:true};
  assert.match(movieContent(movie),/href="\/movies\/genre\/biography\/">أفلام سيرة ذاتية/);
  const schema=movieMetadata(movie,'https://example.test').schema['@graph'];
  assert.deepEqual(schema[0].genre,['دراما','سيرة ذاتية']);
  assert.equal(schema[1].itemListElement[1].item,'https://example.test/movies/genre/biography/');
  assert.doesNotMatch(JSON.stringify(schema),/5565/);
});
