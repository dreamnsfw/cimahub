import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,unlink,rmdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSeoCatalog,slugify} from '../seo-catalog.js';
import {seriesPage} from '../detail-seo.js';
import {collectionPage,homePage} from '../site-seo.js';
import {videoMetadata} from '../video-seo.js';
import {hasHD} from '../seo-content.js';
import {movieMetadata,movieContent,renderSeoPage} from '../movie-seo.js';

test('named URLs and image aliases persist, survive title edits and avoid movie/TV collisions',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cimahub-catalog-')),url=pathToFileURL(directory+'/');
 try{
  const catalog=createSeoCatalog(url),base={id:1,title:'Same Title',release_date:'2025-01-01',poster_path:'/hash.jpg',overview:'Story'};
  const movie=await catalog.decorate(base),tv=await catalog.decorate({...base,id:2,media_type:'tv'});
  assert.equal(movie.public_path,'/same-title-2025/');assert.equal(tv.public_path,'/same-title-2025-series/');
  assert.equal(movie.poster_path,'/same-title-2025-poster.jpg');assert.equal(await catalog.imageSource('same-title-2025-poster.jpg'),'/hash.jpg');
  const changed=await catalog.decorate({...base,title:'Renamed',poster_path:'/new.jpg'});assert.equal(changed.public_path,movie.public_path);assert.match(changed.poster_path,/-poster-2.jpg$/);
  const restarted=createSeoCatalog(url);assert.equal((await restarted.resolve('same-title-2025')).id,1);
  assert.equal(await restarted.imageSource('same-title-2025-poster.jpg'),'/hash.jpg');
  await catalog.mark(movie,{canonical:'https://example.test/same-title-2025/',title:'A',description:'B'});
  const first=(await catalog.pages())[0];await catalog.mark(movie,{canonical:'https://example.test/same-title-2025/',title:'A',description:'B'});assert.equal((await catalog.pages())[0].lastmod,first.lastmod);
  assert.equal(slugify('../ A & فيلم /'),'a-فيلم');
 }finally{await unlink(join(directory,'seo-catalog.json'));await rmdir(directory);}
});
test('legacy non-English slugs migrate to English without preserving old page aliases',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cimahub-migrate-')),url=pathToFileURL(directory+'/');
 try{
  await writeFile(new URL('seo-catalog.json',url),JSON.stringify({works:{'movie:21453':{id:21453,type:'movie',slug:'妖獣都市-1987',name:'妖獣都市'}},images:{'妖獣都市-1987-poster.jpg':{source:'/hash.jpg'}},pages:{'/妖獣都市-1987/':{path:'/妖獣都市-1987/',indexable:true}}}));
  const catalog=createSeoCatalog(url),item=await catalog.decorate({id:21453,title:'妖獣都市',english_title:'Wicked City',release_date:'1987-01-01',poster_path:'/妖獣都市-1987-poster.jpg'});
  assert.equal(item.public_path,'/wicked-city-1987/');assert.equal(item.poster_path,'/wicked-city-1987-poster.jpg');
  assert.equal(await catalog.resolve('妖獣都市-1987'),undefined);
  assert.equal((await catalog.pages())[0].path,'/wicked-city-1987/');
  assert.equal(await catalog.imageSource('妖獣都市-1987-poster.jpg'),'/hash.jpg');
  assert.equal(await createSeoCatalog(url).resolve('妖獣都市-1987'),undefined);
 }finally{await unlink(join(directory,'seo-catalog.json'));await rmdir(directory);}
});
test('TV, seasons and episodes have distinct canonical URLs, stories and structured data',()=>{
 const m={id:1434,name:'Family Guy',original_name:'Family Guy',first_air_date:'1999-01-31',original_language:'en',genres:[{id:16,name:'أنمي'}],public_path:'/family-guy-1999/',overview:'قصة المسلسل',seasons:[{season_number:1}]};
 const series=seriesPage(m,'https://example.test');
 const episode=seriesPage(m,'https://example.test',{season:1,episode:2,seasonData:{episodes:[{episode_number:1},{episode_number:2}]},episodeData:{overview:'قصة الحلقة الثانية',air_date:'1999-02-01'}});
 assert.match(series.metadata.title,/مسلسل أنمي Family Guy 1999/);
 assert.equal(episode.metadata.canonical,'https://example.test/family-guy-1999/season/1/episode/2/');
 assert.equal(episode.metadata.schema['@graph'][0]['@type'],'TVEpisode');
 assert.match(episode.content,/قصة الحلقة الثانية/);assert.doesNotMatch(episode.content,/>قصة المسلسل</);
 assert.match(episode.content,/href="\/family-guy-1999\/season\/1\/episode\/1\/"/);
 assert.doesNotMatch(episode.content,/#\/details/);
});
test('HD requires an actual source of suitable quality, not CAM or a missing stream',()=>{
 assert.equal(hasHD([{quality:'1080p WEB-DL',playback:[{url:'https://player.example/video'}]}]),true);
 for(const source of [{quality:'1080p HDTS',playback:[{}]},{quality:'1080p'},{playback:[{}]}])assert.equal(hasHD([source]),false);
 assert.match(movieMetadata({id:1,title:'Example',externalSources:[{quality:'720p',downloads:[{url:'https://download.example/movie'}]}]},'https://example.test').title,/ HD /);
});
test('video schema requires verified publication metadata and a player present on the page',()=>{
 const item={externalSources:[{playback:[{url:'https://player.example/embed/one'}]}]},page={title:'Movie | سيما هَب',canonical:'https://example.test/movie/'};
 const record={verified:true,uploadDate:'2025-01-01T12:00:00Z',embedUrl:'https://player.example/embed/one',thumbnail:'/uploads/thumbs/w780/movie.jpg',description:'Video description',duration:'PT2H4M'};
 assert.equal(videoMetadata(record,item,page,'https://example.test')['@type'],'VideoObject');
 for(const bad of [{...record,uploadDate:undefined},{...record,verified:false},{...record,embedUrl:'https://player.example/unrelated'},{...record,uploadDate:'2099-01-01T00:00:00Z'}])assert.equal(videoMetadata(bad,item,page,'https://example.test'),null);
 const markup=movieContent({id:1,title:'Example',externalSources:item.externalSources});assert.match(markup,/<iframe src="https:\/\/player.example\/embed\/one"/);
});
test('public pages render titles, text and crawlable links without JavaScript',async()=>{
 const movie={id:1,title:'Example',public_path:'/example-2025/',release_date:'2025-01-01'};
 const page=collectionPage('/top/',{page:2,total_pages:3,results:[movie]},'https://example.test',new URLSearchParams('page=2'));
 assert.equal(page.metadata.canonical,'https://example.test/top/?page=2');assert.match(page.content,/href="\/example-2025\/"/);
 assert.equal(collectionPage('/search/',{results:[movie]},'https://example.test').metadata.noindex,true);
 const home=homePage([{name:'أفلام',path:'/movies/',items:[movie]}],'https://example.test');
 const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const html=renderSeoPage(template,home.metadata,home.content,home.items);
 assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.equal((html.match(/rel="canonical"/g)||[]).length,1);assert.match(html,/twitter:card/);assert.doesNotMatch(html,/href="\/#\//);
});
