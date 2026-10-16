import {escapeHtml as e,movieGenres,movieTopicSections,movieDisplayTitle,moviePosterBadge} from './movie-seo.js';
import {localImage,posterPlaceholder} from './public/media-images.js';
import {mediaLink,seriesLink} from './public/media-links.js';
import {pagination,MAX_LISTING_PAGES} from './public/pagination.js';
import {seriesTitle} from './detail-seo.js';
import {featuredWorks,homeCarousel,homeIntroduction} from './public/home-carousel.js';

export const publicPages={
 '/top/':{name:'الأفلام والمسلسلات الأعلى تقييمًا',description:'مشاهدة وتحميل أفضل الأفلام والمسلسلات الأعلى تقييمًا كاملة بجودة عالية HD اون لاين على سيما هَب، مع سيرفرات المشاهدة وروابط التحميل.'},
 '/recent/':{name:'المضافة حديثًا',description:'مشاهدة وتحميل أحدث الأفلام وحلقات المسلسلات والأنمي على سيما هَب بجودة عالية HD اون لاين، مع الإصدارات الجديدة وروابط المشاهدة والتحميل المباشرة.'},
 '/episodes/':{name:'أحدث حلقات المسلسلات',description:'مشاهدة وتحميل أحدث حلقات المسلسلات العربية والأجنبية والأنمي مترجمة بجودة عالية HD اون لاين على سيما هَب، مع أرقام الحلقات والمواسم وروابط المشاهدة والتحميل.'},
 '/seasons/':{name:'آخر مواسم المسلسلات',description:'مشاهدة وتحميل أحدث مواسم المسلسلات العربية والأجنبية والأنمي كاملة بجودة عالية HD اون لاين على سيما هَب، مع جميع حلقات الموسم وروابط المشاهدة والتحميل.'},
 '/search/':{name:'البحث في سيما هَب',description:'ابحث عن فيلم أو مسلسل أو أنمي بالاسم، وتصفح النتائج وتفاصيل الأعمال.'},
};
const catalogTitle=m=>m.display_title&&!m.name&&m.media_type!=='tv'?movieDisplayTitle(m):m.display_title||m.series_display_title||m.title||m.name;
export function catalogCard(m){
 const anime=(m.genre_ids||m.genres?.map(g=>g.id)||[]).includes(16),tv=m.media_type==='tv'||!!m.name;
 const base=catalogTitle(m);
 const label=m.episode_number?`الحلقة ${m.episode_number}`:m.season_number?`الموسم ${m.season_number}`:anime?(tv?'مسلسل أنمي':'فيلم أنمي'):tv?'مسلسل':'فيلم';
 const name=tv&&m.season_number?seriesTitle(m,m.season_number,m.episode_number,{includeSeriesYear:!m.episode_number}):base;
 const href=seriesLink(m,m.season_number,m.episode_number),poster=localImage(m.poster_path);
 return `<article class="card"><a class="poster-link" href="${e(href)}" title="${e(name)}">${poster?`<img src="${poster}" alt="${e(name)}" width="300" height="450" loading="lazy">`:posterPlaceholder(m.title||m.name,(m.release_date||m.first_air_date||'').slice(0,4))}<span class="poster-type">${label}</span>${tv?'':moviePosterBadge(m)}${m.vote_average?`<span class="poster-rating">★ ${Number(m.vote_average).toFixed(1)}</span>`:''}</a><h3><a href="${e(href)}" dir="auto">${e(name)}</a></h3><div class="card-info"><time>${e(m.air_date||m.release_date?.slice(0,4)||m.first_air_date?.slice(0,4)||'')}</time></div></article>`;
}
export function collectionPage(path,data,origin,query=new URLSearchParams()){
 const config=publicPages[path],page=Number(data.page)||1,search=path==='/search/'?(query.get('q')||'').trim():'';
 const isTop=path==='/top/',isTv=query.get('type')==='tv';
 const name=path==='/search/'&&search?`نتائج البحث عن «${search}»`:isTop?(isTv?'أفضل المسلسلات الأعلى تقييمًا':'أفضل الأفلام الأعلى تقييمًا'):config.name;
 const description=isTop
  ?(isTv
     ?'مشاهدة وتحميل أفضل المسلسلات الأعلى تقييمًا كاملة بجودة عالية HD اون لاين على سيما هَب، مع جميع المواسم والحلقات وسيرفرات المشاهدة وروابط التحميل.'
     :'مشاهدة وتحميل أفضل الأفلام الأعلى تقييمًا كاملة بجودة عالية HD اون لاين على سيما هَب، مع الأفلام العربية والأجنبية المترجمة وروابط المشاهدة والتحميل المباشرة.')
  :config.description;
 const params=new URLSearchParams();if(search)params.set('q',search);if(isTop&&isTv)params.set('type','tv');if(page>1)params.set('page',page);
 const canonical=origin+path+(params.size?'?'+params:'');
 const items=(data.results||[]).filter(m=>!m.adult&&m.media_type!=='person');
 const link=n=>{const q=new URLSearchParams(params);q.delete('page');if(n>1)q.set('page',n);return path+(q.size?'?'+q:'');};
 const title=isTop
  ?`${name} عالميًا ${new Date().getFullYear()} كاملة HD اون لاين${page>1?' — الصفحة '+page:''} | سيما هَب`
  :`${name}${page>1?' — الصفحة '+page:''} | سيما هَب`;
 const content=`<div class="content"><nav class="movie-breadcrumb" aria-label="مسار الصفحة"><a href="/">الرئيسية</a> / ${e(name)}</nav><header class="page-heading"><h1>${e(name)}</h1><p>${e(description)}</p></header>${isTop?`<nav class="category-switch" aria-label="نوع العمل"><a href="/top/"${!isTv?' aria-current="page"':''}>أفلام</a><a href="/top/?type=tv"${isTv?' aria-current="page"':''}>مسلسلات</a></nav>`:''}${search&&data.corrected_query?`<p class="search-correction">نعرض نتائج قريبة لكلمة <a href="/search/?q=${encodeURIComponent(data.corrected_query)}"><bdi>${e(data.corrected_query)}</bdi></a></p>`:''}<div class="grid catalog-grid">${items.map(catalogCard).join('')}</div>${!items.length?'<div class="empty"><h2>لا توجد نتائج</h2><p>جرّب البحث باسم آخر أو تصفح الأقسام.</p><a href="/movies/">تصفح الأفلام</a></div>':''}${pagination(page,Math.min(data.total_pages||1,MAX_LISTING_PAGES),link)}</div>`;
 return {items,content,metadata:{title,description:(page>1?`الصفحة ${page}: `:'')+description,canonical,noindex:path==='/search/'||!items.length,image:items[0]?.poster_path?origin+localImage(items[0].poster_path):undefined,schema:{'@context':'https://schema.org','@type':'CollectionPage',name,url:canonical,mainEntity:{'@type':'ItemList',itemListElement:items.map((m,i)=>({'@type':'ListItem',position:(page-1)*(data.page_size||20)+i+1,name:catalogTitle(m),url:origin+seriesLink(m,m.season_number,m.episode_number)}))}}}};
}
export function homePage(groups,origin){
 const items=groups.flatMap(g=>g.items),bannerItems=groups.filter(g=>g.path!=='/recent/').flatMap(g=>g.items).concat(items),featured=featuredWorks(bannerItems)[0];
 const content=`${homeCarousel(bannerItems)}<div class="content">${homeIntroduction}${groups.map(g=>`<section class="section-gap"><div class="section-heading"><h2>${e(g.name)}</h2><a class="view-all-button" href="${g.path}">عرض الكل</a></div><div class="grid">${g.items.slice(0,12).map(catalogCard).join('')}</div></section>`).join('')}<nav class="movie-tags" aria-label="أنواع الأفلام">${Object.entries(movieGenres).map(([slug,[,label]])=>`<a href="/movies/genre/${slug}/">أفلام ${label}</a>`).join('')}${Object.values(movieTopicSections).map(section=>`<a href="${section.path}">${e(section.name)}</a>`).join('')}</nav></div>`;
 return {items,content,metadata:{title:'سيما هَب — مشاهدة وتحميل أفلام عربي وأجنبي ومسلسلات وأنمي HD اون لاين',description:'مشاهدة وتحميل أفلام ومسلسلات وأنمي كاملة ومترجمة بجودة عالية HD اون لاين على سيما هَب، مع أحدث الأفلام العربية والأجنبية وجميع المواسم والحلقات وروابط التحميل.',canonical:origin+'/',noindex:!items.length,image:featured?.backdrop_path?origin+localImage(featured.backdrop_path,'w1280'):undefined,schema:{'@context':'https://schema.org','@graph':[{'@type':'WebSite','@id':origin+'/#website',name:'سيما هَب',alternateName:'CimaHub',url:origin+'/',inLanguage:'ar'},{'@type':'Organization','@id':origin+'/#organization',name:'سيما هَب',url:origin+'/',logo:origin+'/favicon.svg'}]}}};
}
