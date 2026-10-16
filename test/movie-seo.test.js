import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {movieDescription,movieMetadata,parseMovieListing,renderSeoPage,movieContent,listingContent,createMovieIndex,sitemapXml} from '../movie-seo.js';
const movie={id:2034,title:'Training Day',display_title:'مشاهدة فيلم Training Day 2001 مترجم',release_date:'2001-10-05',overview:'قصة فيلم عن يوم في حياة شرطي.',original_language:'en',runtime:122,genres:[{id:80,name:'جريمة'}],credits:{cast:[{name:'Denzel Washington',character:'Alonzo'}],crew:[{job:'Director',name:'Antoine Fuqua'}]}};

test('movie descriptions target title, year, genre and region using available facts',()=>{
  const description=movieDescription(movie);
  assert.match(description,/مشاهدة وتحميل فيلم Training Day 2001 مترجم للعربية/);
  assert.match(description,/جريمة ضمن أفلام أجنبية مترجمة/);
  assert.match(description,/Denzel Washington/);
  assert.doesNotMatch(description,/1080|720|WEB-DL|برابط مباشر|ماي سيما|عرب سيد/);
  const metadata=movieMetadata(movie,'https://cimahub.net');
  assert.match(metadata.description,/^مشاهدة وتحميل فيلم Training Day 2001 مترجم للعربية/);
  assert.ok(metadata.description.length<=160);
  const sparse=movieDescription({title:'Example',original_language:'ar'});
  assert.doesNotMatch(sparse,/undefined|null|مترجم|2026/);
});
test('film HTML contains indexable content, metadata and one H1 without rejected sections',async()=>{
  const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const html=renderSeoPage(template,movieMetadata(movie,'https://cimahub.net'),movieContent(movie),[movie]);
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.match(html,/قصة الفيلم/);assert.match(html,/الوصف والتفاصيل/);
  assert.match(html,/rel="canonical" href="https:\/\/cimahub.net\/movie\/2034\/"/);
  assert.doesNotMatch(html,/أين تشاهد|العنوان الأصلي|غير معتمد|بيانات وصور|JustWatch/);
  assert.match(html,/"@type":"Movie"/);assert.doesNotMatch(html,/"@type":"VideoObject"/);
});
test('pagination self canonical and curated sections stay indexable, arbitrary filters do not',()=>{
  const listing=parseMovieListing(new URL('http://test/movies/foreign/?page=2'));
  assert.equal(listing.canonicalPath,'/movies/foreign/?page=2');assert.equal(listing.noindex,false);
  assert.equal(listing.params.get('without_genres'),'16');
  assert.equal(parseMovieListing(new URL('http://test/movies/?genre=80')).noindex,true);
  for(const path of ['/movies/no-such-section/','/movies/?page=0','/movies/?page=501','/movies/?sort=oops','/movies/genre/animation/','/movies/year/9999/'])assert.equal(parseMovieListing(new URL('http://test'+path)),null);
});
test('metadata and JSON payload cannot inject scripts or replacement patterns',async()=>{
  const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const hostile={...movie,title:'$& </script><script>alert(1)</script>'};
  const html=renderSeoPage(template,movieMetadata(hostile,'https://cimahub.net'),movieContent(hostile),[hostile]);
  assert.doesNotMatch(html,/<script>alert\(1\)/);assert.match(html,/\\u003c\/script>/);assert.match(html,/\$&amp;/);
});
test('publication index persists, excludes TV/animation, and keeps lastmod stable for unchanged content',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cimahub-seo-'));
  try{
    const url=pathToFileURL(directory+'/');const index=createMovieIndex(url);
    await Promise.all([index.remember([movie]),index.remember([{...movie,id:22,media_type:'tv'},{...movie,id:33,genres:[{id:16}]}])]);
    const before=await index.all();assert.deepEqual(Object.keys(before),['2034']);
    await index.remember([movie]);assert.equal((await index.all())[2034].lastmod,before[2034].lastmod);
    assert.deepEqual(await createMovieIndex(url).all(),before);
    const xml=sitemapXml('https://cimahub.net',Object.values(before));assert.match(xml,/<loc>https:\/\/cimahub.net\/movie\/2034\/<\/loc>/);
  }finally{await unlink(join(directory,'movie-index.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}
});

test('movie category listing generates viewing titles and semantic internal links',()=>{
  const listing=parseMovieListing(new URL('http://test/movies/foreign/'));
  assert.equal(listing.name,'أفلام أجنبية مترجمة');
  assert.equal(listing.heading,'أفلام أجنبي مترجمة');
  assert.match(listing.title,/مشاهدة أفلام أجنبي \d{4} مترجمة كاملة HD اون لاين/);
  assert.match(listing.description,/مشاهدة وتحميل أحدث أفلام أجنبي \d{4} مترجمة كاملة بجودة عالية HD/);
  const content=listingContent(listing,{results:[movie]});
  assert.match(content,/<h1>أفلام أجنبي مترجمة<\/h1>/);
  assert.match(content,/href="\/movies\/foreign\/"/);
  assert.match(content,/href="\/movies\/year\/\d{4}\/"/);
  assert.match(content,/href="\/movies\/genre\/action\/"/);
  const horror=parseMovieListing(new URL('http://test/movies/genre/horror/'));
  assert.equal(horror.heading,'أفلام رعب');
  assert.match(horror.title,/مشاهدة أفلام رعب \d{4} كاملة HD اون لاين/);
  assert.match(horror.description,/مشاهدة وتحميل أفلام رعب/);
});
