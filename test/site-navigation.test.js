import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {siteNavigationGroups,renderSiteNavigation,renderSectionsMenu,withSiteNavigation} from '../site-navigation.js';
import {parseMovieListing} from '../movie-seo.js';
import {parseCategoryListing} from '../category-seo.js';
import {publicPages} from '../site-seo.js';

const now=new Date('2026-10-13T12:00:00Z');
const entries=groups=>groups.filter(group=>group.sections.length).flatMap(group=>[{path:group.path},...(group.featured||[]),...group.sections.flatMap(section=>section.links)]);

test('the sections menu includes all 127 chosen browsing destinations and no unsupported collection aliases',()=>{
 const groups=siteNavigationGroups(now),paths=new Set(entries(groups).map(item=>item.path));
 assert.equal([...paths].filter(path=>path!=='/').length,127);
 for(const path of paths){
  const url=new URL(path,'https://example.test');
  assert.ok(parseMovieListing(url)||parseCategoryListing(url)||publicPages[url.pathname]||['/','/terms/','/dmca/'].includes(url.pathname),path);
 }
 for(const path of ['/movies/18-plus/','/movies/genre/biography/','/movies/coming-soon/','/series-genre/talk/','/anime/movies/genre/music/','/anime/series/genre/war-politics/'])assert.ok(paths.has(path),path);
 for(const path of ['/search/','/terms/','/dmca/','/top/','/top/?type=tv','/recent/','/episodes/','/seasons/'])assert.ok(!paths.has(path),path);
 assert.ok(!paths.has('/series-genre/animation/'));
 assert.ok(!paths.has('/anime/movies/genre/biography/'));
});

test('release years form a complete descending 50-year archive that updates with the year',()=>{
 const years=siteNavigationGroups(now)[0].sections.find(section=>section.years).links;
 assert.equal(years.length,50);assert.equal(new Set(years.map(item=>item.path)).size,50);
 assert.equal(years[0].path,'/movies/year/2026/');assert.equal(years.at(-1).path,'/movies/year/1977/');
 assert.equal(years[26].path,'/movies/year/2000/');
 const next=siteNavigationGroups(new Date('2027-07-01T12:00:00Z'))[0];
 assert.equal(next.featured[0].path,'/movies/year/2027/');
 assert.equal(next.sections.find(section=>section.years).links.at(-1).path,'/movies/year/1978/');
});

test('the plain sections menu omits rejected extras and defaults only movies to open',()=>{
 const html=renderSectionsMenu(now);
 for(const group of siteNavigationGroups(now).filter(group=>group.sections.length)){
  assert.ok(html.includes(`aria-labelledby="sections-${group.key}"`));
  assert.equal((html.match(new RegExp(`id="sections-${group.key}"`,'g'))||[]).length,1);
 }
 assert.match(html,/aria-label="أفلام أنمي أكشن"/);
 assert.match(html,/aria-label="مسلسلات أنمي أكشن ومغامرة"/);
 const paths=[...html.matchAll(/href="([^"]*)"/g)].map(match=>match[1]);
 assert.equal(paths.length,129);
 assert.ok(paths.includes('/categories/'));
 assert.equal(new Set(paths).size,paths.length);
 assert.equal(paths.filter(path=>path.startsWith('/movies/year/')).length,50);
 assert.doesNotMatch(html,/sections-expand|sections-content|menu-featured|menu-year-browser|<small|<strong>القائمة|روابط الموقع|البحث في الموقع|المزيد|href="\/(?:search|terms|dmca|top|recent|episodes|seasons)\//);
 assert.match(html,/<details class="sections-list sections-years"><summary><span>أفلام حسب السنة<\/span><svg/);
 assert.equal((html.match(/<details\b/g)||[]).length,4);
 assert.equal((html.match(/<details[^>]*\sopen(?:\s|>)/g)||[]).length,1);
 assert.match(html,/<details[^>]*aria-labelledby="sections-movies" data-default-open open>/);
 assert.match(html,/<a class="sections-link sections-current-year" href="\/movies\/year\/2026\/">أفلام 2026<\/a>/);
 assert.equal((html.match(/<button\b/g)||[]).length,2);
 assert.doesNotMatch(html,/href="[^\"]*#\/|with_keywords|5565|role="menu"/);
});

test('existing top dropdowns stay compact and do not contain genre grids or the year archive',()=>{
 const html=renderSiteNavigation(now);
 const panels=[...html.matchAll(/<div class="nav-submenu"[^>]*>([\s\S]*?)<\/div>/g)];
 assert.deepEqual(panels.map(panel=>(panel[1].match(/<a\b/g)||[]).length),[9,5,2,2]);
 assert.doesNotMatch(html,/menu-section|menu-types|menu-year-browser|mega-menu/);
});

test('the shared menu replaces old navigation while preserving search, page content and footer',async()=>{
 const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const updated=withSiteNavigation(template,now);
 assert.equal((updated.match(/id="site-navigation"/g)||[]).length,1);
 assert.equal((updated.match(/id="sections-menu"/g)||[]).length,1);
 assert.equal((updated.match(/id="mobile-menu-backdrop"/g)||[]).length,1);
 assert.match(updated,/id="mobile-menu-toggle" aria-controls="sections-menu"/);
 assert.match(updated,/<form class="header-search" id="search-form"/);
 assert.match(updated,/<main id="main" tabindex="-1"><\/main>/);
 assert.match(updated,/class="footer-links"/);
 assert.match(updated,/href="\/movies\/genre\/biography\/"/);
 assert.match(updated,/href="\/movies\/coming-soon\/"/);
});
