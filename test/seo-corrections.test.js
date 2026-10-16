import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualityLabel} from '../seo-content.js';
import {parseMovieListing,movieMetadata,movieContent} from '../movie-seo.js';
import {parseCategoryListing} from '../category-seo.js';
import {seriesPage} from '../detail-seo.js';
import {parseVideoPublication,discoverVideoIds,safeLink} from '../qfilm-import.js';
import {videoSitemapXml} from '../video-seo.js';

test('filters cannot replace a curated scope',()=>{
 const listing=path=>parseMovieListing(new URL('https://example.test'+path));
 assert.equal(listing('/movies/year/2026/?year=2009'),null);
 assert.equal(listing('/movies/genre/action/?genre=80').params.get('with_genres'),'28,80');
 assert.equal(listing('/movies/?page=1&sort=popularity.desc').canonicalPath,'/movies/');
 assert.match(listing('/movies/indian/').params.get('with_original_language'),/te\|ta/);
 assert.equal(parseCategoryListing(new URL('https://example.test/series-category/indian-series/')).params.get('with_original_language'),listing('/movies/indian/').params.get('with_original_language'));
});
test('anime genre landing pages use directory links and intersect genre with animation',()=>{
 for(const [path,type,id] of [['/anime/movies/genre/action/','movie','28'],['/anime/series/genre/action/','tv','10759']]){
  const listing=parseCategoryListing(new URL('https://example.test'+path));
  assert.equal(listing.type,type);assert.equal(listing.params.get('with_genres'),'16,'+id);assert.equal(listing.noindex,false);
  assert.match(listing.description,/أنمي/);assert.match(listing.name,/أكشن/);
  const filtered=parseCategoryListing(new URL('https://example.test'+path+'?genre=18'));
  assert.equal(filtered.params.get('with_genres'),'16,'+id+',18');assert.equal(filtered.noindex,true);
 }
});
test('quality and download claims depend on suitable sources and absence creates no quality placeholder',()=>{
 const movie={id:1,title:'Example',vote_average:9,vote_count:100,overview:'قصة',release_date:'2026-01-01'};
 assert.equal(qualityLabel(movie),'');assert.doesNotMatch(movieContent(movie),/جودة الفيلم|غير محددة/);
 assert.doesNotMatch(JSON.stringify(movieMetadata(movie,'https://example.test').schema),/aggregateRating|WatchAction/);
 const sourced={...movie,externalSources:[{quality:'HD 1080p WEB-DL',playback:[{url:'https://host.example/embed/one'}]}]};
 assert.equal(qualityLabel(sourced),'HD 1080p');
 const meta=movieMetadata(sourced,'https://example.test');assert.equal((meta.description.match(/\bHD\b/g)||[]).length,1);
 assert.equal(meta.schema['@graph'][0].potentialAction.target,'https://example.test/movie/1/#movie-watch');
});
test('episode metadata does not inherit aggregate series votes, and useful seasons are indexable without a synopsis',()=>{
 const m={id:1,name:'Show',original_name:'Show',public_path:'/show-2026/',vote_average:7.4,vote_count:5132,seasons:[{season_number:1}]};
 const season=seriesPage(m,'https://example.test',{season:1,seasonData:{episodes:[{episode_number:1}]}});assert.equal(season.metadata.noindex,false);
 const episode=seriesPage(m,'https://example.test',{season:1,episode:1,seasonData:{episodes:[{episode_number:1}]},episodeData:{name:'Pilot',air_date:'2026-01-01'},player:'<section id="movie-watch"><iframe src="https://host.example/embed/one"></iframe></section>'});
 assert.doesNotMatch(JSON.stringify(episode.metadata.schema),/aggregateRating/);
 assert.equal(episode.metadata.schema['@graph'][0].potentialAction.target,'https://example.test/show-2026/season/1/episode/1/#movie-watch');
 assert.equal(episode.metadata.noindex,false);
});
test('source discovery accepts same-origin watch pages and rejects advertised external IDs and placeholder players',()=>{
 assert.deepEqual(discoverVideoIds('<a href="watch.php?vid=abc"></a><a href="https://evil.example/watch.php?vid=evil"></a><a href="/watch.php?vid=abc&amp;x=1"></a>'),['abc']);
 assert.equal(safeLink('https://wwa.liiivideo.com/embed-IDofTheMovie.html'),null);
});
test('video publication uses source VideoObject dates, validates matching player, and normalizes timezone offsets',()=>{
 const record={title:'Animals',year:'2026',source:'https://a.qfilm.tv/download.php?vid=abc',playback:[{url:'https://host.example/embed/one'}]};
 const html='<title>مشاهدة فيلم Animals 2026 مترجم</title><div itemtype="https://schema.org/VideoObject"><meta itemprop="uploadDate" content="2026-01-01T12:00:00+0300"><meta itemprop="thumbnailUrl" content="https://a.qfilm.tv/uploads/thumbs/abc-1.jpg"><meta itemprop="contentUrl" content="https://host.example/embed/one"><meta itemprop="duration" content="PT1H48M11S"></div>';
 const video=parseVideoPublication(html,record,Date.parse('2026-02-01'));
 assert.equal(video.uploadDate,'2026-01-01T12:00:00+03:00');assert.equal(video.duration,'PT1H48M11S');
 assert.equal(parseVideoPublication(html.replace('2026-01-01','2099-01-01'),record),null);
 assert.equal(parseVideoPublication(html.replace('uploadDate','datePublished'),record),null);
 assert.equal(parseVideoPublication(html,{...record,title:'Another'}),null);
 assert.equal(parseVideoPublication(html,{...record,playback:[{url:'https://host.example/unrelated'}]}),null);
 const xml=videoSitemapXml('https://example.test',[{path:'/animals-2026/',name:'Animals & 2026',record:{...video,description:'قصة الفيلم',thumbnail:'/uploads/video-thumbs/animals-2026-video.jpg'}}]);
 assert.match(xml,/xmlns:video=/);assert.match(xml,/Animals &amp; 2026/);assert.match(xml,/<video:publication_date>2026-01-01T12:00:00\+03:00/);
});
