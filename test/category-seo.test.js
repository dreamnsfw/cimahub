import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCategoryListing,categoryContent,categoryMetadata,categoryItems,categoryPaths} from '../category-seo.js';
import {renderSeoPage} from '../movie-seo.js';

const listing=path=>parseCategoryListing(new URL('https://cimahub.net'+path));
test('anime excludes unsupported TV intersections while keeping general TV categories',()=>{
  for(const slug of ['soap','news']){
    assert.equal(listing(`/anime/series/genre/${slug}/`),null);
    assert.ok(listing(`/series-genre/${slug}/`));
  }
  assert.equal(listing('/anime/series/?genre=10766'),null);
  const drama=listing('/anime/series/genre/drama/');
  assert.equal(drama.params.get('with_genres'),'16,18');
  const html=categoryContent(drama,[],1);
  assert.match(html,/دراما — كل النتائج/);
  assert.doesNotMatch(html,/\/anime\/series\/genre\/(soap|news)\//);
  assert.equal(categoryMetadata(drama,[{id:1,name:'Anime',genre_ids:[16,18]}],'https://example.test').noindex,false);
});
test('anime movie and series categories keep animation constraints when filtering',()=>{
  const movies=listing('/anime/movies/?genre=28&year=2025&page=2');
  assert.equal(movies.type,'movie');
  assert.equal(movies.params.get('with_genres'),'16,28');
  assert.equal(movies.params.get('primary_release_year'),'2025');
  assert.equal(movies.params.has('without_genres'),false);
  assert.equal(movies.noindex,true);
  const shows=listing('/anime/series/');
  assert.equal(shows.type,'tv');
  assert.equal(shows.params.get('with_genres'),'16');
  assert.equal(shows.noindex,false);
  assert.equal(listing('/series-category/arabic-series/').params.get('with_original_language'),'ar');
});
test('category canonical URLs normalize defaults and preserve paginated URLs',()=>{
  assert.equal(listing('/anime/movies/?page=1&sort=popularity.desc&year=&utm_source=test').canonicalPath,'/anime/movies/');
  assert.equal(listing('/anime/movies/?page=2').canonicalPath,'/anime/movies/?page=2');
  assert.equal(listing('/anime/movies/?page=2').noindex,false);
  for(const path of ['/anime/movies/?page=501','/anime/movies/?page=1.5','/anime/movies/?genre=10765','/anime/series/?sort=primary_release_date.desc','/anime/series/?region=invalid','/series-category/arabic-series/?region=foreign','/anime/invalid/'])assert.equal(listing(path),null,path);
  for(const path of categoryPaths)assert.ok(listing(path),path);
});
test('category HTML includes content, a single H1, metadata, breadcrumbs and crawlable page links without JS',async()=>{
  const route=listing('/anime/movies/?page=2');
  const items=categoryItems({results:[{id:1,title:'Batman',display_title:'مشاهدة فيلم Batman 2026 مترجم',genre_ids:[16],poster_path:'/poster.jpg'},{id:1,genre_ids:[16]},{id:2,title:'Drama',genre_ids:[18]}]},route);
  assert.equal(items.length,1);
  const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const metadata=categoryMetadata(route,items,'https://cimahub.net');
  const html=renderSeoPage(template,metadata,categoryContent(route,items,4),items);
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.match(html,/<h1>أفلام أنمي<\/h1>/);
  assert.match(metadata.title,/الصفحة 2/);
  assert.match(html,/مشاهدة فيلم Batman/);
  assert.match(html,/rel="canonical" href="https:\/\/cimahub.net\/anime\/movies\/\?page=2"/);
  assert.match(html,/href="\/anime\/movies\/\?page=3"/);
  assert.match(html,/"@type":"BreadcrumbList"/);
  assert.match(html,/"@type":"CollectionPage"/);
  assert.match(html,/name="robots" content="index, follow/);
  assert.equal(categoryMetadata(route,[],'https://cimahub.net').noindex,true);
});
