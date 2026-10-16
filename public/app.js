import {workTitleMarkup} from './title-markup.js';
import {mediaLink,seriesLink} from './media-links.js';
import {localImage as image,posterPlaceholder} from './media-images.js';
import {enhanceFilters} from './filter-controls.js';
import {pagination,MAX_LISTING_PAGES} from './pagination.js';
import {homeCarousel,homeIntroduction,enhanceHomeCarousel} from './home-carousel.js';
import {initSiteNavigation} from './navigation.js';
const $ = (selector) => document.querySelector(selector);
const icons = {download:'<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',play:'<path d="m9 5 11 7-11 7z"/>',arrow:'<path d="m14 6-6 6 6 6M8 12h13"/>',film:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.film}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title = m => {
  const display=/ — يعرض قريبًا(?:$| —)/.test(m.display_title||'')?['مشاهدة فيلم'+(animated(m)?' أنمي':''),m.title||m.original_title||'بدون عنوان',year(m),m.original_language==='ar'?'':'مترجم'].filter(Boolean).join(' '):m.display_title;
  return display?(display.startsWith('مشاهدة ')?display:`مشاهدة ${display}`):m.series_display_title||m.title||m.name||'بدون عنوان';
};
const kind = m => m.media_type === 'tv' || (!m.media_type && m.name) ? 'tv' : 'movie';
const animated = m => (m.genre_ids||m.genres?.map(g=>g.id)||[]).includes(16);
const animationLabel = m => kind(m)==='tv'?'مسلسل أنمي':'فيلم أنمي';
const detailLink = mediaLink;
const key = m => `${kind(m)}-${m.id}`;
const year = m => (m.release_date || m.first_air_date || '').slice(0,4);
const futureMovie = m => {
  if(kind(m)!=='movie'||!/^\d{4}-\d{2}-\d{2}$/.test(m.release_date||''))return false;
  const date=new Date(m.release_date+'T00:00:00Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===m.release_date&&m.release_date>new Date().toISOString().slice(0,10);
};
const upcomingPosterBadge = m => futureMovie(m)?'<span class="poster-upcoming">قريبًا</span>':'';
const score = m => m.vote_average ? Number(m.vote_average).toFixed(1) : '—';
const items = new Map();
let genres = {}, routeVersion = 0, currentPage = 1, totalPages = 1, listEndpoint = '', featured = [], featuredIndex = 0, toastTimer;
const main = $('#main');
initSiteNavigation();
enhanceFilters();
enhanceHomeCarousel(main);
new MutationObserver(()=>{enhanceFilters(main);enhanceHomeCarousel(main);}).observe(main,{childList:true,subtree:true});
const modal = $('#modal');
$('.skip').addEventListener('click',event=>{event.preventDefault();main.focus();main.scrollIntoView();});
function notify(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3000); }
async function api(url) { for(let attempt=0;attempt<3;attempt++){ try { const response=await fetch(url,{signal:AbortSignal.timeout(60000)}); const data=await response.json(); if(!response.ok){if(response.status>=500&&attempt<2)continue;throw new Error(data.error||'تعذّر تحميل المحتوى');} return data; } catch(error){if(attempt===2)throw new Error(error instanceof TypeError||error.name==='TimeoutError'?'تعذّر الاتصال بالخادم. حاول مجددًا بعد قليل.':error.message);await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));} } }
function register(m, type) { const normalized = {...m, media_type:m.media_type || type || kind(m)}; items.set(key(normalized), normalized); return normalized; }
const uniqueMedia=list=>{const ids=new Set(),identities=new Set();return list.filter(m=>{const id=key(m),identity=[kind(m),(m.original_title||m.original_name||m.title||m.name||'').toLowerCase(),year(m),m.poster_path||m.id].join('|');if(ids.has(id)||identities.has(identity))return false;ids.add(id);identities.add(identity);return true;});};
function card(raw, type) {
  const m = register(raw, type), name = title(m), poster = image(m.poster_path);
  return `<article class="card ${m.movie_presentation_version ? 'movie-card' : ''}"><a class="poster-link" href="${detailLink(m)}" title="${esc(name)}" aria-label="تفاصيل ${esc(name)}">${poster ? `<img src="${poster}" alt="${esc(name)}" loading="lazy" width="300" height="450">` : posterPlaceholder(m.title||m.name,year(m))}<span class="poster-type">${animated(m)?animationLabel(m):kind(m) === 'tv' ? 'مسلسل' : 'فيلم'}</span>${upcomingPosterBadge(m)}<span class="poster-rating">★ <span>${score(m)}</span></span></a><h3><a href="${detailLink(m)}" dir="rtl">${workTitleMarkup(name,m)}</a></h3><div class="card-info"><span>${year(m)}</span><span>${esc((m.genre_ids || m.genres?.map(g=>g.id) || []).slice(0,2).map(id=>genres[id]).filter(Boolean).join(' • '))}</span></div></article>`;
}
function heading(name, description='', link='') { return `<div class="section-heading"><div><h2>${name}</h2>${description ? `<p>${description}</p>` : ''}</div>${link ? `<a class="view-all-button" href="${link}"><span>عرض الكل</span></a>` : ''}</div>`; }
function skeleton() { return `<div class="content" aria-label="جارٍ التحميل" aria-busy="true"><div class="loading-heading"></div><div class="grid">${'<div class="skeleton"></div>'.repeat(12)}</div></div>`; }
function empty(name, description, action='') { return `<div class="empty">${icon('film')}<h2>${name}</h2><p>${description}</p>${action}</div>`; }
function meta(m) { return `<div class="meta"><span class="rating">★ ${score(m)} ${m.movie_presentation_version ? '' : '<small>TMDB</small>'}</span><span class="divider"></span><span>${year(m)}</span><span class="divider"></span><span>${kind(m)==='tv'?'مسلسل':'فيلم'}</span>${m.runtime?`<span class="divider"></span><span>${m.runtime} دقيقة</span>`:''}<span class="badge">${esc(languageName(m.original_language))}</span></div>`; }
function hero(m, detail = false) {
  register(m);
  const background = image(m.backdrop_path, 'original');
  return `<section class="hero ${detail?'detail-hero'+(kind(m)==='tv'?' series-detail-hero':''):''}" aria-label="${detail?'تفاصيل العمل':'اختيارات الأسبوع'}">${background ? `<img class="hero-image" src="${background}" alt="" fetchpriority="high">` : ''}${detail&&kind(m)==='tv'&&image(m.poster_path)?`<img class="series-mobile-cover" src="${image(m.poster_path)}" alt="${esc(title(m))}" width="150" height="225">`:''}<div class="hero-content"><div class="eyebrow"><span class="dot"></span>${detail ? `<a href="${animated(m)?(kind(m)==='movie'?'/anime/movies/':'/anime/series/'):kind(m)==='tv'?'/series/':'/movies/'}">${animated(m)?(kind(m)==='tv'?'مسلسلات أنمي':'أفلام أنمي'):kind(m)==='tv'?'المسلسلات':'الأفلام'}</a> / ${esc(m.genres?.map(g=>g.name).slice(0,3).join(' • ') || 'تفاصيل العمل')}`:'تحت الأضواء هذا الأسبوع'}</div><h1 dir="auto">${esc(title(m))}</h1>${m.movie_presentation_version ? '' : `<div class="original-title" dir="auto">${esc(m.original_title || m.original_name || '')}</div>`}${meta(m)}${detail||m.separate_story?'':`<p>${esc(m.overview || 'اكتشف قصة هذا العمل وتفاصيله الكاملة.')}</p>`}<div class="actions">${detail ? `<button class="primary" data-trailer="${key(m)}">${icon('play')} الإعلان التشويقي</button>` : `<a class="primary" href="${detailLink(m)}">${icon('play')} مشاهدة العمل</a>`}</div></div>${!detail ? `<div class="hero-bottom"><span class="hero-index">0${featuredIndex+1} / 0${featured.length}</span><div class="slide-progress">${featured.map((_,i)=>`<button data-slide="${i}" class="${i===featuredIndex?'active':''}" aria-label="اختيار العمل ${i+1}" aria-pressed="${i===featuredIndex}"></button>`).join('')}</div><button data-next-slide aria-label="العمل التالي">←</button></div>`:''}</section>`;
}
const seriesCategories={ 'english-series':['foreign','مسلسلات أجنبية'],'asian-series':['asian','مسلسلات آسيوية'],'arabic-series':['arabic','مسلسلات عربية'],'indian-series':['indian','مسلسلات هندية'],'turkish-series':['turkish','مسلسلات تركية'] };
const seriesGenres={action:[10759,'أكشن ومغامرة'],crime:[80,'جريمة'],drama:[18,'دراما'],comedy:[35,'كوميديا'],mystery:[9648,'غموض'],'sci-fi-fantasy':[10765,'خيال علمي وفانتازيا'],animation:[16,'أنمي'],family:[10751,'عائلي'],documentary:[99,'وثائقي'],kids:[10762,'أطفال'],news:[10763,'أخبار'],reality:[10764,'تلفزيون الواقع'],soap:[10766,'دراما يومية'],talk:[10767,'برامج حوارية'],'war-politics':[10768,'حرب وسياسة'],western:[37,'ويسترن']};
function seriesCategory(m){const language=m.original_language;const slug=language==='ar'?'arabic-series':language==='tr'?'turkish-series':['hi','ta','te','ml','bn'].includes(language)?'indian-series':['ja','ko','zh','th','zh-cn','zh-tw'].includes(language)?'asian-series':'english-series';return `<a href="/series-category/${slug}/">${seriesCategories[slug][1]}</a>`;}
function seriesGenreLinks(m){return (m.genres||[]).map(g=>{const entry=Object.entries(seriesGenres).find(([,v])=>v[0]===g.id);return entry?`<a href="/series-genre/${entry[0]}/">${entry[1][1]}</a>`:esc(g.name);}).join('، ')||'غير متاح';}
const categoryLinks='';
const updateCard=(m,episode)=>{const label=`${animated(m)?animationLabel(m):'مسلسل'} ${m.original_name||m.name}${episode?'':' '+year(m)} الموسم ${seasonLabel(m.season_number)}${episode?` الحلقة ${m.episode_number}`:''}${m.original_language==='ar'?'':episode?' مترجمة':' مترجم كامل'}`;return `<article class="card"><a class="poster-link" href="/#/details/tv/${m.id}/season/${m.season_number}${episode?`/episode/${m.episode_number}`:''}" title="${esc(label)}" aria-label="${esc(label)}">${image(m.poster_path)?`<img src="${image(m.poster_path)}" alt="${esc(label)}" loading="lazy" width="300" height="450">`:posterPlaceholder(m.title||m.name,year(m))}<span class="poster-type">${episode?`الحلقة ${esc(m.episode_number)}`:'موسم'}</span></a><h3><a href="/#/details/tv/${m.id}/season/${m.season_number}${episode?`/episode/${m.episode_number}`:''}">${esc(label)}</a></h3><div class="card-info"><time datetime="${esc(m.air_date)}">${esc(m.air_date)}</time></div></article>`;};
async function recentListing(params,version){
 const d=await api('/api/recent?page='+encodeURIComponent(params.get('page')||1));if(version!==routeVersion)return;
 main.innerHTML=`<div class="content"><div class="page-heading"><h1>المضافة حديثًا</h1><p>الأفلام والحلقات حسب تاريخ الصدور، الأحدث أولًا</p></div><div class="grid">${d.results.map(m=>m.media_type==='tv'?updateCard(m,true):card(m,'movie')).join('')}</div>${d.results.length?'':'<p>لا توجد إضافات متاحة حاليًا.</p>'}${pagination(d.page,d.total_pages,n=>`/recent/?page=${n}`)}</div>`;
 
}
async function updatesListing(page,params,version){
 const d=await api('/api/latest-tv');if(version!==routeVersion)return;
 const episode=page==='episodes',items=episode?d.episodes:d.seasons,number=Math.max(1,Number(params.get('page'))||1),size=12;
 main.innerHTML=`<div class="content"><div class="page-heading"><h1>${episode?'آخر الحلقات':'آخر المواسم'}</h1></div><div class="grid">${items.slice((number-1)*size,number*size).map(m=>updateCard(m,episode)).join('')}</div>${pagination(number,Math.ceil(items.length/size),n=>`/#/${page}?page=${n}`)}</div>`;
}
async function home(version) {
  const [trend, movies, shows, anime] = await Promise.all([api('/api/home'),api('/api/browse?type=movie&latest=1'),api('/api/browse?type=tv&latest=1'),api('/api/browse?type=tv&anime=1&latest=1')]);
  if (version !== routeVersion) return;
  const trends = trend.results.filter(m=>['movie','tv'].includes(m.media_type));
  const latestSection=(id,name,data,type,link)=>`<section class="section-gap" id="${id}" aria-label="${name}">${heading(name,'',link)}<div class="grid">${uniqueMedia(data.results).slice(0,12).map(m=>card(m,type)).join('')}</div></section>`;
  const latestSections=latestSection('latest-movies','آخر الأفلام',movies,'movie','/movies/?sort=primary_release_date.desc')+latestSection('latest-series','مسلسلات جديدة',shows,'tv','/series/?sort=first_air_date.desc')+latestSection('latest-anime','آخر الأنمي',anime,'tv','/anime/series/?sort=first_air_date.desc');
  main.innerHTML = `${homeCarousel(trends)}<div class="content">${homeIntroduction}<section class="section-gap" id="home-recent" aria-label="المضافة حديثًا">${heading('المضافة حديثًا','','/recent/')}<div class="grid" aria-busy="true">${'<div class="skeleton"></div>'.repeat(12)}</div></section>${latestSections}<div id="latest-tv-updates" aria-live="polite"><section class="section-gap">${heading('آخر الحلقات')}<p>جارٍ التحميل…</p></section><section class="section-gap">${heading('آخر المواسم')}<p>جارٍ التحميل…</p></section></div><section class="section-gap">${heading('الرائج الآن','الأعمال التي يتحدث عنها الجميع','#/top')}<div class="filter-bar"><div class="tabs" aria-label="تصنيف الأعمال الرائجة"><button class="tab active" data-trending="all">الكل</button><button class="tab" data-trending="movie">أفلام</button><button class="tab" data-trending="tv">مسلسلات</button><button class="tab" data-trending="16">أنمي وكرتون</button></div><span class="live-caption"><i></i> الأكثر تداولًا هذا الأسبوع</span></div><div class="grid" id="trending-grid">${trends.slice(0,12).map(m=>card(m)).join('')}</div></section></div>`;
  void api('/api/recent').then(data=>{
    if(version!==routeVersion)return;
    const section=$('#home-recent');
    section.innerHTML=heading('المضافة حديثًا','','/recent/')+(data.results.length?`<div class="grid">${data.results.map(m=>m.media_type==='tv'?updateCard(m,true):card(m,'movie')).join('')}</div>`:'<p>لا توجد أعمال متاحة حاليًا.</p>');
    
  }).catch(()=>{if(version===routeVersion)$('#home-recent').innerHTML=heading('المضافة حديثًا','','/recent/')+'<p>تعذّر تحميل الأعمال. أعد تحميل الصفحة للمحاولة مجددًا.</p>';});
  void api('/api/latest-tv').then(updates=>{ 
    if(version!==routeVersion)return;

    $('#latest-tv-updates').innerHTML=[['latest-episodes','آخر الحلقات',updates.episodes,true],['latest-seasons','آخر المواسم',updates.seasons,false]].map(([id,name,list,episode])=>`<section class="section-gap" id="${id}" aria-label="${name}">${heading(name,'',episode?'#/episodes':'#/seasons')}${list.length?`<div class="grid">${list.slice(0,12).map(m=>updateCard(m,episode)).join('')}</div>`:'<p>لا توجد تحديثات متاحة حاليًا.</p>'}</section>`).join('');
  }).catch(()=>{if(version===routeVersion)$('#latest-tv-updates').innerHTML='<section class="section-gap"><h2>آخر الحلقات والمواسم</h2><p>تعذّر تحميل التحديثات، أعد تحميل الصفحة للمحاولة مجددًا.</p></section>';});
  document.querySelectorAll('[data-trending]').forEach(button=>button.addEventListener('click',()=>{ document.querySelectorAll('[data-trending]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});const filter=button.dataset.trending; const filtered=trends.filter(m=>filter==='all'||m.media_type===filter||(filter==='16'&&m.genre_ids?.includes(16))); $('#trending-grid').innerHTML=filtered.length?filtered.slice(0,12).map(m=>card(m)).join(''):empty('لا توجد أعمال رائجة في هذا القسم','تصفح قسم الأنمي لاكتشاف المزيد.','<a href="/anime/series/" class="secondary">تصفح الأنمي</a>');}));
  
}
const pageNames = {recent:'المضافة حديثًا',movies:'عالم الأفلام',tv:'المسلسلات',anime:'عالم الأنمي',top:'الأعلى تقييمًا',search:'نتائج البحث'};
async function listing(page, params, version) {
  const type = page==='tv'||page==='anime'?'tv':params.get('type')==='tv'?'tv':'movie';
  const query = new URLSearchParams({type,sort:params.get('sort')||(page==='top'?'vote_average.desc':'popularity.desc')});
  ['genre','year','region'].forEach(k=>{if(params.get(k))query.set(k,params.get(k));}); if(page==='anime')query.set('anime','1');
  listEndpoint=page==='search'?`/api/search?q=${encodeURIComponent(params.get('q')||'')}`:`/api/browse?${query}`;
  currentPage=Math.max(1,Math.min(MAX_LISTING_PAGES,Number(params.get('page'))||1));
  const data=await api(`${listEndpoint}&page=${currentPage}`); if(version!==routeVersion)return;
  totalPages=Math.min(data.total_pages,MAX_LISTING_PAGES);
  const media=uniqueMedia(data.results.filter(m=>m.media_type!=='person'));
  const renderedIds=new Set(media.map(key));
  const select=(label,name,options,selected='')=>`<select aria-label="${label}" name="${name}">${options.map(([value,text])=>`<option value="${value}" ${value===selected?'selected':''}>${esc(text)}</option>`).join('')}</select>`;
  const filterUI=page==='search'?'':`<form class="filters" id="filters">${page==='top'?select('نوع العمل','type',[['movie','أفلام'],['tv','مسلسلات']],type):''}${select('التصنيف','genre',[['','كل التصنيفات'],...Object.entries(genres).filter(([id])=>type==='movie'?!['10759','10765','10766','10768','10763','10764','10767','10762'].includes(id):!['28','12','878','14','53','10752','10402','36','10749'].includes(id))],params.get('genre')||'')}${select('سنة الإصدار','year',[['','كل السنوات'],...Array.from({length:50},(_,i)=>[String(new Date().getFullYear()-i),String(new Date().getFullYear()-i)])],params.get('year')||'')}${select('منطقة العمل','region',[['','كل الأقسام'],['foreign','أجنبي'],['arabic','عربي'],['indian','هندي'],['asian','آسيوي'],['turkish','تركي']],params.get('region')||'')}${select('ترتيب النتائج','sort',[['popularity.desc','الأكثر شعبية'],['vote_average.desc','الأعلى تقييمًا'],[type==='tv'?'first_air_date.desc':'primary_release_date.desc','الأحدث إصدارًا']],query.get('sort'))}<a class="filter-reset" href="/#/${page}">مسح الفلاتر</a></form>`;
  main.innerHTML=`<div class="content"><div class="page-heading"><h1>${page==='tv'&&params.get('genre')?'مسلسلات '+(Object.values(seriesGenres).find(v=>String(v[0])===params.get('genre'))?.[1]||''):page==='tv'&&params.get('region')?({'foreign':'مسلسلات أجنبية','arabic':'مسلسلات عربية','asian':'مسلسلات آسيوية','indian':'مسلسلات هندية','turkish':'مسلسلات تركية'}[params.get('region')]||pageNames[page]):pageNames[page]}</h1><p>${page==='search'?`نتائج البحث عن «${esc(params.get('q'))}»`:'مشاهدة وتحميل الأفلام والمسلسلات والأنمي كاملة ومترجمة بجودة عالية HD اون لاين على سيما هَب.'}</p></div>${page==='tv'?categoryLinks:''}${filterUI}${page==='search'&&data.corrected_query?`<p class="search-correction">نعرض نتائج قريبة لكلمة <a href="/search/?q=${encodeURIComponent(data.corrected_query)}"><bdi>${esc(data.corrected_query)}</bdi></a></p>`:''}<div class="grid catalog-grid" id="listing-grid">${media.map(m=>card(m,type)).join('')}</div>${!media.length?empty('لا توجد نتائج تطابق هذه الفلاتر','جرّب تغيير النوع أو السنة، أو امسح الفلاتر لعرض جميع الأعمال.',`<a class="secondary" href="/#/${page}">مسح الفلاتر</a>`):''}${pagination(currentPage,totalPages,n=>{const q=new URLSearchParams(params);q.set('page',n);return location.hash?`/#/${page}?${q}`:`${location.pathname}?${q}`;})}</div>`;
  $('#filters')?.addEventListener('change',()=>{const values=new URLSearchParams(new FormData($('#filters')));if(page==='tv'){const category=Object.entries(seriesCategories).find(([,v])=>v[0]===values.get('region'));const genre=Object.entries(seriesGenres).find(([,v])=>String(v[0])===values.get('genre'));if(genre){values.delete('genre');location.href=`/series-genre/${genre[0]}/?${values}`;return;}if(category){values.delete('region');location.href=`/series-category/${category[0]}/?${values}`;return;}}location.href=`/#/${page}?${values}`;});

  
}
const seasonLabel=n=>({1:'الأول',2:'الثاني',3:'الثالث',4:'الرابع',5:'الخامس',6:'السادس',7:'السابع',8:'الثامن',9:'التاسع',10:'العاشر'}[n]||String(n));
function seasonEpisodesMarkup(m,selected){
  const seasons=(m.seasons||[]).filter(s=>s.season_number>0).sort((a,b)=>b.season_number-a.season_number);
  const seasonCards=seasons.map(season=>{
    const name=`${animated(m)?animationLabel(m):'مسلسل'} ${m.original_name||m.name} ${year(m)} الموسم ${seasonLabel(season.season_number)}${m.original_language==='ar'?'':' مترجم'} كامل`;
    const href=`/#/details/tv/${m.id}/season/${season.season_number}`;
    const poster=image(season.poster_path||m.poster_path);
    return `<article class="card season-card"><a class="poster-link" href="${href}" ${season.season_number===selected?'aria-current="page"':''} title="${esc(name)}" aria-label="${esc(name)}">${poster?`<img src="${poster}" alt="${esc(name)}" loading="lazy" width="300" height="450">`:posterPlaceholder(m.title||m.name,year(m))}<span class="poster-type">الموسم ${seasonLabel(season.season_number)}</span></a><h3><a href="${href}">${esc(name)}</a></h3></article>`;
  }).join('');
  return `${selected?`<section class="season-episodes" aria-labelledby="season-episodes-heading"><div class="section-heading"><h2 id="season-episodes-heading">حلقات الموسم</h2></div><div id="season-episode-list" class="episode-grid" aria-live="polite">${seasons.length?'جارٍ تحميل الحلقات…':'لم تتوفر حلقات لهذا المسلسل بعد.'}</div><div id="episode-summary" hidden></div></section>`:''}${seasons.length?`<section class="series-seasons" aria-labelledby="series-seasons-heading"><div class="section-heading"><h2 id="series-seasons-heading">مواسم المسلسل</h2></div><div class="grid">${seasonCards}</div></section>`:''}`;

}
function bindSeasonEpisodes(m,version,season){
  if(!season)return;
  let request=0;
  const load=async()=>{
    const current=++request,list=$('#season-episode-list');
    list.setAttribute('aria-busy','true');list.textContent='جارٍ تحميل الحلقات…';$('#episode-summary').hidden=true;
    try{
      const data=await api(`/api/tv/${m.id}/season/${season}`);
      if(version!==routeVersion||current!==request)return;
      const episodes=(data.episodes||[]).filter(e=>Number.isInteger(e.episode_number)&&e.episode_number>0).sort((a,b)=>a.episode_number-b.episode_number);
      list.innerHTML=episodes.length?episodes.map(e=>`<a class="episode-button" href="/#/details/tv/${m.id}/season/${season}/episode/${e.episode_number}"${location.hash.endsWith(`/episode/${e.episode_number}`)?' aria-current="page"':''}>حلقة ${e.episode_number}</a>`).join(''):'لم تتوفر حلقات لهذا الموسم بعد.';
    }catch{if(version===routeVersion&&current===request){list.innerHTML='<button class="secondary" data-retry-season>تعذّر تحميل الحلقات — إعادة المحاولة</button>';list.querySelector('button').addEventListener('click',load);}}
    finally{if(version===routeVersion&&current===request)list.removeAttribute('aria-busy');}
  };
  void load();
}
function languageName(code){try{return new Intl.DisplayNames(['ar'],{type:'language'}).of(code)||'غير متاح';}catch{return 'غير متاح';}}
function countryName(code){try{return new Intl.DisplayNames(['ar'],{type:'region'}).of(code)||'غير متاح';}catch{return 'غير متاح';}}
async function details(type,id,version,requestedSeason,requestedEpisode) {
  const data=await api(`/api/details/${type}/${id}`);if(version!==routeVersion)return;const m=register(data,type);if(m.public_path){location.replace(seriesLink(m,requestedSeason,requestedEpisode));return;}
  let selectedSeason,episodeContent='',storyContent='',episodeDownloads=false;
  if(type==='tv'){
    const seasons=(m.seasons||[]).filter(s=>s.season_number>0).sort((a,b)=>a.season_number-b.season_number);
    selectedSeason=requestedSeason;
    if(requestedSeason&&!seasons.some(s=>s.season_number===requestedSeason)){main.innerHTML=empty('هذا الموسم غير موجود','اختر أحد مواسم المسلسل.');return;}

    const seriesName=m.original_name||m.name;
    const seriesPrefix=animated(m)?animationLabel(m):'مسلسل';
    m.name=selectedSeason?`${seriesPrefix} ${seriesName} ${year(m)} الموسم ${seasonLabel(selectedSeason)}${m.original_language==='ar'?'':' مترجم'} كامل`:`${seriesPrefix} ${seriesName} ${year(m)}${m.original_language==='ar'?'':' مترجم'} كامل`;
    const seasonInfo=seasons.find(s=>s.season_number===selectedSeason);
    if(seasonInfo?.poster_path)m.poster_path=seasonInfo.poster_path;
    if(requestedEpisode&&selectedSeason){
      const seasonData=await api(`/api/tv/${id}/season/${selectedSeason}`);if(version!==routeVersion)return;
      const episodes=(seasonData.episodes||[]).sort((a,b)=>a.episode_number-b.episode_number),index=episodes.findIndex(e=>e.episode_number===requestedEpisode),episode=episodes[index];
      if(!episode){main.innerHTML=empty('الحلقة غير موجودة','ارجع إلى صفحة الموسم لاختيار حلقة متاحة.',`<a class="secondary" href="/#/details/tv/${id}/season/${selectedSeason}">حلقات الموسم</a>`);return;}
      m.name=`${seriesPrefix} ${seriesName} ${year(m)} الموسم ${seasonLabel(selectedSeason)} الحلقة ${requestedEpisode}${m.original_language==='ar'?'':' مترجمة'}`;
      m.overview=episode.overview||m.overview;
      const episodeLink=(e,label)=>e?`<a class="secondary" href="/#/details/tv/${id}/season/${selectedSeason}/episode/${e.episode_number}">${label}</a>`:'';
      const links=await api(`/api/episode-links/${id}/${selectedSeason}/${requestedEpisode}`);if(version!==routeVersion)return;
      episodeDownloads=links.downloads.length>0;
      const serverLinks=(list,label)=>list.length?`<section class="movie-sources"><h2>${label}</h2><div class="source-links">${list.map((l,i)=>`<a class="secondary download-server" href="${esc(l.url)}" target="_blank" rel="nofollow noopener noreferrer">${icon('download')}<span>سيرفر ${i+1}</span></a>`).join('')}</div></section>`:'';
      const episodePlayer=links.playback.length?`<section class="movie-sources"><h2>مشاهدة الحلقة</h2><div id="film-player" class="movie-player"><iframe src="${esc(links.playback[0].url)}" title="مشاهدة الحلقة ${requestedEpisode}" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div><h3 class="player-status">سيرفرات المشاهدة</h3><div class="source-links">${links.playback.map((l,i)=>`<button class="secondary ${i===0?'active':''}" data-playback="${esc(l.url)}" data-server-label="سيرفر ${i+1}" aria-pressed="${i===0}"><span class="server-symbol" aria-hidden="true">▶</span><span class="server-caption">سيرفر ${i+1}</span></button>`).join('')}</div><p class="player-help">إذا ظهرت رسالة 403، افتح الحلقة على موقع السيرفر.</p><div class="source-links">${links.playback.map((l,i)=>`<a class="secondary" href="${esc(l.url)}" target="_blank" rel="nofollow noopener noreferrer">سيرفر ${i+1}</a>`).join('')}</div></section>`:'<p class="provider-note">لم تتوفر روابط مشاهدة لهذه الحلقة بعد.</p>';
      episodeContent=`<section class="episode-page"><h2>الحلقة ${requestedEpisode}${episode.name&&episode.name!==`Episode ${requestedEpisode}`&&episode.name!==`الحلقة ${requestedEpisode}`?` — ${esc(episode.name)}`:''}</h2>${episode.air_date?`<p>تاريخ العرض: <time dir="ltr" datetime="${esc(episode.air_date)}">${esc(episode.air_date)}</time></p>`:''}<nav class="episode-navigation" aria-label="التنقل بين الحلقات">${episodeLink(episodes[index-1],'الحلقة السابقة')}<a class="secondary" href="/#/details/tv/${id}/season/${selectedSeason}">جميع حلقات الموسم</a>${episodeLink(episodes[index+1],'الحلقة التالية')}</nav></section>${episodePlayer}${serverLinks(links.downloads,'سيرفرات التحميل')}`;
    }
  }
  if(type==='tv'){
    const story=await api(`/api/tv-story/${id}${selectedSeason?`/season/${selectedSeason}`:''}${requestedEpisode?`/episode/${requestedEpisode}`:''}`).catch(()=>({overview:''}));if(version!==routeVersion)return;
    const label=requestedEpisode?'قصة الحلقة':selectedSeason?'قصة الموسم':animated(m)?'قصة الأنمي':'قصة المسلسل';
    const overview=story.overview||(!selectedSeason?data.overview:'');
    const description=[`مشاهدة وتحميل ${m.name} اون لاين على سيما هَب.`,m.genres?.length?`من تصنيف ${m.genres.map(g=>g.id===16?'أنمي':g.name).join('، ')}.`:'',story.air_date?`تاريخ العرض ${story.air_date}.`:'',requestedEpisode?'':selectedSeason&&story.episode_count?`يضم الموسم ${story.episode_count} حلقات.`:!selectedSeason&&m.number_of_seasons?`تصفح ${m.number_of_seasons} مواسم وروابط حلقات المسلسل بالترتيب.`:''].filter(Boolean).join(' ');
    storyContent=`<section class="movie-story" id="work-story"><h2>${label}</h2><p>${esc(overview||'لم يتوفر ملخص عربي لهذه الصفحة بعد.')}</p></section><section class="movie-description"><h2>الوصف والتفاصيل</h2><p>${esc(description)}</p></section>`;
    m.overview=overview||'';m.separate_story=true;
  }
  if(type==='movie'){
    storyContent=`<section class="movie-story" id="work-story"><h2>${animated(m)?'قصة فيلم الأنمي':'قصة الفيلم'}</h2><p>${esc(m.overview||'لم تتوفر قصة عربية لهذا الفيلم بعد.')}</p></section>`;
    m.separate_story=true;
  }
  if(type==='tv')delete m.series_display_title;
  document.title=`${title(m)} | سيما هَب`;
  const detailSummary=[`${title(m)} على سيما هَب.`,m.overview||'',type==='tv'?(requestedEpisode?'قصة الحلقة وتاريخ عرضها.':selectedSeason?'قصة الموسم وحلقاته بالترتيب.':(animated(m)?'قصة الأنمي ومواسمه وحلقاته.':'قصة المسلسل ومواسمه وحلقاته.')): 'قصة الفيلم وتفاصيله وتقييمه.'].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  const detailDescription=detailSummary.length>165?detailSummary.slice(0,162).replace(/\s+\S*$/u,'')+'…':detailSummary;
  document.querySelector('meta[name="description"]')?.setAttribute('content',detailDescription);
  for(const [property,value] of [['og:title',document.title],['og:description',detailDescription]]){
    let tag=document.querySelector(`meta[property="${property}"]`);
    if(!tag){tag=document.createElement('meta');tag.setAttribute('property',property);document.head.append(tag);}
    tag.setAttribute('content',value);
  }

  const director=m.credits?.crew?.find(p=>p.job==='Director')?.name || m.created_by?.map(p=>p.name).join('،');
  main.innerHTML=`${hero(m,true)}<div class="content ${type==='tv'?'series-detail-content':''}">${type==='tv'?`<nav class="series-breadcrumb" aria-label="مسار التصفح"><a href="${animated(m)?'/anime/series/':'/series/'}">${animated(m)?'مسلسلات أنمي':'المسلسلات'}</a> / <a href="/#/details/tv/${id}">${esc(m.original_name||data.name)}</a>${selectedSeason?` / <a href="/#/details/tv/${id}/season/${selectedSeason}">الموسم ${seasonLabel(selectedSeason)}</a>`:''}${requestedEpisode?` / الحلقة ${requestedEpisode}`:''}</nav>`:''}${episodeContent}${storyContent}${type==='tv'?seasonEpisodesMarkup(m,selectedSeason):`<section class="movie-description"><h2>الوصف والتفاصيل</h2><p>${esc(title(m))} على سيما هَب.${m.runtime?` مدة الفيلم ${esc(m.runtime)} دقيقة.`:''} اللغة: ${esc(languageName(m.original_language))}.</p></section>`}<div class="details-without-cast"><section class="film-details series-details" aria-labelledby="series-details-title"><h2 id="series-details-title">تفاصيل ${type==='tv'?'المسلسل':'الفيلم'}</h2><dl class="film-details-list"><div><dt>قسم ${type==='tv'?'المسلسل':'الفيلم'} :</dt><dd>${m.genres?.some(g=>g.id===16)?`<a href="${type==='movie'?'/anime/movies/':'/anime/series/'}">${type==='movie'?'أفلام أنمي':'مسلسلات أنمي'}</a>`:seriesCategory(m)}</dd></div><div><dt>نوع ${type==='tv'?'المسلسل':'الفيلم'} :</dt><dd>${seriesGenreLinks(m)}</dd></div><div><dt>اللغة :</dt><dd>${esc(languageName(m.original_language))}</dd></div><div><dt>الدولة :</dt><dd>${esc((m.origin_country||m.production_countries?.map(c=>c.iso_3166_1)||[]).map(countryName).join('، ')||'غير متاح')}</dd></div><div><dt>موعد الصدور :</dt><dd>${esc(year(m)||'غير متاح')}</dd></div></dl></section></div>${m.recommendations?.results?.length?`<section class="section-gap">${heading('قد يعجبك أيضًا')}<div class="grid">${m.recommendations.results.slice(0,6).map(r=>card(r,type)).join('')}</div></section>`:''}</div>`;
  if(type==='tv')bindSeasonEpisodes(m,version,selectedSeason);
}
function showModal(content){$('#modal-content').innerHTML=content;if(!modal.open)modal.showModal();}
async function trailer(id){const m=items.get(id);if(!m)return;const videos=m.videos?.results||[];const video=videos.find(v=>v.site==='YouTube'&&v.type==='Trailer')||videos.find(v=>v.site==='YouTube');if(!video||!/^[-\w]{11}$/.test(video.key)){showModal(empty('الإعلان غير متاح حاليًا','الإعلان التشويقي لهذا العمل غير متاح حاليًا.'));return;}showModal(`<h2>${esc(title(m))}</h2><iframe class="video-frame" src="https://www.youtube-nocookie.com/embed/${video.key}?autoplay=1" title="الإعلان التشويقي" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`);}
async function renderRoute(){
  const version=++routeVersion;modal.close();main.innerHTML=skeleton();window.scrollTo(0,0);
  document.querySelector('meta[name="description"]')?.setAttribute('content','مشاهدة وتحميل أحدث الأفلام والمسلسلات وأفلام ومسلسلات الأنمي كاملة ومترجمة HD اون لاين على سيما هَب.');
  document.querySelectorAll('meta[property="og:title"],meta[property="og:description"]').forEach(tag=>tag.remove());
  const [path,query='']=(location.hash.slice(1)||'/').split('?');const parts=path.split('/').filter(Boolean);let page=parts[0]||'home';if(page==='saved'){location.replace('/#/');return;}const params=new URLSearchParams(query||(!location.hash?location.search:''));
  if(location.hash.startsWith('#/')&&['home','recent','top','episodes','seasons','search'].includes(page)){location.replace((page==='home'?'/':`/${page}/`)+(params.size?'?'+params:''));return;}
  if(!location.hash&&location.pathname==='/recent/')page='recent';
  if(!location.hash){const native=location.pathname.split('/').filter(Boolean);if(native[0]==='series-category'&&seriesCategories[native[1]]){page='tv';params.set('region',seriesCategories[native[1]][0]);}if(native[0]==='series-genre'&&seriesGenres[native[1]]){page='tv';params.set('genre',String(seriesGenres[native[1]][0]));}}
  if(page==='movies'){const region=params.get('region');params.delete('region');const dest=region&&['foreign','asian','arabic','indian','turkish'].includes(region)?`/movies/${region}/`:'/movies/';location.replace(dest+(params.size?'?'+params:''));return;}
  if(page==='anime'||page==='tv'){
    let destination=page==='anime'?(params.get('type')==='movie'?'/anime/movies/':'/anime/series/'):'/series/';
    if(page==='tv'){
      const category=Object.entries(seriesCategories).find(([,v])=>v[0]===params.get('region'));
      const genre=Object.entries(seriesGenres).find(([,v])=>String(v[0])===params.get('genre'));
      if(category){destination=`/series-category/${category[0]}/`;params.delete('region');}
      else if(genre){destination=`/series-genre/${genre[0]}/`;params.delete('genre');}
    }
    params.delete('type');location.replace(destination+(params.size?'?'+params:''));return;
  }
  document.title=`${page==='tv'&&params.get('genre')?'مسلسلات '+(Object.values(seriesGenres).find(v=>String(v[0])===params.get('genre'))?.[1]||''):pageNames[page]||'الحكاية تبدأ هنا'} | سيما هَب`;
  document.querySelectorAll('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===page);if(a.dataset.nav===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  try{if(page==='home')await home(version);else if(page==='recent')await recentListing(params,version);else if(['episodes','seasons'].includes(page))await updatesListing(page,params,version);else if(page==='details'&&['tv','movie'].includes(parts[1])&&/^\d+$/.test(parts[2]))await details(parts[1],parts[2],version,parts[3]==='season'&&/^[1-9]\d*$/.test(parts[4]||'')?Number(parts[4]):undefined,parts[5]==='episode'&&/^[1-9]\d*$/.test(parts[6]||'')?Number(parts[6]):undefined);else if(pageNames[page])await listing(page,params,version);else main.innerHTML=empty('هذه الصفحة غير موجودة','عد إلى الرئيسية لاكتشاف المزيد.','<a class="primary" href="#/">الرئيسية</a>');}catch(error){if(version===routeVersion)main.innerHTML=empty('تعذّر تحميل المحتوى',esc(error.message),'<button class="primary" data-retry>حاول مجددًا</button>');}
}
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.trailer)trailer(button.dataset.trailer);if(button.hasAttribute('data-retry'))renderRoute();if(button.hasAttribute('data-slide')||button.hasAttribute('data-next-slide')){featuredIndex=button.hasAttribute('data-slide')?Number(button.dataset.slide):(featuredIndex+1)%featured.length;$('.hero').outerHTML=hero(featured[featuredIndex]);}});
if(location.pathname==='/search/')$('#search-input').value=new URLSearchParams(location.search).get('q')||'';
$('#search-form').addEventListener('submit',event=>{event.preventDefault();const q=$('#search-input').value.trim();if(q)location.href=`/search/?q=${encodeURIComponent(q)}`;else $('#search-input').focus();});
$('#modal-close').addEventListener('click',()=>modal.close());modal.addEventListener('close',()=>{$('#modal-content').innerHTML='';});modal.addEventListener('click',event=>{if(event.target===modal){const box=modal.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)modal.close();}});
window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#/')||!main.dataset.serverRendered)renderRoute();});
function handleImageError(event){
 const img=event.target;if(img.tagName!=='IMG')return;
 if(img.classList.contains('hero-image')||img.classList.contains('film-backdrop')){img.remove();return;}
 if(img.classList.contains('movie-cover')){img.closest('.film-masthead')?.classList.add('film-masthead--no-cover');(img.closest('.movie-cover-wrap')||img).remove();return;}
 const fallback=document.createElement('span');
 if(img.closest('.cast')){fallback.className='cast-placeholder';fallback.setAttribute('aria-label',img.alt||'');fallback.innerHTML=icon('film');img.replaceWith(fallback);return;}
 fallback.innerHTML=posterPlaceholder(img.alt||'');img.replaceWith(fallback.firstElementChild);
}
document.addEventListener('error',handleImageError,true);
// Server-rendered images can fail before this module has finished loading.
for(const img of document.images)if(img.complete&&!img.naturalWidth)handleImageError({target:img});
if (main.dataset.serverRendered) {
  for (const movie of JSON.parse($('#movie-page-data').textContent)) register(movie,movie.media_type||'movie');
  if(location.hash.startsWith('#/'))renderRoute();
  if(main.dataset.pageKind!=='legal'){
    const activeNav=document.querySelector(`[data-nav="${main.dataset.pageKind||'movies'}"]`);
    activeNav?.classList.add('active');
    activeNav?.setAttribute('aria-current','page');
  }
  
} else {
  main.innerHTML=skeleton();
  try{const results=await Promise.all([api('/api/genres?type=movie'),api('/api/genres?type=tv')]);genres=Object.fromEntries(results.flatMap(r=>r.genres).map(g=>[g.id,g.name]));}catch{}
  renderRoute();
}

// Load only the selected server, replacing the previous frame to stop its playback.
document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-playback]');
  if(!button)return;
  const holder=document.getElementById('film-player');
  if(!holder)return;
  let url;try{url=new URL(button.dataset.playback);if(url.protocol!=='https:')return;}catch{return;}
  const frame=document.createElement('iframe');
  frame.title='مشاهدة الفيلم — '+button.dataset.serverLabel;
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-presentation');
  frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';
  frame.allowFullscreen=true;
  frame.referrerPolicy='strict-origin-when-cross-origin';
  frame.src=url.href;
  holder.replaceChildren(frame);
  document.querySelectorAll('[data-playback]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
});

const playbackButtons=[...document.querySelectorAll('button[data-playback]')];
const defaultPlayback=playbackButtons.find(button=>{
  try{return new URL(button.dataset.playback).hostname==='wwa.liiivideo.com';}catch{return false;}
})||playbackButtons[0];
const currentPlayback=document.querySelector('#film-player iframe')?.getAttribute('src');
if(currentPlayback){playbackButtons.forEach(button=>{const active=button.dataset.playback===currentPlayback;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});}
else defaultPlayback?.click();

// Refresh an initially empty film page once background discovery supplies servers.
if(main.dataset.serverRendered&&!main.querySelector('.movie-sources')){
  const pageMovie=JSON.parse(document.getElementById('movie-page-data')?.textContent||'[]').find(m=>m.media_type==='movie'&&m.public_path===decodeURI(location.pathname));
  const movieId=pageMovie?.id;
  const futureRelease=/^\d{4}-\d{2}-\d{2}$/.test(pageMovie?.release_date||'')&&pageMovie.release_date>new Date().toISOString().slice(0,10);
  if(movieId&&!futureRelease){let checks=0;const checkLinks=async()=>{
    if(++checks>20)return;
    try{if(!document.hidden){const status=await api('/api/movie-links/'+movieId);if(status.available&&!modal.open){location.reload();return;}}}catch{}
    setTimeout(checkLinks,30000);
  };setTimeout(checkLinks,30000);}
}


