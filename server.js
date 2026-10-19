import {MAX_LISTING_PAGES} from './public/pagination.js';
import {withD1ReadOnly} from './d1-client.js';
import {createSharedCache,publicPageCacheKey} from './shared-cache.js';
import {createOptimizedImageCache} from './optimized-image.js';
import {withSiteNavigation} from './site-navigation.js';
import {categoriesPage,categoriesPath} from './directory-page.js';
import {createAdultCategory} from './qfilm-category.js';
import {createQfilmDiscovery} from './qfilm-discovery.js';
import {syncFetchSignal} from './sync-execution.js';
import {searchWithCatalog,presentSearchResults,searchResultCards} from './catalog-search.js';
import {cleanStory,cleanCredits,hasUnsupportedText} from './story-language.js';
import {publicPages,collectionPage,homePage} from './site-seo.js';
import {loadVideoRecord,readVideoThumbnail,videoMetadata,publishedVideoEntries,videoSitemapXml} from './video-seo.js';
import {createSeoCatalog} from './seo-catalog.js';
import {seriesPage} from './detail-seo.js';
import {createImageCache} from './image-cache.js';
import {createImageSourceResolver} from './image-source.js';
import {createPublicAssetHandler} from './public-assets.js';
import {localImage} from './public/media-images.js';
import {categoryPaths,parseCategoryListing,categoryItems,categoryMetadata,categoryContent} from './category-seo.js';
import {presentSeries as formatSeries} from './series-presentation.js';
import {createLatestTV} from './latest-tv.js';
import {createLinkSync} from './movie-link-sync.js';
import {movieLinks,safeLink} from './qfilm-import.js';
import http from 'node:http';
import { readFile } from './storage.js';
import {dbEnabled,initializeDatabase,query} from './database.js';
import {createAdminApi,seedAdminTaxonomy} from './admin-api.js';
import {currentSettings,managedSources,applyPageOverrides} from './managed-content.js';
import {configureNavigationTaxonomy} from './site-navigation.js';
import {applySeriesParts,applySeasonParts,applyEpisodePart} from './admin-parts.js';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { applyMoviePresentation as formatMovies } from './movie-presentation.js';
import { usesMoviePresentation } from './movie-presentation.js';
import {createMovieTranslator} from './movie-translation.js';
import {adultMovieCategory,movieSections, movieGenres, movieTopicSections, comingSoonMovieCategory, isFutureMovie, movieDisplayTitle, movieMetadata, parseMovieListing, listingContent, movieContent, sourceButtons, renderSeoPage, createMovieIndex, sitemapXml, escapeHtml} from './movie-seo.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const servePublicAsset = createPublicAssetHandler(root);
const serverless = Boolean(process.env.VERCEL);
const siteTemplate=async()=>{const settings=await currentSettings();let html=withSiteNavigation(await readFile(path.join(root,'index.html'),'utf8'));if(settings.site_name!=='سيما هَب')html=html.replace(/سيما هَب/g,escapeHtml(settings.site_name));if(settings.site_name!=='سيما هَب')html=html.replace(/(<a class="brand"[^>]*>)[\s\S]*?(<\/a>)/,(_,start,end)=>start+'<span class="brand-icon">▶</span><span>'+escapeHtml(settings.site_name)+'</span>'+end);if(settings.header_notice)html=html.replace('</header>','</header><div class="content" role="status">'+escapeHtml(settings.header_notice)+'</div>');if(settings.contact_email)html=html.replace('</footer>','<a href="mailto:'+escapeHtml(settings.contact_email)+'">تواصل معنا</a></footer>');return html;};
const cache = new Map();
const pageCache=new Map();
const sharedCache=createSharedCache();
function listingRequestPath(url,canonicalPath){
 const [pathname,query='']=canonicalPath.split('?');
 const params=new URLSearchParams(query);
 if(url.searchParams.has('page')&&Number(url.searchParams.get('page'))===1)params.set('page','1');
 return pathname+(params.size?'?'+params:'');
}
const seoCatalog=createSeoCatalog(process.env.SEO_DATA_DIR?pathToFileURL(path.resolve(process.env.SEO_DATA_DIR)+path.sep):undefined);
const adultCategory=createAdultCategory({directory:process.env.SEO_DATA_DIR?pathToFileURL(path.resolve(process.env.SEO_DATA_DIR)+path.sep):undefined,loadMovie:tmdb});
// Cached category data stays available without work that outlives a request.
if(serverless)adultCategory.setInterval(Infinity);
const presentSeries=async (...args)=>{
 const data=await formatSeries(...args,translateSeries);
 if(/^(movie|tv)\/\d+$/.test(args[1])&&[...(data.credits?.cast||[]),...(data.credits?.crew||[])].some(p=>hasUnsupportedText(p.name)||hasUnsupportedText(p.character))){
  let english;try{english=await tmdb(`${args[1]}/credits`,new URLSearchParams({language:'en-US'}));}catch{}
  data.credits=cleanCredits(data.credits,english);
 }
 return /\/season\//.test(args[1])?data:seoCatalog.decorate(data);
};
const applyMoviePresentation=formatMovies;
const cachedImage=createImageCache({sourceFor:createImageSourceResolver({catalog:seoCatalog,load:tmdb})});
const optimizedImage=createOptimizedImageCache({load:cachedImage});
const pendingRequests = new Map();
const clients = new Map();
const movieIndex = createMovieIndex();
const translateMovie = createMovieTranslator();
const translateSeries = createMovieTranslator({directory:new URL('./data/series-translations/',import.meta.url)});
const latestTV=createLatestTV(tmdb);
const linkSync=createLinkSync({loadMovie:tmdb});
const sourceDiscovery=createQfilmDiscovery({loadMovie:tmdb,onMovie:async movie=>{
 const endpoint='movie/'+movie.id;
 const raw=await tmdb(endpoint,new URLSearchParams({language:'ar-SA',append_to_response:'credits,keywords'}));
 const presented=await seoCatalog.decorate(await applyMoviePresentation(raw,endpoint,tmdb,translateMovie),undefined,{persist:true});
 await movieIndex.remember([presented]);queueMovieLinks([presented]);
}});
function queueMovieLinks(movies){if(!serverless&&process.env.TMDB_API_KEY)void linkSync.enqueue(movies.filter(m=>m.movie_presentation_version===1)).catch(e=>console.warn('Movie link queue:',e.message));}
const deploymentHost=process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL;
const siteOrigin = new URL(process.env.SITE_URL || (deploymentHost?`https://${deploymentHost}`:`http://127.0.0.1:${process.env.PORT || 3000}`)).origin;
async function sitemapEntries(){
 const works=await seoCatalog.all(),pages=await seoCatalog.pages();
 const entries=new Map(works.filter(w=>w.indexable).map(w=>[`/${w.slug}/`,{path:`/${w.slug}/`,poster:w.poster}]));
 const owners=new Map(works.map(work=>[work.slug,work]));
 for(const page of pages){const owner=owners.get(page.path.split('/')[1]);if(page.indexable&&owner?.indexable)entries.set(page.path,page);else entries.delete(page.path);}
 return [...entries.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
async function sitemapCategoryEntries(){
 const states=await seoCatalog.collections();
 const candidates=[
  ...['/',categoriesPath,'/top/','/recent/','/episodes/','/seasons/','/dmca/','/terms/'].map(path=>({path})),
  ...categoryPaths.filter(path=>path!=='/series-genre/animation/').map(path=>({path})),
  {path:'/movies/'},{path:adultMovieCategory.path},...Object.keys(movieSections).map(key=>({path:'/movies/'+key+'/'})),
  ...Object.keys(movieGenres).map(key=>({path:'/movies/genre/'+key+'/'})),
  ...Object.values(movieTopicSections).map(section=>({path:section.path})),
  {path:comingSoonMovieCategory.path},
  ...Array.from({length:4},(_,i)=>({path:'/movies/year/'+(new Date().getFullYear()-i)+'/'}))
 ];
 return candidates.filter(({path})=>/^\/anime\/(?:movies|series)\/genre\//.test(path)?states[path]?.indexable===true:states[path]?.indexable!==false);
}
export function routeApi(url) {
  const type = url.searchParams.get('type') || 'movie';
  if (!['movie', 'tv'].includes(type)) throw new Error('نوع غير صالح');
  const params = new URLSearchParams({language: 'ar-SA', include_adult: 'false'});
  const page = Number(url.searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > MAX_LISTING_PAGES) throw new Error('رقم صفحة غير صالح');
  params.set('page', String(page));
  let endpoint;
  if (url.pathname === '/api/home') endpoint = 'trending/all/week';
  else if (url.pathname === '/api/genres') endpoint = `genre/${type}/list`;
  else if (url.pathname === '/api/search') {
    const query = (url.searchParams.get('q') || '').trim();
    if (!query || query.length > 120) throw new Error('اكتب اسم العمل، بحد أقصى 120 حرفًا');
    params.set('query', query); endpoint = 'search/multi';
  } else if (url.pathname === '/api/browse') {
    endpoint = `discover/${type}`;
    const sort = url.searchParams.get('sort') || 'popularity.desc';
    if (!['popularity.desc', 'vote_average.desc', 'primary_release_date.desc', 'first_air_date.desc'].includes(sort)) throw new Error('ترتيب غير صالح');
    params.set('sort_by', sort);
    params.set('vote_count.gte', sort === 'vote_average.desc' ? '200' : '10');
    const regions = Object.fromEntries(Object.entries(movieSections).map(([key,section])=>[key,section.language]));
    const region = url.searchParams.get('region');
    if (region) { if (!regions[region]) throw new Error('قسم غير صالح'); params.set('with_original_language', regions[region]); }
    const genre = url.searchParams.get('genre');
    if (genre) { if (!/^\d+(,\d+)*$/.test(genre)) throw new Error('تصنيف غير صالح'); params.set('with_genres', genre); }
    const year = url.searchParams.get('year');
    if (year) { if (!/^\d{4}$/.test(year)) throw new Error('سنة غير صالحة'); params.set(type === 'movie' ? 'primary_release_year' : 'first_air_date_year', year); }
    if (url.searchParams.get('anime') === '1') { params.set('with_genres', '16'); }
    if (url.searchParams.get('latest') === '1') {
      params.set('sort_by', type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc');
      params.set(type === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte', new Date().toISOString().slice(0,10));
      if(url.searchParams.get('anime') !== '1') params.set('without_genres','16');
    }
  } else {
    const season = url.pathname.match(/^\/api\/tv\/([1-9]\d*)\/season\/(\d+)$/);
    if(season){return {endpoint:`tv/${season[1]}/season/${season[2]}`,params};}
    const match = url.pathname.match(/^\/api\/details\/(movie|tv)\/(\d+)$/);
    if (!match) return null;
    endpoint = `${match[1]}/${match[2]}`;
    params.set('append_to_response', 'credits,videos,recommendations,watch/providers'+(match[1]==='movie'?',keywords':''));
  }
  return { endpoint, params };
}
async function tmdb(endpoint, params) {
  const key = `${endpoint}?${params}`;
  if (cache.get(key)?.expires > Date.now()) return cache.get(key).data;
  if (pendingRequests.has(key)) return pendingRequests.get(key);
  const request=(async()=>{
    const sharedKey='tmdb:'+key;
    const shared=await sharedCache.get(sharedKey);
    if(shared){if(cache.size>=1500)cache.delete(cache.keys().next().value);cache.set(key,{data:shared,expires:Date.now()+300000});return shared;}
    const apiKey=process.env.TMDB_API_KEY;
    if(!apiKey)throw Object.assign(new Error('يرجى ضبط مفتاح TMDB في إعدادات الخادم'),{status:503});
    const query=new URLSearchParams(params);query.set('api_key',apiKey);
    for(let attempt=0;attempt<2;attempt++){
      try {
        const response=await fetch(`https://api.themoviedb.org/3/${endpoint}?${query}`,{signal:syncFetchSignal(12000)});
        if(!response.ok){if((response.status>=500||response.status===429)&&attempt===0)continue;throw Object.assign(new Error(response.status===404?'العمل غير موجود':'تعذّر تحميل بيانات العمل. حاول مجددًا بعد قليل.'),{status:response.status===404?404:502});}
        const data=await response.json();
        if(cache.size>=1500)cache.delete(cache.keys().next().value);
        cache.set(key,{data,expires:Date.now()+300000});await sharedCache.set(sharedKey,data);return data;
      }catch(error){if(error.status||attempt===1)throw Object.assign(new Error(error.status?error.message:'تعذّر الاتصال بمصدر البيانات. حاول مجددًا بعد قليل.'),{status:error.status||502});}
    }
  })().finally(()=>pendingRequests.delete(key));
  pendingRequests.set(key,request);return request;
}

async function searchData(params){
 const data=await searchWithCatalog({query:params.get('query'),page:Number(params.get('page')||1),
  remote:(query,page)=>tmdb('search/multi',new URLSearchParams({...Object.fromEntries(params),language:'en-US',query,page:String(page)})),
  works:()=>seoCatalog.all(),
  load:record=>tmdb(`${record.type}/${record.id}`,new URLSearchParams({language:'en-US'}))});
 return searchResultCards(await seoCatalog.decorate(presentSearchResults(data)));
}
async function recentData(requestedPage){
        const pageSize=20;
        const requested=Number(requestedPage||1);
        if(!Number.isInteger(requested)||requested<1||requested>MAX_LISTING_PAGES)throw Object.assign(new Error('رقم صفحة غير صالح'),{status:400});
        const today=new Date().toISOString().slice(0,10);
        const updates=await latestTV();
        const episodes=updates.episodes.filter(m=>m.air_date&&m.air_date<=today);
        const fetchPage=async page=>{
          const params=new URLSearchParams({language:'ar-SA',include_adult:'false',sort_by:'primary_release_date.desc','primary_release_date.lte':today,'vote_count.gte':'10',without_genres:'16',page:String(page)});
          return tmdb('discover/movie',params);
        };
        const first=await fetchPage(1);
        const movieCount=Math.min(first.total_results,10000);
        const total=movieCount+episodes.length,totalPages=Math.max(1,Math.min(MAX_LISTING_PAGES,Math.ceil(total/pageSize))),page=requested,offset=(page-1)*pageSize;
        if(page>totalPages)throw Object.assign(new Error('الصفحة غير موجودة'),{status:404});
        const start=Math.min(500,Math.floor(Math.max(0,offset-episodes.length)/20)+1);
        const end=Math.min(500,Math.ceil((offset+pageSize)/20),Math.max(1,first.total_pages));
        const batches=await Promise.all(Array.from({length:Math.max(0,end-start+1)},(_,i)=>start+i===1?first:fetchPage(start+i)));
        const movies=batches.flatMap(d=>d.results).map(m=>({...m,media_type:'movie',recent_date:m.release_date}));
        const merged=[...movies,...episodes.map(m=>({...m,media_type:'tv',recent_date:m.air_date}))].sort((a,b)=>b.recent_date.localeCompare(a.recent_date)||a.id-b.id);
        const skip=offset-(start-1)*20;
        const results=await Promise.all(merged.slice(skip,skip+pageSize).map(m=>m.media_type==='movie'?applyMoviePresentation(m,'movie/'+m.id,tmdb):formatSeries(m,'tv/'+m.id,tmdb,translateSeries)));
        // Resolve catalog records and persist the displayed batch once, not once per card.
        return seoCatalog.decorate({page,total_pages:totalPages,total_results:total,page_size:pageSize,results});
}

let scheduledSync,syncSignature;
async function applyAdministration(invalidate=false){
 if(!dbEnabled())return;
 if(invalidate)await sharedCache.invalidatePages();
 pageCache.clear();configureNavigationTaxonomy((await query('SELECT * FROM taxonomy')).rows);
 const settings=await currentSettings();const signature=JSON.stringify([settings.sync_enabled,settings.sync_interval_hours]);if(signature===syncSignature)return;syncSignature=signature;linkSync.stop();sourceDiscovery.stop();clearInterval(scheduledSync);
 if(serverless)return;
 sourceDiscovery.setInterval?.(settings.sync_interval_hours*3600000);adultCategory.setInterval?.(settings.sync_interval_hours*3600000);
 if(settings.sync_enabled){void linkSync.start().catch(()=>{});sourceDiscovery.start();scheduledSync=setInterval(()=>{void adultCategory.refresh().catch(()=>{});},settings.sync_interval_hours*3600000);scheduledSync.unref();}
}
let administrationReady;
async function initializeAdministration(){
 if(!dbEnabled())return;
 if(!administrationReady)administrationReady=(async()=>{
  await initializeDatabase();await seedAdminTaxonomy();await applyAdministration();
 })().catch(error=>{administrationReady=undefined;throw error;});
 return administrationReady;
}
const adminApi=createAdminApi({origin:siteOrigin,onChange:()=>applyAdministration(true),loadTMDB:tmdb,loadWork:async(type,id)=>{
 const endpoint=type+'/'+id;const raw=await tmdb(endpoint,new URLSearchParams({language:'ar-SA',append_to_response:'credits,videos,recommendations'+(type==='movie'?',keywords':'')}));
 await presentSeries(await applyMoviePresentation(raw,endpoint,tmdb,translateMovie),endpoint,tmdb);return (await query('SELECT * FROM content_items WHERE key=$1',[type+':'+id])).rows[0];
},awaitJobs:serverless,jobs:{sources:{label:'تحديث سيرفرات الأفلام',run:()=>linkSync.tick(serverless?{maxJobs:1,maxCandidates:2,throwOnError:true}:{})},discovery:{label:'اكتشاف الأفلام الجديدة',run:()=>sourceDiscovery.tick(serverless?{maxJobs:1,maxDiscoveryPages:2,throwOnError:true}:{})},adult:{label:'تحديث فئة +18',run:async()=>{const value=await adultCategory.refresh(serverless?{maxPages:1}:{});return {sourceCount:value.sourceCount,nextPage:value.refreshCursor||1};}}}});

export async function handleRequest(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://image.tmdb.org https://*.google-analytics.com https://www.googletagmanager.com data:; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; frame-src https://www.youtube-nocookie.com https://megamax.me; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  const json = (status, data) => {
    if(status>=400&&!req.url.startsWith('/api/')&&!req.url.startsWith('/uploads/')){
      res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex',...(status>=500?{'Retry-After':'60'}:{})});
      const title=status===404?'الصفحة غير موجودة':'تعذّر تحميل المحتوى';
      return res.end(req.method==='HEAD'?undefined:`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${title} | سيما هَب</title><link rel="stylesheet" href="/styles.css"><main class="content"><div class="empty"><h1>${title}</h1><p>${escapeHtml(data.error)}</p><a class="primary" href="/">العودة إلى الرئيسية</a></div></main></html>`);
    }
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(req.method==='HEAD'?undefined:JSON.stringify(data));
  };
  try { if(await servePublicAsset(req,res,new URL(req.url,'http://localhost').pathname))return; }
  catch { return json(400,{error:'عنوان الصفحة غير صالح'}); }
  try{await initializeAdministration();}catch{return json(503,{error:'تعذر الاتصال بقاعدة بيانات الموقع'});}
  if(req.url.startsWith('/admin')||req.url.startsWith('/api/admin/')){try{if(await adminApi.handle(req,res,new URL(req.url,'http://localhost')))return;}catch{return json(503,{error:'تعذر الاتصال بقاعدة بيانات الإدارة'});}}
  return withD1ReadOnly(async()=>{
  if (!['GET', 'HEAD'].includes(req.method)) return json(405, {error: 'الطلب غير مدعوم'});
  try {
    const url = new URL(req.url, 'http://localhost');
    const settings=await currentSettings();
    if(settings.maintenance&&!url.pathname.startsWith('/uploads/')&&!url.pathname.endsWith('.css')&&!url.pathname.endsWith('.js')){res.writeHead(503,{'Content-Type':'text/html; charset=utf-8','Retry-After':'3600','Cache-Control':'no-store'});return res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="robots" content="noindex"><title>'+escapeHtml(settings.site_name)+'</title><body><h1>'+escapeHtml(settings.maintenance_message)+'</h1></body></html>');}
    const pageKey=publicPageCacheKey(url,siteOrigin,process.env.VERCEL_URL||'local');
    const send = async (status, body, type='text/html; charset=utf-8') => {
      // Chrome's XML viewer needs inline styles to hide the unformatted source.
      // Allow them only on XML responses; scripts and other resources stay blocked.
      if(type.startsWith('application/xml'))res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if(pageKey&&status===200&&type.startsWith('text/html')&&process.env.TMDB_API_KEY){
        const entry={body,csp:res.getHeader('Content-Security-Policy'),expires:Date.now()+60000};
        if(serverless){await sharedCache.set(pageKey,entry,{ttl:300,tags:['cimahub-pages']});res.setHeader('X-Site-Cache','MISS');}
        else {
        if(pageCache.size>=100)pageCache.delete(pageCache.keys().next().value);
        pageCache.set(pageKey,entry);
        }
      }
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
    };
    const cachedPage=pageKey&&(serverless?await sharedCache.get(pageKey):pageCache.get(pageKey));
    if(cachedPage&&(serverless||cachedPage.expires>Date.now())){res.setHeader('X-Site-Cache','HIT');res.setHeader('Content-Security-Policy',cachedPage.csp);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(req.method==='HEAD'?undefined:cachedPage.body);}
    const redirect = target => {const destination=new URL(target,'http://localhost');res.writeHead(301,{Location:destination.pathname+destination.search+destination.hash});res.end();};
    if(url.pathname===categoriesPath||url.pathname===categoriesPath.slice(0,-1)){
      const page=categoriesPage(siteOrigin);
      return send(200,renderSeoPage(await siteTemplate(),page.metadata,page.content).replace('data-server-rendered="true"','data-server-rendered="true" data-page-kind="categories"'));
    }
    if(url.pathname==='/index.html')return redirect('/');
    if(/^\/[^/.]+$/.test(url.pathname)&&await seoCatalog.resolve(decodeURIComponent(url.pathname.slice(1))))return redirect(url.pathname+'/'+url.search);
    const named=url.pathname.match(/^\/([^/.]+)\/(?:season\/([1-9]\d*)\/(?:episode\/([1-9]\d*)\/)?)?$/);
    const record=named?await seoCatalog.resolve(decodeURIComponent(named[1])):null;
    if(record){
      if(url.search)return redirect(url.pathname);
      const season=Number(named[2])||undefined,episode=Number(named[3])||undefined;
      if(season&&record.type!=='tv')return json(404,{error:'الصفحة غير موجودة'});
      const endpoint=`${record.type}/${record.id}`;
      const raw=await tmdb(endpoint,new URLSearchParams({language:'ar-SA',append_to_response:'credits,videos,recommendations'+(record.type==='movie'?',keywords':'')}));
      if(raw.adult)return json(404,{error:'العمل غير متاح'});
      let m=await presentSeries(await applyMoviePresentation(raw,endpoint,tmdb,translateMovie),endpoint,tmdb);
      if(!m)return json(404,{error:'العمل غير موجود'});
      if(record.type==='movie'){
        m.source_adult_category=await adultCategory.contains(m.id);
        m.is_biography=(m.keywords?.keywords||[]).some(keyword=>keyword.id===movieTopicSections.biography.keyword);
      }
      const canonicalPath=m.public_path+(season?`season/${season}/`:'')+(episode?`episode/${episode}/`:'');
      if(decodeURIComponent(url.pathname)!==canonicalPath)return redirect(canonicalPath);
      if(!m.videos?.results?.length){try{m.videos=await tmdb(`${endpoint}/videos`,new URLSearchParams({language:'en-US'}));}catch{}}
      let page;
      if(record.type==='movie'){
        if(!m.overview){try{const en=await tmdb(endpoint,new URLSearchParams({language:'en-US'}));m.overview=await translateMovie({id:m.id,text:en.overview,language:'en'})||'';}catch{}}
        queueMovieLinks([m]);m.externalSources=await managedSources(m,await movieLinks(m.id));
        m.display_title=movieDisplayTitle(m);
        page={metadata:movieMetadata(m,siteOrigin),content:movieContent(m)};
        page.metadata.noindex=!m.overview&&!(m.externalSources||[]).some(r=>r.playback?.some(l=>safeLink(l.url)))&&!(m.runtime&&m.release_date&&m.credits?.cast?.length);
      }else{
        m=await applySeriesParts(m,`tv:${m.id}`);
        const seasonData=season?await applySeasonParts(await tmdb(`${endpoint}/season/${season}`,new URLSearchParams({language:'ar-SA'})).catch(e=>{if(e.status===404)return {season_number:season,episodes:[]};throw e;}),`tv:${m.id}`,season):undefined;
        const episodeData=episode?await applyEpisodePart(await tmdb(`${endpoint}/season/${season}/episode/${episode}`,new URLSearchParams({language:'ar-SA'})).catch(e=>{if(e.status===404)return {season_number:season,episode_number:episode};throw e;}),`tv:${m.id}`,season,episode):undefined;
        const subject=episodeData||seasonData||m;
        if(!subject.overview||hasUnsupportedText(subject.overview)){try{const en=await tmdb(endpoint+(season?`/season/${season}`:'')+(episode?`/episode/${episode}`:''),new URLSearchParams({language:'en-US'}));subject.overview=hasUnsupportedText(subject.overview)?await cleanStory(subject,en,translateSeries):await translateSeries({id:subject.id,text:en.overview,language:'en'})||'';}catch{}}
        if(episode){try{const saved=JSON.parse(await readFile(new URL(`./data/series-links/${m.id}.json`,import.meta.url),'utf8'));m.externalSources=[saved.episodes?.[`${season}-${episode}`]].filter(Boolean);}catch(error){if(error.code!=='ENOENT')throw error;}}
        m.externalSources=await managedSources(m,m.externalSources||[],{season:season||0,episode:episode||0});
        page=seriesPage(m,siteOrigin,{season,episode,seasonData,episodeData,player:sourceButtons(m,'playback')+sourceButtons(m,'downloads')});
      }
      page.metadata=await applyPageOverrides(page.metadata,m);
      const origins=[...new Set((m.externalSources||[]).flatMap(r=>r.playback||[]).map(l=>safeLink(l.url)).filter(Boolean).map(link=>new URL(link).origin))];
      if(origins.length)res.setHeader('Content-Security-Policy',res.getHeader('Content-Security-Policy').replace('frame-src https://www.youtube-nocookie.com https://megamax.me;',`frame-src https://www.youtube-nocookie.com https://megamax.me ${origins.join(' ')};`));
      page.metadata.image=m.poster_path?siteOrigin+localImage(m.poster_path):undefined;
      const videoRecord=await loadVideoRecord(`${record.type}:${record.id}${episode?`:${season}:${episode}`:''}`,m);
      const video=videoMetadata(videoRecord,m,page.metadata,siteOrigin);
      if(video){
        const work=page.metadata.schema['@graph'][0];work.subjectOf={'@id':video['@id']};video.about={'@id':work['@id']};video.mainEntityOfPage=page.metadata.canonical;
        page.metadata.schema['@graph'].push(video);
        page.content=page.content.replace(/(<iframe src=")[^"]*(" title="مشاهدة)/,(_,before,after)=>before+escapeHtml(video.embedUrl)+after);
      }
      await seoCatalog.mark(m,page.metadata);
      const template=await siteTemplate();
      return send(200,renderSeoPage(template,page.metadata,page.content,[m,...(m.recommendations?.results||[])]).replace('data-server-rendered="true"',`data-server-rendered="true" data-page-kind="${m.genres?.some(g=>g.id===16)?'anime':record.type==='tv'?'tv':'movies'}"`));
    }
    if(url.pathname.startsWith('/uploads/video-thumbs/')){
      const name=url.pathname.slice('/uploads/video-thumbs/'.length);
      if(!/^[-a-z0-9]+\.(jpg|png|webp)$/.test(name))return json(404,{error:'الصورة غير موجودة'});
      const image=await readVideoThumbnail(url.pathname);
      if(!image)return json(404,{error:'الصورة غير موجودة'});
      res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.body.length,'Cache-Control':'public, max-age=31536000, immutable'});
      return res.end(req.method==='HEAD'?undefined:image.body);
    }
    if(url.pathname.startsWith('/uploads/thumbs/')||url.pathname.startsWith('/uploads/optimized/')){
      const image=await (url.pathname.startsWith('/uploads/optimized/')?optimizedImage:cachedImage)(url.pathname);
      if(!image)return json(404,{error:'الصورة غير موجودة'});
      res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.body.length,'Cache-Control':'public, max-age=31536000, immutable'});
      return res.end(req.method==='HEAD'?undefined:image.body);
    }
    if(url.pathname==='/robots.txt')return send(200,`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin/\n\nSitemap: ${siteOrigin}/sitemap.xml\n`,'text/plain; charset=utf-8');
    if(url.pathname==='/sitemap.xml'){
      const count=(await sitemapEntries()).length;
      const videos=await publishedVideoEntries(await seoCatalog.all(),await seoCatalog.pages());
      const maps=['/sitemap-base.xml','/sitemap-categories.xml',...(videos.length?['/sitemap-videos.xml']:[]),...Array.from({length:Math.max(1,Math.ceil(count/1000))},(_,i)=>`/sitemap-movies-${i+1}.xml`)];
      return send(200,`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${maps.map(p=>`<sitemap><loc>${escapeHtml(siteOrigin+p)}</loc></sitemap>`).join('')}</sitemapindex>`,'application/xml; charset=utf-8');
    }
    if(url.pathname==='/sitemap-videos.xml')return send(200,videoSitemapXml(siteOrigin,await publishedVideoEntries(await seoCatalog.all(),await seoCatalog.pages())),'application/xml; charset=utf-8');
    if(['/sitemap-categories.xml','/sitemap-base.xml'].includes(url.pathname)){
      const core=new Set(['/',categoriesPath,'/top/','/recent/','/episodes/','/seasons/','/dmca/','/terms/']);
      const entries=(await sitemapCategoryEntries()).filter(row=>url.pathname==='/sitemap-base.xml'?core.has(row.path):!core.has(row.path));
      return send(200,sitemapXml(siteOrigin,entries),'application/xml; charset=utf-8');
    }
    const sitemapMatch=url.pathname.match(/^\/sitemap-movies-([1-9]\d*)\.xml$/);
    if(sitemapMatch){const entries=await sitemapEntries();const part=Number(sitemapMatch[1]);if(part>Math.max(1,Math.ceil(entries.length/1000)))return json(404,{error:'الخريطة غير موجودة'});return send(200,sitemapXml(siteOrigin,entries.slice((part-1)*1000,part*1000)),'application/xml; charset=utf-8');}
    if(url.pathname==='/movies'||url.pathname==='/movie')return redirect(url.pathname+'/'+url.search);
    if(url.pathname.startsWith('/movie/')||url.pathname.startsWith('/movies/')){
      if(!url.pathname.endsWith('/'))return redirect(url.pathname+'/'+url.search);
      if(url.pathname.startsWith('/movies/')&&url.searchParams.has('region')&&url.pathname!==comingSoonMovieCategory.path&&!Object.values(movieTopicSections).some(section=>section.path===url.pathname)){
        const region=url.searchParams.get('region');
        if(region&&!movieSections[region])return json(400,{error:'قسم غير صالح'});
        url.searchParams.delete('region');url.searchParams.delete('page');
        return redirect((region?`/movies/${region}/`:'/movies/')+(url.searchParams.size?'?'+url.searchParams:''));
      }
      const yearPath=url.pathname.match(/^\/movies\/year\/(\d{4})\/$/);
      if(yearPath&&url.searchParams.get('year')&&url.searchParams.get('year')!==yearPath[1]){
        const year=url.searchParams.get('year');if(!/^(19|20)\d{2}$/.test(year))return json(404,{error:'سنة غير صالحة'});
        url.searchParams.delete('year');url.searchParams.delete('page');
        return redirect('/movies/year/'+year+'/'+(url.searchParams.size?'?'+url.searchParams:''));
      }
      const detail=url.pathname.match(/^\/movie\/([1-9]\d*)\/$/);
      const listing=parseMovieListing(url);
      if(!detail&&!listing)return json(404,{error:'الصفحة غير موجودة'});
      const template=await siteTemplate();
      if(detail){
        if(url.search)return redirect(url.pathname);
        const endpoint=`movie/${detail[1]}`;
        const data=await tmdb(endpoint,new URLSearchParams({language:'ar-SA',append_to_response:'credits,videos,recommendations,keywords'}));
        const namedMovie=await presentSeries(await applyMoviePresentation(data,endpoint,tmdb,translateMovie),endpoint,tmdb);
        return redirect(namedMovie.public_path);

      }
      const requestPath=listingRequestPath(url,listing.canonicalPath);
      if(url.pathname+url.search!==requestPath)return redirect(requestPath);
      const data=listing.adultAudience?await adultCategory.listing(listing.page,listing.params.get('primary_release_year')):await tmdb('discover/movie',listing.params);
      if(listing.page>Math.max(1,Math.min(data.total_pages,MAX_LISTING_PAGES)))return json(404,{error:'الصفحة غير موجودة'});
      const prepared=await applyMoviePresentation(data,'discover/movie',tmdb,translateMovie);
      const presented=listing.adultAudience?await presentSeries(prepared,'discover/movie',tmdb):await seoCatalog.decorate(prepared);
      const movies=presented.results.filter(m=>listing.adultAudience?m.source_adult_category===true&&!m.adult:usesMoviePresentation(m,'movie'))
      .filter(m=>!listing.comingSoon||(isFutureMovie(m)&&m.release_date>=listing.params.get('primary_release_date.gte')&&m.release_date<=listing.params.get('primary_release_date.lte'))).map(m=>({
        ...m,
        ...(listing.topic==='biography'?{is_biography:true}:{}),
        ...(listing.comingSoon?{display_title:movieDisplayTitle(m)}:{})
      }));
      presented.results=movies;
      if(!listing.comingSoon)queueMovieLinks(movies);
      // Public requests must never write to D1. Movie indexing belongs to the sync job.
      const canonical=siteOrigin+listing.canonicalPath;
      const pageTitle=listing.title
        ?(listing.page>1?`${listing.title} — الصفحة ${listing.page} | سيما هَب`:`${listing.title} | سيما هَب`)
        :`${listing.name}${listing.page>1?' — الصفحة '+listing.page:''} | سيما هَب`;
      const breadcrumbs=[
        {'@type':'ListItem',position:1,name:'الرئيسية',item:siteOrigin+'/'},
        {'@type':'ListItem',position:2,name:'الأفلام',item:siteOrigin+'/movies/'},
        ...(listing.path!=='/movies/'?[{'@type':'ListItem',position:3,name:listing.name,item:canonical}]:[])
      ];
      const schemaGraph=[
        {
          '@type':'CollectionPage',
          '@id':canonical+'#page',
          url:canonical,
          name:listing.title||listing.name,
          description:listing.description,
          inLanguage:'ar',
          mainEntity:{
            '@type':'ItemList',
            itemListElement:movies.map((m,i)=>({
              '@type':'ListItem',
              position:(listing.page-1)*20+i+1,
              url:siteOrigin+m.public_path,
              name:m.display_title||m.title
            }))
          }
        },
        {
          '@type':'BreadcrumbList',
          itemListElement:breadcrumbs
        }
      ];
      const metadata={
        title:pageTitle,
        description:(listing.page>1?`الصفحة ${listing.page}: `:'')+listing.description,
        canonical,
        noindex:listing.noindex||!movies.length,
        image:movies[0]?.poster_path?siteOrigin+localImage(movies[0].poster_path):undefined,
        schema:{'@context':'https://schema.org','@graph':schemaGraph}
      };
      if(listing.page===1&&!listing.noindex)await seoCatalog.markCollection(metadata);
      return send(200,renderSeoPage(template,metadata,listingContent(listing,presented),movies));
    }
    if (url.pathname.startsWith('/api/')) {
      const forwarded=serverless&&(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']);
      const ip = (typeof forwarded==='string'?forwarded.split(',')[0].trim():null)||req.socket?.remoteAddress||'unknown';
      let client = clients.get(ip);
      if (!client || client.until < Date.now()) { client = {count: 0, until: Date.now() + 60000}; clients.set(ip, client); }
      if (++client.count > 120) { res.setHeader('Retry-After', '60'); return json(429, {error: 'طلبات كثيرة. أعد المحاولة بعد دقيقة.'}); }
      if (clients.size > 1000) for (const [key, value] of clients) if (value.until < Date.now()) clients.delete(key);
      const storyRoute=url.pathname.match(/^\/api\/tv-story\/([1-9]\d*)(?:\/season\/([1-9]\d*))?(?:\/episode\/([1-9]\d*))?$/);
      if(storyRoute){
        const [,id,season,episode]=storyRoute;
        if(episode&&!season)return json(400,{error:'الموسم مطلوب'});
        const parent=await tmdb(`tv/${id}`,new URLSearchParams({language:'ar-SA'}));
        const endpoint=`tv/${id}${season?`/season/${season}`:''}${episode?`/episode/${episode}`:''}`;
        const item=season?await tmdb(endpoint,new URLSearchParams({language:'ar-SA'})):parent;
        let overview=item.overview||'';
        if(!overview.trim()||hasUnsupportedText(overview)){
          try{
            let source=await tmdb(endpoint,new URLSearchParams({language:'en-US'})),language='en';
            if(!source.overview?.trim()&&parent.original_language&&!['ar','en'].includes(parent.original_language)){language=parent.original_language;source=await tmdb(endpoint,new URLSearchParams({language}));}
            overview=hasUnsupportedText(overview)?await cleanStory({...item,overview},source,translateSeries):await translateSeries({id:item.id||Number(id),text:source.overview,language})||'';
          }catch{ /* The page remains usable while story services are unavailable. */ }
        }
        return json(200,{overview,scope:episode?'episode':season?'season':'series',air_date:item.air_date||item.first_air_date,episode_count:item.episodes?.length});
      }
      const episodeLinks=url.pathname.match(/^\/api\/episode-links\/([1-9]\d*)\/([1-9]\d*)\/([1-9]\d*)$/);
      if(episodeLinks){
        try{const saved=JSON.parse(await readFile(new URL(`./data/series-links/${episodeLinks[1]}.json`,import.meta.url),'utf8'));const record=saved.episodes?.[`${episodeLinks[2]}-${episodeLinks[3]}`];const sources=await managedSources({id:Number(episodeLinks[1]),media_type:'tv'},[record].filter(Boolean),{season:Number(episodeLinks[2]),episode:Number(episodeLinks[3])});return json(200,{playback:sources.flatMap(r=>r.playback||[]).filter(l=>safeLink(l.url)),downloads:sources.flatMap(r=>r.downloads||[]).filter(l=>safeLink(l.url))});}catch(e){if(e.code!=='ENOENT')throw e;return json(200,{playback:[],downloads:[]});}
      }
      if(url.pathname==='/api/recent'){
        return json(200,await recentData(url.searchParams.get('page')));
      }
      if(url.pathname==='/api/latest-tv'){const updates=await latestTV();const [episodes,seasons]=await Promise.all([presentSeries({results:updates.episodes},'discover/tv',tmdb),presentSeries({results:updates.seasons},'discover/tv',tmdb)]);return json(200,{episodes:episodes.results,seasons:seasons.results});}
      const linkStatus=url.pathname.match(/^\/api\/movie-links\/([1-9]\d*)$/);
      if(linkStatus){const sources=await movieLinks(Number(linkStatus[1]));return json(200,{available:sources.some(r=>[...(r.playback||[]),...(r.downloads||[])].some(l=>safeLink(l.url)))});}
      let route;
      try { route = routeApi(url); } catch (error) { return json(400, {error: error.message}); }
      if (!route) return json(404, {error: 'الصفحة غير موجودة'});
      if(route.endpoint==='search/multi'){
        const data=await searchData(route.params);
        if(Number.isFinite(data.total_pages))data.total_pages=Math.min(data.total_pages,MAX_LISTING_PAGES);
        return json(200,data);
      }
      let data = await tmdb(route.endpoint, route.params);
      const seasonRoute=route.endpoint.match(/^tv\/(\d+)\/season\/(\d+)$/);
      if(seasonRoute){if(dbEnabled()&&(await query('SELECT status FROM content_items WHERE key=$1',['tv:'+seasonRoute[1]])).rows[0]?.status!=='published')return json(404,{error:'العمل غير موجود'});data=await applySeasonParts(data,'tv:'+seasonRoute[1],Number(seasonRoute[2]));}
      if (route.endpoint.match(/^(movie|tv)\/\d+$/) && !data.videos?.results?.length) {
        try { data.videos = await tmdb(`${route.endpoint}/videos`, new URLSearchParams({language: 'en-US'})); } catch { /* Details stay available if trailers fail. */ }
      }
      const presented=await presentSeries(await applyMoviePresentation(data, route.endpoint, tmdb, translateMovie),route.endpoint,tmdb);
      if(!presented)return json(404,{error:'العمل غير موجود'});
      if(Number.isFinite(presented.total_pages))presented.total_pages=Math.min(presented.total_pages,MAX_LISTING_PAGES);
      queueMovieLinks([...(presented.results||[]),...(presented.recommendations?.results||[]),presented]);
      return json(200, presented);
    }
    if(['/dmca/','/terms/'].includes(url.pathname)){
      const filename=url.pathname==='/dmca/'?'dmca.html':'terms.html';
      const [template,page]=await Promise.all([siteTemplate(),readFile(path.join(root,filename),'utf8')]);
      const title=page.match(/<title>(.*?)<\/title>/s)?.[1]||'سيما هَب';
      const article=page.match(/<main class="legal-page">([\s\S]*?)<\/main>/)?.[1]||'';
      const content=`<div class="content legal-layout"><article class="legal-page">${article}</article></div>`;
      const metadata={title,description:filename==='dmca.html'?'سياسة حقوق النشر وتقديم البلاغات على سيما هَب.':'شروط استخدام موقع سيما هَب.',canonical:siteOrigin+url.pathname,schema:{'@context':'https://schema.org','@type':'WebPage',name:title,url:siteOrigin+url.pathname}};
      return send(200,renderSeoPage(template,metadata,content).replace('data-server-rendered="true"','data-server-rendered="true" data-page-kind="legal"'));
    }
    if(url.pathname==='/anime'||url.pathname==='/anime/')return redirect('/anime/movies/'+url.search);
    if(url.pathname==='/series-genre/animation/')return redirect('/anime/series/'+url.search);
    if(categoryPaths.includes(url.pathname+'/'))return redirect(url.pathname+'/'+url.search);
    if(categoryPaths.includes(url.pathname)){
      const listing=parseCategoryListing(url);
      if(!listing)return json(404,{error:'الصفحة غير موجودة'});
      const requestPath=listingRequestPath(url,listing.canonicalPath);
      if(url.pathname+url.search!==requestPath)return redirect(requestPath);
      const raw=await tmdb(`discover/${listing.type}`,listing.params);
      const totalPages=Math.max(1,Math.min(raw.total_pages||1,MAX_LISTING_PAGES));
      if(listing.page>totalPages)return json(404,{error:'الصفحة غير موجودة'});
      const presented=await presentSeries(raw,`discover/${listing.type}`,tmdb);
      const items=categoryItems(presented,listing);
      const template=await siteTemplate();
      const metadata=categoryMetadata(listing,items,siteOrigin);
      if(listing.page===1&&!listing.noindex)await seoCatalog.markCollection(metadata);
      return send(200,renderSeoPage(template,metadata,categoryContent(listing,items,totalPages),items.map(m=>({...m,media_type:listing.type}))).replace('data-server-rendered="true"',`data-server-rendered="true" data-page-kind="${listing.anime?'anime':'tv'}"`));
    }
    if(publicPages[url.pathname+'/'])return redirect(url.pathname+'/'+url.search);
    if(publicPages[url.pathname]||url.pathname==='/'){
      let page;
      const present=async(raw,endpoint)=>presentSeries(await applyMoviePresentation(raw,endpoint,tmdb),endpoint,tmdb);
      if(url.pathname==='/'){
        const groups=[];
        if(process.env.TMDB_API_KEY){
          const specs=[['الأفلام الرائجة','/movies/','trending/movie/week',{}],['مسلسلات رائجة','/series/','trending/tv/week',{}],['أفلام أنمي','/anime/movies/','discover/movie',{with_genres:'16',sort_by:'popularity.desc'}],['مسلسلات أنمي','/anime/series/','discover/tv',{with_genres:'16',sort_by:'popularity.desc'}]];
          const results=await Promise.allSettled(specs.map(async([name,path,endpoint,extra])=>({name,path,items:(await present(await tmdb(endpoint,new URLSearchParams({language:'ar-SA',include_adult:'false',...extra})),endpoint)).results.filter(m=>!m.adult).slice(0,12)})));
          for(const result of results)if(result.status==='fulfilled')groups.push(result.value);
          try{const recent=await recentData(1);groups.unshift({name:'المضافة حديثًا',path:'/recent/',items:recent.results});}catch{}
          if(!groups.length)throw Object.assign(new Error('تعذّر تحميل محتوى الصفحة. حاول مجددًا.'),{status:503});
        }
        page=homePage(groups,siteOrigin);
      }else{
        const n=Number(url.searchParams.get('page')||1);
        if(!Number.isInteger(n)||n<1||n>MAX_LISTING_PAGES)return json(404,{error:'الصفحة غير موجودة'});
        let data;
        if(url.pathname==='/recent/')data=await recentData(n);
        else if(['/episodes/','/seasons/'].includes(url.pathname)){
          const updates=await latestTV(),key=url.pathname==='/episodes/'?'episodes':'seasons';
          const results=(await presentSeries({results:updates[key]},'discover/tv',tmdb)).results;
          data={page:n,page_size:20,total_pages:Math.max(1,Math.ceil(results.length/20)),results:results.slice((n-1)*20,n*20)};
        }else{
          const type=url.searchParams.get('type')||'movie';
          if(!['movie','tv'].includes(type))return json(404,{error:'قسم غير موجود'});
          const search=url.pathname==='/search/',q=(url.searchParams.get('q')||'').trim();
          if(search&&(!q||q.length>120))data={page:1,total_pages:1,results:[]};
          else{
            const endpoint=search?'search/multi':`discover/${type}`;
            const params=new URLSearchParams({language:'ar-SA',include_adult:'false',page:String(n),...(search?{query:q}:{sort_by:'vote_average.desc','vote_count.gte':'200'})});
            data=search?await searchData(params):await present(await tmdb(endpoint,params),endpoint);
            data.total_pages=Math.min(data.total_pages||1,MAX_LISTING_PAGES);
          }
        }
        data.total_pages=Math.min(data.total_pages||1,MAX_LISTING_PAGES);
        if(n>data.total_pages)return json(404,{error:'الصفحة غير موجودة'});
        page=collectionPage(url.pathname,data,siteOrigin,url.searchParams);
        const requestPath=listingRequestPath(url,page.metadata.canonical.slice(siteOrigin.length));
        // Hosts can reconstruct spaces as %20 even when the browser sent +.
        // Compare decoded search parameters to avoid redirecting to the same URL.
        const actualPath=url.pathname==='/search/'?url.pathname+(url.searchParams.size?'?'+url.searchParams:''):url.pathname+url.search;
        if(actualPath!==requestPath)return redirect(requestPath);
      }
      const template=await siteTemplate();
      return send(200,renderSeoPage(template,page.metadata,page.content,page.items).replace('data-server-rendered="true"',`data-server-rendered="true" data-page-kind="${url.pathname==='/'?'home':url.pathname.split('/')[1]}"`));
    }
    return json(404, {error: 'الصفحة غير موجودة'});
  } catch (error) {
    if(!(error instanceof URIError)&&(!error.status||error.status>=500))console.error('Public request failed',JSON.stringify({path:req.url.split('?')[0],name:error.name,code:error.code,stack:error.stack?.split('\n').slice(1,5).map(line=>line.replace(/https?:\/\/\S+/g,'[remote URL]'))}));
    json(error instanceof URIError?400:error.status || 502, {error: error instanceof URIError?'عنوان الصفحة غير صالح':error.status ? error.message : 'تعذّر الاتصال بخدمة الأفلام. حاول مجددًا.'});
  }
  });
}
export const server = http.createServer(handleRequest);
server.on('listening',()=>{if(serverless)return;if(dbEnabled())void initializeAdministration().catch(e=>console.warn('Administration startup:',e.code||'unavailable'));else if(process.env.TMDB_API_KEY){void linkSync.start().catch(e=>console.warn('Link sync:',e.message));sourceDiscovery.start();}});
server.on('close',()=>{clearInterval(scheduledSync);linkSync.stop();sourceDiscovery.stop();});
if (!serverless && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(Number(process.env.PORT) || 3000, process.env.HOST || '127.0.0.1', () => console.log(`CimaHub ready at http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`));
}
