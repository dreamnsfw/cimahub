import {test, after, before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,unlink,rmdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const catalogDirectory=await mkdtemp(join(tmpdir(),'cimahub-server-seo-'));
await writeFile(join(catalogDirectory,'qfilm-adult-category.json'),JSON.stringify({checkedAt:new Date().toISOString(),entries:Array.from({length:2000},(_,i)=>({vid:'source'+i,title:i?'Source Film '+i:'Example Film',year:'2025',tmdbId:i?99000+i:98766})),review:[]}));
const previousDirectory=process.env.SEO_DATA_DIR;
process.env.SEO_DATA_DIR=catalogDirectory;
const {server,routeApi}=await import('../server.js');
if(previousDirectory===undefined)delete process.env.SEO_DATA_DIR;else process.env.SEO_DATA_DIR=previousDirectory;
let base;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(()=>new Promise(resolve=>server.close(resolve)));
after(async()=>{await unlink(join(catalogDirectory,'seo-catalog.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});await unlink(join(catalogDirectory,'qfilm-adult-category.json'));await rmdir(catalogDirectory);});
test('private files and arbitrary proxy routes cannot be accessed',async()=>{for(const target of ['/.env','/server.js','/api/configuration','/package.json'])assert.equal((await fetch(base+target)).status,404);});
test('static assets carry browser protections',async()=>{const res=await fetch(base+'/');assert.equal(res.status,200);assert.match(res.headers.get('content-security-policy'),/object-src 'none'/);assert.match(await res.text(),/lang="ar" dir="rtl"/);});
test('reject invalid requests before contacting provider',async()=>{for(const query of ['type=person','page=0','page=101','page=501','page=1.3','genre=oops','sort=secret','region=unknown'])assert.equal((await fetch(`${base}/api/browse?${query}`)).status,400);assert.equal((await fetch(base+'/api/search?q=')).status,400);});
test('listing pages above 100 do not load provider data or redirect to another page',async()=>{
 for(const path of ['/movies/','/movies/foreign/','/movies/18-plus/','/movies/genre/action/','/movies/year/2000/','/series/','/anime/movies/','/anime/series/','/top/','/top/?type=tv','/recent/','/episodes/','/seasons/','/search/?q=film']){
  const response=await fetch(base+path+(path.includes('?')?'&':'?')+'page=101',{redirect:'manual'});
  assert.equal(response.status,404,path);assert.equal(response.headers.get('location'),null,path);
 }
 for(const path of ['/api/recent?page=101','/api/search?q=film&page=101'])assert.equal((await fetch(base+path)).status,400,path);
});
test('reject mutations',async()=>assert.equal((await fetch(base+'/api/home',{method:'POST'})).status,405));
test('TV filters and anime requests map to their provider fields',()=>{const route=routeApi(new URL('http://test/api/browse?type=tv&year=2025&anime=1'));assert.equal(route.endpoint,'discover/tv');assert.equal(route.params.get('first_air_date_year'),'2025');assert.equal(route.params.get('with_original_language'),null);assert.equal(route.params.get('with_genres'),'16');});
test('movie details request biography keywords without changing TV detail fields',()=>{
 const movie=routeApi(new URL('http://test/api/details/movie/1'));
 const tv=routeApi(new URL('http://test/api/details/tv/1'));
 assert.ok(movie.params.get('append_to_response').split(',').includes('keywords'));
 assert.ok(!tv.params.get('append_to_response').split(',').includes('keywords'));
});
test('search query preserves Arabic without exposing provider credentials',()=>{const route=routeApi(new URL('http://test/api/search?q=فيلم'));assert.equal(route.params.get('query'),'فيلم');assert.equal(route.params.has('api_key'),false);});

test('the unified category directory renders and appears in sitemaps without calling a provider',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=(input,options)=>{
  assert.equal(new URL(String(input)).hostname,'127.0.0.1','directory must not fetch remote provider data');
  return originalFetch(input,options);
 };
 try{
  for(const path of ['/categories/','/categories']){
   const response=await originalFetch(base+path,{redirect:'manual'});
   assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
   const html=await response.text();
   assert.match(html,/<h1>التصنيفات<\/h1>/);
   assert.match(html,/data-server-rendered="true" data-page-kind="categories"/);
   assert.match(html,/<meta name="robots" content="index, follow/);
   assert.match(html,/<link rel="canonical" href="[^"]+\/categories\/"/);
   assert.equal((html.match(/class="directory-child/g)||[]).length,127);
   assert.match(html,/id="movie-page-data">\[\]<\/script>/);
  }
  for(const path of ['/sitemap-categories.xml','/sitemap-base.xml'])assert.match(await (await originalFetch(base+path)).text(),/<loc>[^<]+\/categories\/<\/loc>/);
  const head=await originalFetch(base+'/categories/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 }finally{globalThis.fetch=originalFetch;}
});

test('native anime and TV categories return server-rendered SEO and sitemap entries',async()=>{
 const originalFetch=globalThis.fetch,originalKey=process.env.TMDB_API_KEY;
 process.env.TMDB_API_KEY='test-placeholder';
 globalThis.fetch=async (input,options)=>{
   const url=new URL(String(input));
   if(url.hostname!=='api.themoviedb.org')return originalFetch(input,options);
   if(url.pathname.includes('/discover/')){
    const anime=(url.searchParams.get('with_genres')||'').split(',').includes('16'),tv=url.pathname.includes('/tv');
    const biography=url.searchParams.get('with_keywords')==='5565',upcoming=url.searchParams.get('sort_by')==='primary_release_date.asc';
    if(biography)assert.notEqual(url.searchParams.get('with_genres'),'5565');
    if(upcoming){assert.equal(url.searchParams.has('vote_count.gte'),false);assert.ok(url.searchParams.get('primary_release_date.gte')>new Date().toISOString().slice(0,10));}
    const ageCategory=url.searchParams.has('certification.gte');
    if(ageCategory){assert.equal(url.searchParams.get('certification.gte'),'R');assert.equal(url.searchParams.get('certification_country'),'US');assert.equal(url.searchParams.get('include_adult'),'false');}
    return Response.json({page:Number(url.searchParams.get('page')||1),total_pages:url.searchParams.get('page')==='100'?800:3,results:[{id:anime?98765:tv?98767:biography?98769:upcoming?98770:98766,...(tv?{name:'Example Show'}:{title:anime?'Example':biography?'Biography Film':upcoming?'Upcoming Film':'Example Film'}),genre_ids:[anime?16:28],original_language:'en',poster_path:'/example.jpg',...(biography||upcoming?{overview:'قصة الفيلم وأبطاله.',release_date:upcoming?url.searchParams.get('primary_release_date.gte'):'2001-01-01',vote_count:upcoming?0:100}:{})},...(ageCategory?[{id:98768,title:'Family Movie',genre_ids:[28],original_language:'en'}]:[])]});
   }
   const tv=url.pathname.includes('/tv/'),family=url.pathname.includes('98768'),anime=url.pathname.includes('98765'),movieId=Number(url.pathname.match(/\/movie\/(\d+)/)?.[1]);
   if(movieId===98769||movieId===98770)return Response.json({id:movieId,title:movieId===98769?'Biography Film':'Upcoming Film',original_language:'en',overview:'قصة الفيلم وأبطاله.',release_date:movieId===98769?'2001-01-01':new Date(Date.now()+86400000).toISOString().slice(0,10),genres:[{id:28,name:'أكشن'}],keywords:{keywords:movieId===98769?[{id:5565,name:'biography'}]:[]},images:{posters:[]},videos:{results:[]},credits:{cast:[],crew:[]}});
   return Response.json({id:movieId||(family?98768:anime?98765:tv?98767:98766),...(tv?{name:'Example Show'}:{title:family?'Family Movie':anime?'Example':movieId>=99000?'Source Film '+movieId:'Example Film'}),original_language:'en',genres:[{id:anime?16:28,name:anime?'أنمي':'أكشن'}],images:{posters:[]},release_dates:{results:[{iso_3166_1:'US',release_dates:[{certification:family?'PG-13':'R'}]}]}});
 };
 try{
  const response=await originalFetch(base+'/anime/movies/');
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/data-server-rendered="true" data-page-kind="anime"/);
  assert.match(html,/<h1>أفلام أنمي<\/h1>/);
  assert.match(html,/rel="canonical"/);
  assert.match(html,/مشاهدة فيلم أنمي Example/);
  assert.match(html,/href="\/example\/"/);
  const named=await originalFetch(base+'/example/');assert.equal(named.status,200);
  const detailHtml=await named.text();assert.match(detailHtml,/<link rel="canonical" href="[^\"]+\/example\/"/);assert.match(detailHtml,/أفلام أنمي/);
  const legacy=await originalFetch(base+'/movie/98765/',{redirect:'manual'});assert.equal(legacy.status,301);assert.equal(legacy.headers.get('location'),'/example/');
  const missing=await originalFetch(base+'/no-such-work/');assert.equal(missing.status,404);assert.equal(missing.headers.get('x-robots-tag'),'noindex');
  assert.equal((await originalFetch(base+'/anime/movies/?page=4')).status,404);
  const redirect=await originalFetch(base+'/anime/movies/?page=1&sort=popularity.desc',{redirect:'manual'});
  assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/anime/movies/?page=1');
  for(const path of ['/movies/','/movies/foreign/','/movies/18-plus/','/anime/movies/','/series/','/top/']){
   const first=await originalFetch(base+path+'?page=1',{redirect:'manual'});
   assert.equal(first.status,200,path);assert.equal(first.headers.get('location'),null,path);
   const firstHtml=await first.text();
   const canonical=firstHtml.match(/<link rel="canonical" href="([^"]+)"/)[1];
   assert.equal(new URL(canonical).pathname,path);assert.equal(new URL(canonical).search,'');
   assert.match(firstHtml,/<meta name="robots" content="index, follow/);
   const second=await originalFetch(base+path+'?page=2',{redirect:'manual'});
   assert.equal(second.status,200,path);
   const secondHtml=await second.text();
   assert.equal(new URL(secondHtml.match(/<link rel="canonical" href="([^"]+)"/)[1]).search,'?page=2');
   assert.match(secondHtml,/<meta name="robots" content="index, follow/);
  }
  const filtered=await originalFetch(base+'/movies/foreign/?year=2026&page=1',{redirect:'manual'});
  assert.equal(filtered.status,200);
  const filteredHtml=await filtered.text();
  assert.match(filteredHtml,/<meta name="robots" content="noindex, follow"/);
  assert.equal(new URL(filteredHtml.match(/<link rel="canonical" href="([^"]+)"/)[1]).search,'?year=2026');
  const ageResponse=await originalFetch(base+'/movies/18-plus/');
  const ageHtml=await ageResponse.text();assert.equal(ageResponse.status,200);assert.match(ageHtml,/<h1>أفلام للكبار فقط \+18<\/h1>/);
  assert.match(ageHtml,/href="\/example-film\/"/);assert.doesNotMatch(ageHtml,/Family Movie/);
  for(const path of ['/movies/','/movies/foreign/','/movies/18-plus/','/series/','/anime/movies/','/anime/series/','/top/','/top/?type=tv']){
   const response=await originalFetch(base+path+(path.includes('?')?'&':'?')+'page=100',{redirect:'manual'});
   assert.equal(response.status,200,path);
   const html=await response.text();
   assert.match(html,/class="pagination-current" aria-current="page">100</,path);
   assert.doesNotMatch(html,/rel="next"|aria-label="الصفحة (?:101|500|800)"/,path);
   assert.match(html,/canonical" href="[^"]*page=100"/,path);
  }
  const api=await originalFetch(base+'/api/browse?page=100');
  assert.equal(api.status,200);assert.equal((await api.json()).total_pages,100);
  const tv=await originalFetch(base+'/series-category/arabic-series/');
  assert.match(await tv.text(),/<h1>مسلسلات عربية<\/h1>/);
  for(const path of ['/movies/genre/biography/','/movies/coming-soon/','/movies/year/1977/']){
   const response=await originalFetch(base+path,{redirect:'manual'});assert.equal(response.status,200,path);assert.equal(response.headers.get('location'),null,path);
   const html=await response.text();assert.match(html,/<meta name="robots" content="index, follow/,path);
   assert.equal(new URL(html.match(/<link rel="canonical" href="([^"]+)"/)[1]).pathname,path);
   if(path.includes('coming-soon')){
    const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
    assert.match(main,/يعرض قريبًا/);assert.match(main,/Upcoming Film/);assert.doesNotMatch(main,/مشاهدة وتحميل|★ 0\.0/);
    const schema=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.match(schema['@graph'][0].mainEntity.itemListElement[0].name,/مشاهدة فيلم Upcoming Film/);
    assert.doesNotMatch(schema['@graph'][0].mainEntity.itemListElement[0].name,/قريبًا/);
    assert.match(main,/<span class="poster-upcoming">قريبًا<\/span>/);
   }else if(path.includes('biography'))assert.match(html,/Biography Film/);
  }
  const biographyDetail=await originalFetch(base+'/biography-film-2001/');assert.equal(biographyDetail.status,200);assert.match(await biographyDetail.text(),/href="\/movies\/genre\/biography\/"/);
  for(const path of ['/movies/genre/biography/','/movies/coming-soon/']){
   const scoped=await originalFetch(base+path+'?region=foreign',{redirect:'manual'});assert.equal(scoped.status,200,path);
   const scopedHtml=await scoped.text();assert.match(scopedHtml,/<meta name="robots" content="noindex, follow"/);
   assert.equal(new URL(scopedHtml.match(/<link rel="canonical" href="([^"]+)"/)[1]).pathname,path);
   assert.match(scopedHtml,path.includes('biography')?/Biography Film/:/Upcoming Film/);
  }
  const futurePath='/upcoming-film-'+new Date(Date.now()+86400000).getUTCFullYear()+'/';
  const futureDetail=await originalFetch(base+futurePath);assert.equal(futureDetail.status,200);
  const futureHtml=await futureDetail.text();const futureMain=futureHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
  assert.match(futureMain,/<h1>مشاهدة فيلم Upcoming Film/);assert.doesNotMatch(futureMain,/يعرض قريبًا|أفلام تعرض قريبًا|مشاهدة وتحميل|مترجم للعربية|★ 0\.0/);
  assert.match(futureMain,/href="\/movies\/foreign\/">أفلام أجنبية/);
  const sitemap=await originalFetch(base+'/sitemap-categories.xml');
  const xml=await sitemap.text();assert.match(xml,/\/anime\/movies\//);assert.match(xml,/\/anime\/series\//);assert.match(xml,/\/series-category\/arabic-series\//);
  const baseMap=await originalFetch(base+'/sitemap-base.xml');assert.equal(baseMap.status,200);assert.equal(await baseMap.text(),xml);
  assert.equal((xml.match(/<loc>[^<]*\/movies\/18-plus\/<\/loc>/g)||[]).length,1);
  assert.match(xml,/\/movies\/genre\/biography\//);assert.match(xml,/\/movies\/coming-soon\//);
  const sitemapIndex=await(await originalFetch(base+'/sitemap.xml')).text();assert.match(sitemapIndex,/\/sitemap-base\.xml/);assert.match(sitemapIndex,/\/sitemap-categories\.xml/);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.TMDB_API_KEY;else process.env.TMDB_API_KEY=originalKey;}
});

test('latest homepage sections sort released titles and separate anime',()=>{
 for(const type of ['movie','tv']){const r=routeApi(new URL('http://test/api/browse?type='+type+'&latest=1'));assert.equal(r.params.get('sort_by'),type==='movie'?'primary_release_date.desc':'first_air_date.desc');assert.equal(r.params.get('without_genres'),'16');assert.match(r.params.get(type==='movie'?'primary_release_date.lte':'first_air_date.lte'),/^\d{4}-\d{2}-\d{2}$/);}
 const a=routeApi(new URL('http://test/api/browse?type=tv&anime=1&latest=1'));assert.equal(a.params.get('with_genres'),'16');assert.equal(a.params.get('with_original_language'),null);assert.equal(a.params.has('without_genres'),false);
});
