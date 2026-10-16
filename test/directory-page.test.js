import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoriesPage} from '../directory-page.js';
import {siteNavigationGroups} from '../site-navigation.js';
import {parseMovieListing} from '../movie-seo.js';
import {parseCategoryListing} from '../category-seo.js';

const now=new Date('2026-10-13T12:00:00Z'),origin='https://example.test';

test('the directory exposes every movie, TV and anime destination once',()=>{
 const page=categoriesPage(origin,now),items=page.metadata.schema['@graph'][0].mainEntity.itemListElement;
 const expected=new Set(siteNavigationGroups(now).flatMap(group=>[...(group.featured||[]),...group.sections.flatMap(section=>section.links)]).map(item=>origin+item.path));
 assert.equal(items.length,127);assert.equal(new Set(items.map(item=>item.url)).size,127);
 assert.deepEqual(new Set(items.map(item=>item.url)),expected);
 for(const [index,item] of items.entries()){
  assert.equal(item.position,index+1);
  const url=new URL(item.url);assert.ok(parseMovieListing(url,now)||parseCategoryListing(url),item.url);
 }
 const anchors=[...page.content.matchAll(/class="directory-child[^"]*" href="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(anchors.length,127);assert.equal(new Set(anchors).size,127);
 assert.equal((page.content.match(/class="directory-art"/g)||[]).length,127);
 assert.match(page.content,/href="\/movies\/genre\/horror\/"[^>]*><svg[^>]+aria-hidden="true"[^>]+data-art="horror"/);
 assert.match(page.content,/class="directory-link-label">رعب<\/span>/);
 for(const group of ['movies','series','anime'])assert.ok(page.content.includes(`id="directory-${group}"`));
 assert.equal((page.content.match(/<h1\b/g)||[]).length,1);
 assert.match(page.content,/href="\/movies\/18-plus\/"/);
 assert.match(page.content,/href="\/movies\/genre\/biography\/"/);
 assert.match(page.content,/href="\/movies\/coming-soon\/"/);
 assert.doesNotMatch(page.content,/href="\/(?:search|terms|dmca|top|recent)\/"/);
});

test('the directory is indexable with its own canonical, description and consistent schema',()=>{
 const {metadata}=categoriesPage(origin,now);
 assert.equal(metadata.noindex,false);assert.equal(metadata.canonical,origin+'/categories/');
 assert.ok(metadata.description.length>80);
 assert.match(metadata.description,/للأفلام والمسلسلات والأنمي/);
 const [page,breadcrumb]=metadata.schema['@graph'];
 assert.equal(page['@type'],'CollectionPage');assert.equal(page.mainEntity.numberOfItems,127);
 assert.equal(breadcrumb.itemListElement.at(-1).item,metadata.canonical);
});

test('the current year is featured once and older years remain accessible in HTML',()=>{
 const page=categoriesPage(origin,now);
 assert.equal((page.content.match(/href="\/movies\/year\/2026\/"/g)||[]).length,1);
 assert.match(page.content,/<details class="directory-years">/);
 assert.match(page.content,/href="\/movies\/year\/1977\/"/);
 assert.equal((page.content.match(/href="\/movies\/year\/\d{4}\/"/g)||[]).length,50);
 assert.match(categoriesPage(origin,new Date('2027-06-01T12:00:00Z')).content,/href="\/movies\/year\/2027\/"/);
});
