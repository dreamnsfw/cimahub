import {test} from 'node:test';
import assert from 'node:assert/strict';
import {movieAudience} from '../movie-certification.js';
import {movieContent,movieMetadata,parseMovieListing,listingContent} from '../movie-seo.js';
import {presentMovie} from '../movie-presentation.js';

const movie={id:1,title:'Example',original_language:'en',genre_ids:[28],movie_presentation_version:1};
const rated=rating=>({release_dates:{results:[{iso_3166_1:'US',release_dates:[{certification:rating}]}]}});
test('mature audience collection uses source ratings, without relabeling R as an official 18 rating',()=>{
 for(const rating of ['R','NC-17']){
  const item={...presentMovie(movie,{title:'Example',...rated(rating)},'movie'),source_adult_category:true};
  assert.equal(item.adult_audience,true);assert.equal(item.age_rating.certification,rating);
  assert.equal(movieMetadata(item,'https://example.test').schema['@graph'][0].contentRating,rating);
  const html=movieContent(item);assert.match(html,/التصنيف العمري/);assert.ok(html.includes(rating));assert.match(html,/href="\/movies\/18-plus\/"/);
 }
 const family=presentMovie(movie,{title:'Example',...rated('PG-13')},'movie');
 assert.equal(family.adult_audience,false);
 assert.doesNotMatch(movieContent(family),/href="\/movies\/18-plus\/"/);
 assert.deepEqual(movieAudience(movie),{});
 assert.equal(movieAudience(movie,{release_dates:{results:[{iso_3166_1:'GB',release_dates:[{certification:'18'}]}]}}).adult_audience,true);
});
test('curated collection includes only source members and preserves source order',()=>{
 const listing=parseMovieListing(new URL('https://example.test/movies/18-plus/?year=2025&page=2'));
 assert.equal(listing.params.get('certification.gte'),null);
 assert.equal(listing.params.get('sort_by'),'source.desc');
 assert.equal(listing.page,2);assert.equal(listing.noindex,true);
 const html=listingContent(listing,{results:[{...movie,title:'Selected',public_path:'/selected/',source_adult_category:true,adult_audience:false},{...movie,id:2,title:'Unselected R Film',public_path:'/unselected/',adult_audience:true},{...movie,id:3,title:'Flagged',public_path:'/flagged/',source_adult_category:true,adult:true}],total_pages:300});
 assert.match(html,/href="\/selected\/"/);assert.doesNotMatch(html,/href="\/(?:unselected|flagged)\/"/);
 assert.doesNotMatch(html,/name="(?:genre|region|sort)"|page=101/);assert.match(html,/href="\/movies\/18-plus\/">مسح الفلاتر/);
 assert.equal(parseMovieListing(new URL('https://example.test/movies/18-plus/?page=101')),null);
});
test('every source member uses the adult category in film details, breadcrumbs and schema',()=>{
 for(const original_language of ['en','ar','fr'])for(const genres of [[{id:28,name:'أكشن'}],[{id:16,name:'أنمي'}]]){
  const selected={...movie,original_language,genres,source_adult_category:true};
  const html=movieContent(selected);
  assert.match(html,/<dt>قسم الفيلم :<\/dt><dd><a href="\/movies\/18-plus\/">أفلام للكبار فقط \+18<\/a><\/dd>/);
  const breadcrumb=html.match(/<nav class="movie-breadcrumb"[\s\S]*?<\/nav>/)[0];
  assert.match(breadcrumb,/href="\/movies\/18-plus\/">أفلام للكبار فقط \+18/);
  assert.doesNotMatch(breadcrumb,/\/movies\/foreign\//);
  const schema=movieMetadata(selected,'https://example.test').schema['@graph'].find(item=>item['@type']==='BreadcrumbList');
  assert.equal(schema.itemListElement[1].item,'https://example.test/movies/18-plus/');
  assert.equal(schema.itemListElement[2].position,3);
 }
 const unselected=movieContent({...movie,genres:[{id:28,name:'أكشن'}],adult_audience:true});
 assert.match(unselected,/<dt>قسم الفيلم :<\/dt><dd><a href="\/movies\/foreign\/">أفلام أجنبية<\/a><\/dd>/);
 assert.doesNotMatch(unselected,/href="\/movies\/18-plus\/"/);
});
