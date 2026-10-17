import {hdSuffix} from './seo-content.js';
import {localImage as image,posterPlaceholder} from './public/media-images.js';
import {pagination,MAX_LISTING_PAGES} from './public/pagination.js';
import {safeLink} from './qfilm-import.js';
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, rename} from './storage.js';
import {usesMoviePresentation,movieIdentityTitle} from './movie-presentation.js';
import {workTitleMarkup} from './public/title-markup.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escapeHtml;
export const moviePath = id => `/movie/${Number(id)}/`;
export const adultMovieCategory={path:'/movies/18-plus/',name:'أفلام للكبار فقط +18',heading:'أفلام للكبار فقط +18',title:'مشاهدة أفلام للكبار فقط +18 مترجمة HD اون لاين',description:'مشاهدة وتحميل أفلام للكبار فقط +18 مترجمة بجودة HD على سيما هَب، مع أفلام أجنبي وعربي لا تصلح للمشاهدة العائلية وسيرفرات المشاهدة وروابط التحميل المتاحة.'};
export const movieTopicSections={biography:{path:'/movies/genre/biography/',label:'سيرة ذاتية',name:'أفلام سيرة ذاتية',heading:'أفلام سيرة ذاتية',title:'أفلام سيرة ذاتية — قصص الشخصيات وتفاصيل الأفلام',description:'تصفح أفلام السيرة الذاتية التي تتناول حياة شخصيات ومجموعات محددة، مع قصص الأفلام وأبطالها وتفاصيلها على سيما هَب.',keyword:5565}};
export const comingSoonMovieCategory={path:'/movies/coming-soon/',label:'يعرض قريبًا',name:'أفلام تعرض قريبًا',heading:'أفلام تعرض قريبًا',title:'أفلام تعرض قريبًا — مواعيد الإصدار والإعلانات التشويقية',description:'تصفح الأفلام ذات موعد إصدار أساسي معلن خلال الأيام الـ180 المقبلة، مع القصص والأبطال والإعلانات التشويقية. قد تتغير المواعيد وتختلف حسب البلد.'};
export function movieComingSoonWindow(now=new Date()){
  const today=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  const start=new Date(today),end=new Date(today);
  start.setUTCDate(start.getUTCDate()+1);end.setUTCDate(end.getUTCDate()+180);
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
export function isFutureMovie(m,now=new Date()){
  const date=m.release_date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return false;
  const parsed=new Date(date+'T00:00:00Z');
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date&&date>now.toISOString().slice(0,10);
}
const hasMoviePlayback=m=>(m.externalSources||[]).some(source=>source.playback?.some(link=>safeLink(link.url)));
const hasMovieTrailer=m=>(m.videos?.results||[]).some(video=>video.site==='YouTube'&&/^[a-zA-Z0-9_-]{11}$/.test(video.key||''));
const upcomingPreview=(m,now=new Date())=>isFutureMovie(m,now)&&!hasMoviePlayback(m);
export function movieDisplayTitle(m){
  if(/ — يعرض قريبًا(?:$| —)/.test(m.display_title||''))return movieIdentityTitle(m);
  return m.display_title||'مشاهدة فيلم '+m.title;
}
export const moviePosterBadge=m=>isFutureMovie(m)?'<span class="poster-upcoming">قريبًا</span>':'';
const announcedRelease=m=>`<time datetime="${e(m.release_date)}">${e(m.release_date)}</time>`;
const movieSectionDefinitions = {
  foreign: {
    name:'أفلام أجنبية مترجمة',
    heading:'أفلام أجنبي مترجمة',
    title:year=>`مشاهدة أفلام أجنبي ${year} مترجمة كاملة HD اون لاين`,
    language:'en',
    description:year=>`مشاهدة وتحميل أحدث أفلام أجنبي ${year} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب. مكتبة متجددة لأقوى أفلام الأكشن والرعب والخيال العلمي بروابط مباشرة.`
  },
  asian: {
    name:'أفلام آسيوية مترجمة',
    heading:'أفلام آسيوية مترجمة',
    title:year=>`مشاهدة أفلام آسيوية كورية ويابانية ${year} مترجمة HD اون لاين`,
    language:'ko|ja|zh|cn|th',
    description:year=>`مشاهدة وتحميل أحدث الأفلام الآسيوية الكورية واليابانية والصينية ${year} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب، مع قصص الأفلام وتقييماتها.`
  },
  arabic: {
    name:'أفلام عربية',
    heading:'أفلام عربي جديدة',
    title:year=>`مشاهدة أفلام عربي جديدة ${year} كاملة HD اون لاين`,
    language:'ar',
    description:year=>`مشاهدة وتحميل أحدث الأفلام العربية والمصرية ${year} كاملة بجودة عالية HD اون لاين على سيما هَب. أفلام كوميدية ودراما وأكشن بروابط وسيرفرات مباشرة.`
  },
  indian: {
    name:'أفلام هندية مترجمة',
    heading:'أفلام هندية مترجمة',
    title:year=>`مشاهدة أفلام هندية ${year} مترجمة أكشن ورومانسية HD اون لاين`,
    language:'hi|te|ta|ml|kn|bn|mr|pa',
    description:year=>`مشاهدة وتحميل أحدث أفلام بوليوود والسينما الهندية ${year} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب، أقوى أفلام الأكشن والرومانسية والتشويق الهندية.`
  },
  turkish: {
    name:'أفلام تركية مترجمة',
    heading:'أفلام تركية مترجمة',
    title:year=>`مشاهدة أفلام تركية ${year} مترجمة رومانسية وتشويق HD اون لاين`,
    language:'tr',
    description:year=>`مشاهدة وتحميل أحدث الأفلام التركية ${year} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب، أفلام درامية ورومانسية وتشويق مع قصة كل فيلم.`
  },
};
export const movieSections=Object.fromEntries(Object.entries(movieSectionDefinitions).map(([key,{title,description,...section}])=>[key,{
  ...section,
  get title(){return title(new Date().getFullYear());},
  get description(){return description(new Date().getFullYear());}
}]));
export const movieGenres = {action:[28,'أكشن'],adventure:[12,'مغامرات'],comedy:[35,'كوميديا'],crime:[80,'جريمة'],drama:[18,'دراما'],fantasy:[14,'فانتازيا'],horror:[27,'رعب'],mystery:[9648,'غموض'],romance:[10749,'رومانسية'],'sci-fi':[878,'خيال علمي'],thriller:[53,'إثارة'],documentary:[99,'وثائقية'],family:[10751,'عائلية'],history:[36,'تاريخية'],war:[10752,'حرب'],music:[10402,'موسيقية']};
const genrePath = id => {const match=Object.entries(movieGenres).find(([,value])=>value[0]===id);return match?`/movies/genre/${match[0]}/`:null;};
const sectionKey = language => Object.keys(movieSections).find(key=>movieSections[key].language.split('|').includes(language));
const movieCategory = m => {
  if(m.source_adult_category)return adultMovieCategory;
  if((m.genres||[]).some(g=>g.id===16))return {path:'/anime/movies/',name:'أفلام أنمي'};
  if(m.is_biography)return movieTopicSections.biography;
  const region=sectionKey(m.original_language);
  return region?{path:`/movies/${region}/`,name:movieSections[region].name}:null;
};
const uniqueMovies=list=>{const ids=new Set(),identities=new Set();return list.filter(m=>{const identity=[m.original_title||m.title,m.release_date?.slice(0,4),m.poster_path||m.id].join('|');if(ids.has(m.id)||identities.has(identity))return false;ids.add(m.id);identities.add(identity);return true;});};
const genreLabel=g=>g.id===16?'أنمي':Object.values(movieGenres).find(v=>v[0]===g.id)?.[1]||g.name;
function movieFacts(m){
 const language=(()=>{try{return new Intl.DisplayNames(['ar'],{type:'language'}).of(m.original_language);}catch{return 'غير متاح';}})();
 const shortCountries={HK:'هونغ كونغ',MO:'ماكاو',US:'الولايات المتحدة',GB:'المملكة المتحدة',TW:'تايوان'};
 const countries=[...new Set((m.production_countries||[]).map(c=>{try{return shortCountries[c.iso_3166_1]||new Intl.DisplayNames(['ar'],{type:'region'}).of(c.iso_3166_1);}catch{return c.name;}}))].join('، ');
 const genreLinks=[...(m.genres||[]).map(g=>genrePath(g.id)?`<a href="${genrePath(g.id)}">${e(genreLabel(g))}</a>`:e(genreLabel(g))),...(m.is_biography?[`<a href="${movieTopicSections.biography.path}">${movieTopicSections.biography.label}</a>`]:[])].join(' ');
 const preview=upcomingPreview(m);
 const quality=preview?'':[...new Set((m.externalSources||[]).map(r=>r.quality).filter(Boolean))].join(' / ');
 const year=m.release_date?.slice(0,4);
 const cast=(m.credits?.cast||[]).slice(0,5).map(p=>e(p.name)).join('، ');
 const director=m.credits?.crew?.find(p=>p.job==='Director')?.name;
 const row=(label,value)=>`<div><dt>${label} :</dt><dd>${value}</dd></div>`;
 const category=movieCategory(m);
 return `<section class="film-details" aria-labelledby="film-details-title"><h2 id="film-details-title">تفاصيل الفيلم</h2><dl class="film-details-list">${row('قسم الفيلم',`<a href="${category?.path||'/movies/'}">${e(category?.name.replace(' مترجمة','')||'أفلام')}</a>`)}${row('نوع الفيلم',genreLinks||'غير متاح')}${m.age_rating?row('التصنيف العمري',e(m.age_rating.certification)+' <bdi>('+e(m.age_rating.country)+')</bdi>'):''}${quality?row('جودة الفيلم',e(quality)):''}${row('توقيت الفيلم',m.runtime?`<strong>${Number(m.runtime)} دقيقة</strong>`:'غير متاح')}${row('موعد الصدور',preview?announcedRelease(m):year?`<a href="/movies/year/${e(year)}/">${e(year)}</a>`:'غير متاح')}${row('لغة الفيلم',e(language))}${row('دولة الفيلم',e(countries||'غير متاح'))}${director?row('إخراج',e(director)):''}${cast?row('أبطال الفيلم',cast):''}</dl></section>`;
}
export function movieDescription(m) {
  const anime=(m.genres||[]).some(g=>g.id===16);
  const name=m.title || m.original_title || 'الفيلم';
  const year=(m.release_date||'').slice(0,4);
  const genres=m.genres?.map(genreLabel).slice(0,3).join('، ');
  const cast=m.credits?.cast?.slice(0,3).map(p=>p.name).join('، ');
  const director=m.credits?.crew?.find(p=>p.job==='Director')?.name;
  const section=movieCategory(m)?.name;
  if(upcomingPreview(m)){
    const neutralSection=section?.replace(' مترجمة','');
    return [`فيلم${anime?' أنمي':''} ${name}${year?' '+year:''} على سيما هَب.`,genres?`فيلم ${genres}${neutralSection?' ضمن '+neutralSection:''}.`:neutralSection?`من ${neutralSection}.`:'',cast?`بطولة ${cast}${director?'، وإخراج '+director:''}.`:director?`إخراج ${director}.`:'',m.runtime?`مدة الفيلم ${m.runtime} دقيقة.`:'',`قصة الفيلم وأبطاله وتفاصيله${hasMovieTrailer(m)?' والإعلان التشويقي المتاح':''} على سيما هَب.`].filter(Boolean).join(' ');
  }
  const translated=(m.original_language==='ar'?'':' مترجم للعربية')+hdSuffix(m);
  const downloads=(m.externalSources||[]).filter(r=>r.downloads?.some(l=>safeLink(l.url)));
  const qualities=[...new Set(downloads.map(r=>r.quality).filter(Boolean))].join(' / ');
  return [`مشاهدة وتحميل فيلم${anime?' أنمي':''} ${name}${year?' '+year:''}${translated}${qualities?' بجودة '+qualities:''} على سيما هَب.`,
    genres?`فيلم ${genres}${section?' ضمن '+section:''}${year?' لعام '+year:''}.`:section?`من ${section}${year?' لعام '+year:''}.`:'',
    cast?`بطولة ${cast}${director?'، وإخراج '+director:''}.`:director?`إخراج ${director}.`:'',
    m.runtime?`مدة الفيلم ${m.runtime} دقيقة.`:'',
    `قصة فيلم ${name}${year?' '+year:''}، وأبطاله وتفاصيله والإعلان التشويقي على سيما هَب.`].filter(Boolean).join(' ');
}
export function movieMetadata(m, origin) {
  const path=(m.public_path||moviePath(m.id));
  const description=movieDescription(m);
  const shortStory=(m.overview||'').replace(/\s+/g,' ').trim();
  const lead=description.split(' على سيما هَب.')[0];
  const genres=m.genres?.map(genreLabel).slice(0,3).join('، ');
  const summary=`${lead}.${genres?' فيلم '+genres+'.':''} ${shortStory||'قصة الفيلم وأبطاله وتفاصيله على سيما هَب.'}`;
  const meta=summary.length>160?summary.slice(0,157).replace(/\s+\S*$/u,'').trimEnd()+'…':summary;
  const url=origin+path;
  const category=movieCategory(m);
  const categoryBreadcrumb=category&&(m.source_adult_category||category===movieTopicSections.biography)?[{'@type':'ListItem',position:2,name:category.name,item:origin+category.path}]:[];
  const schema={'@context':'https://schema.org','@graph':[
    {'@type':'Movie','@id':url+'#movie',url,name:m.title,description:m.overview||description,
      ...(image(m.poster_path)?{image:origin+image(m.poster_path)}:{}),
      ...(m.release_date?{dateCreated:m.release_date}:{}),
      ...(m.runtime?{duration:`PT${m.runtime}M`}:{}),
      ...(m.age_rating?{contentRating:m.age_rating.certification}:{}),
      genre:[...(m.genres||[]).map(genreLabel),...(m.is_biography?[movieTopicSections.biography.label]:[])],inLanguage:m.original_language,
      actor:(m.credits?.cast||[]).slice(0,6).map(p=>({'@type':'Person',name:p.name})),
      director:(m.credits?.crew||[]).filter(p=>p.job==='Director').map(p=>({'@type':'Person',name:p.name})),
      ...(hasMoviePlayback(m)?{potentialAction:{'@type':'WatchAction',target:url+'#movie-watch'}}:{})},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:m.genres?.some(g=>g.id===16)?'أفلام أنمي':'الأفلام',item:origin+(m.genres?.some(g=>g.id===16)?'/anime/movies/':'/movies/')},...categoryBreadcrumb,{'@type':'ListItem',position:categoryBreadcrumb.length?3:2,name:m.title,item:url}]},
  ]};
  return {title:`${movieDisplayTitle(m)}${upcomingPreview(m)?'':hdSuffix(m)} | سيما هَب`,description:meta,canonical:url,schema};
}

export function parseMovieListing(url,now=new Date()) {
  const path=url.pathname,currentYear=now.getFullYear();
  let name='الأفلام',heading='مشاهدة أحدث الأفلام',title=`مشاهدة أحدث الأفلام ${currentYear} عربي وأجنبي مترجمة كاملة HD اون لاين`,description=`مشاهدة وتحميل أحدث أفلام ${currentYear} الأجنبية والعربية والآسيوية والهندية كاملة بجودة عالية HD اون لاين على سيما هَب، مع سيرفرات المشاهدة وروابط التحميل المباشرة.`,section;
  const params=new URLSearchParams({language:'ar-SA',include_adult:'false',include_video:'false',without_genres:'16','vote_count.gte':'10'});
  let match;
  if(path==='/movies/'){}
  else if(path===adultMovieCategory.path){
    ({name,heading,title,description}=adultMovieCategory);
  }
  else if(path===comingSoonMovieCategory.path){
    ({name,heading,title,description}=comingSoonMovieCategory);
    const window=movieComingSoonWindow(now);
    params.set('primary_release_date.gte',window.start);params.set('primary_release_date.lte',window.end);
    params.delete('vote_count.gte');
  }
  else if((match=path.match(/^\/movies\/([a-z]+)\/$/)) && movieSections[match[1]]){
    section=movieSectionDefinitions[match[1]];
    name=section.name;
    heading=section.heading||section.name;
    title=section.title(currentYear);
    description=section.description(currentYear);
    params.set('with_original_language',section.language);
  }
  else if((match=path.match(/^\/movies\/genre\/([a-z-]+)\/$/)) && movieGenres[match[1]]){
    const [id,label]=movieGenres[match[1]];
    name=`أفلام ${label}`;
    heading=`أفلام ${label}`;
    title=`مشاهدة أفلام ${label} ${currentYear} كاملة HD اون لاين`;
    description=`مشاهدة وتحميل أفلام ${label} ${currentYear} كاملة بجودة عالية HD اون لاين على سيما هَب، مع أحدث أفلام ${label} العربية والأجنبية المترجمة وروابط المشاهدة والتحميل المباشرة.`;
    params.set('with_genres',id);
  }
  else if((match=path.match(/^\/movies\/genre\/([a-z-]+)\/$/)) && movieTopicSections[match[1]]){
    const topic=movieTopicSections[match[1]];
    ({name,heading,title,description}=topic);
    params.set('with_keywords',String(topic.keyword));
  }
  else if((match=path.match(/^\/movies\/year\/(\d{4})\/$/)) && Number(match[1])>=1900 && Number(match[1])<=currentYear+1){
    name=`أفلام ${match[1]}`;
    heading=`أفلام سنة ${match[1]}`;
    title=`مشاهدة أفلام ${match[1]} كاملة ومترجمة HD اون لاين`;
    description=`مشاهدة وتحميل أفلام ${match[1]} العربية والأجنبية والآسيوية والهندية كاملة بجودة عالية HD اون لاين على سيما هَب، مع الأفلام المترجمة وروابط المشاهدة والتحميل المباشرة.`;
    params.set('primary_release_year',match[1]);
  }
  else return null;
  const page=Number(url.searchParams.get('page')||1);
  if(!Number.isInteger(page)||page<1||page>MAX_LISTING_PAGES) return null;
  const comingSoon=path===comingSoonMovieCategory.path,topic=Object.keys(movieTopicSections).find(key=>movieTopicSections[key].path===path);
  const region=comingSoon||topic?url.searchParams.get('region')||'':'';
  if(region){if(!Object.hasOwn(movieSections,region))return null;params.set('with_original_language',movieSections[region].language);}
  const defaultSort=path===adultMovieCategory.path?'source.desc':comingSoon?'primary_release_date.asc':'popularity.desc';
  const sort=url.searchParams.get('sort')||defaultSort;
  if(!(path===adultMovieCategory.path?['source.desc']:comingSoon?['primary_release_date.asc','popularity.desc','primary_release_date.desc']:['popularity.desc','vote_average.desc','primary_release_date.desc']).includes(sort)||path===adultMovieCategory.path&&url.searchParams.get('genre'))return null;
  params.set('sort_by',sort);params.set('page',page);
  if(sort==='vote_average.desc')params.set('vote_count.gte','200');
  for(const field of ['year','genre'])if(url.searchParams.get(field)){
    const value=url.searchParams.get(field);
    if(field==='year'&&!/^(19|20)\d{2}$/.test(value))return null;
    if(field==='genre'&&!Object.values(movieGenres).some(([id])=>String(id)===value))return null;
    if(field==='year'&&path.startsWith('/movies/year/')&&value!==path.split('/')[3])return null;
    if(field==='genre'&&path.startsWith('/movies/genre/')&&params.has('with_genres'))params.set('with_genres',[...new Set([params.get('with_genres'),value])].join(','));
    else params.set(field==='year'?'primary_release_year':'with_genres',value);
  }
  const canonicalParams=new URLSearchParams();
  for(const field of ['genre','year','sort'])if(url.searchParams.get(field)&&!(field==='sort'&&sort===defaultSort)&&!(field==='year'&&path.startsWith('/movies/year/'))&&!(field==='genre'&&path.startsWith('/movies/genre/')&&url.searchParams.get(field)===String(movieGenres[path.split('/')[3]]?.[0])))canonicalParams.set(field,url.searchParams.get(field));
  if(region)canonicalParams.set('region',region);
  if(page>1)canonicalParams.set('page',page);
  const suffix=canonicalParams.size?'?'+canonicalParams:'';
  return {name,heading,title,description,params,page,path,adultAudience:path===adultMovieCategory.path,comingSoon,topic,region,canonicalPath:path+suffix,noindex:['genre','year','sort','region'].some(field=>canonicalParams.has(field))};
}

function card(m,{comingSoon=false}={}) {
  const preview=comingSoon||upcomingPreview(m),name=m.display_title?movieDisplayTitle(m):m.title;
  const rating=!preview||Number(m.vote_count)>0&&Number(m.vote_average)>0?`<span class="poster-rating">★ ${Number(m.vote_average||0).toFixed(1)}</span>`:'';
  return `<article class="card movie-card"><a class="poster-link" href="${(m.public_path||moviePath(m.id))}" title="${e(name)}" aria-label="${e(name)}">${image(m.poster_path)?`<img src="${image(m.poster_path)}" alt="${e(name)}" loading="lazy" width="300" height="450">`:posterPlaceholder(m.title||m.name,(m.release_date||m.first_air_date||'').slice(0,4))}${moviePosterBadge(m)}${rating}</a><h3><a href="${(m.public_path||moviePath(m.id))}" dir="rtl">${workTitleMarkup(name,m)}</a></h3></article>`;
}
export function listingContent(listing,data,now=new Date()) {
  const currentYear=now.getFullYear();
  const result=uniqueMovies(data.results.filter(m=>{
    if(listing.adultAudience)return m.source_adult_category===true&&!m.adult;
    if(!usesMoviePresentation(m,'movie')||m.adult)return false;
    return !listing.comingSoon||isFutureMovie(m,now)&&m.release_date>=listing.params.get('primary_release_date.gte')&&m.release_date<=listing.params.get('primary_release_date.lte');
  }));
  const currentSection=Object.keys(movieSections).find(key=>movieSections[key].language===listing.params.get('with_original_language'))||'';
  const options=(values,current)=>values.map(([key,name])=>`<option value="${key}" ${String(key)===String(current)?'selected':''}>${name}</option>`).join('');
  const link=page=>{const query=new URLSearchParams(listing.canonicalPath.split('?')[1]||'');query.delete('page');if(page>1)query.set('page',page);return listing.path+(query.size?'?'+e(query.toString()):'');};
  const yearTags=[currentYear,currentYear-1,currentYear-2,currentYear-3,currentYear-4,currentYear-5];
  const upcomingYears=listing.comingSoon?[...new Set([listing.params.get('primary_release_date.gte').slice(0,4),listing.params.get('primary_release_date.lte').slice(0,4)])]:[];
  const filterYears=listing.comingSoon?upcomingYears.map(year=>[year,year]):Array.from({length:50},(_,i)=>{const year=currentYear-i;return [year,year];});
  const sortOptions=listing.comingSoon?[['primary_release_date.asc','الأقرب إصدارًا'],['popularity.desc','الأكثر شعبية'],['primary_release_date.desc','الأبعد إصدارًا']]:[['popularity.desc','الأكثر شعبية'],['vote_average.desc','الأعلى تقييمًا'],['primary_release_date.desc','الأحدث إصدارًا']];
  const genreLinks=[...Object.entries(movieGenres).map(([key,[,label]])=>[`/movies/genre/${key}/`,`أفلام ${label}`]),...Object.values(movieTopicSections).map(topic=>[topic.path,topic.name])];
  const sectionLinks=[
    ['/movies/','كل الأفلام'],
    ['/movies/foreign/','أفلام أجنبي'],
    [adultMovieCategory.path,'أفلام +18'],
    ['/movies/arabic/','أفلام عربي'],
    ['/movies/asian/','أفلام آسيوية'],
    ['/movies/indian/','أفلام هندية'],
    ['/movies/turkish/','أفلام تركية'],
    ['/anime/movies/','أفلام أنمي'],
    [comingSoonMovieCategory.path,comingSoonMovieCategory.label]
  ];
  return `<div class="content"><nav class="movie-breadcrumb" aria-label="مسار الصفحة"><a href="/">الرئيسية</a><span> / </span><a href="/movies/">الأفلام</a>${listing.path!=='/movies/'?`<span> / </span><span aria-current="page">${e(listing.name)}</span>`:''}</nav><div class="page-heading"><h1>${e(listing.heading||listing.name)}</h1><p>${e(listing.description)}</p></div>${listing.adultAudience?`<form class="filters adult-category-filters" method="get" action="${listing.path}"><select name="year" aria-label="سنة الإصدار">${options([['','كل السنوات'],...filterYears],listing.params.get('primary_release_year'))}</select><div class="filter-actions"><button type="submit" class="primary">تطبيق</button><a class="filter-reset" href="${listing.path}">مسح الفلاتر</a></div></form>`:`<form class="filters" method="get" action="${listing.path}"><select name="genre" aria-label="نوع الفيلم">${options([['','كل الأنواع'],...Object.values(movieGenres)],listing.params.get('with_genres'))}</select><select name="year" aria-label="سنة الإصدار">${options([['','كل السنوات'],...filterYears],listing.params.get('primary_release_year'))}</select>${listing.adultAudience?'':`<select name="region" aria-label="قسم الأفلام">${options([['','كل الأقسام'],...Object.entries(movieSections).map(([key,value])=>[key,value.name.replace(/ مترجمة$/, '')])],currentSection)}</select>`}<select name="sort" aria-label="الترتيب">${options(sortOptions,listing.params.get('sort_by'))}</select><div class="filter-actions"><button type="submit" class="primary">تطبيق</button><a class="filter-reset" href="${listing.path}">مسح الفلاتر</a></div></form>`}${result.length?`<div class="grid catalog-grid">${result.map(m=>card(m,{comingSoon:listing.comingSoon})).join('')}</div>`:`<div class="empty filter-empty"><h2>لا توجد نتائج تطابق هذه الفلاتر</h2><p>جرّب تغيير النوع أو السنة، أو امسح الفلاتر لعرض جميع الأفلام.</p><a class="secondary" href="${e(listing.path)}">مسح الفلاتر</a></div>`}${pagination(listing.page,Math.min(data.total_pages,MAX_LISTING_PAGES),page=>link(page).replaceAll('&amp;','&'))}<nav class="movie-tags" aria-label="أقسام الأفلام">${sectionLinks.map(([path,label])=>`<a href="${path}"${path===listing.path?' aria-current="page"':''}>${label}</a>`).join('')}</nav><nav class="movie-tags" aria-label="تصفح أفلام السنوات">${yearTags.map(y=>`<a href="/movies/year/${y}/">أفلام ${y}</a>`).join('')}</nav><nav class="movie-tags" aria-label="تصفح أنواع الأفلام">${genreLinks.map(([path,label])=>`<a href="${path}">${label}</a>`).join('')}</nav></div>`;
}
export function sourceButtons(m, type) {
  const links=[...new Map((m.externalSources||[]).flatMap(r=>r[type]||[]).filter(l=>safeLink(l.url)).map(l=>[l.url,l])).values()];
  if(!links.length)return '';
  links.sort((a,b)=>Number(new URL(b.url).hostname==='wwa.liiivideo.com')-Number(new URL(a.url).hostname==='wwa.liiivideo.com'));
  const selected=links[0],label=m.media_type==='tv'?'الحلقة':'الفيلم';
  const downloadIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/></svg>';
  if(type==='playback')return `<section class="movie-sources" id="movie-watch"><h2>مشاهدة ${label}</h2><div class="movie-player" id="film-player"><iframe src="${e(selected.url)}" title="مشاهدة ${label} — سيرفر 1" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><h3 class="player-status" id="player-status">سيرفرات المشاهدة</h3><div class="source-links">${links.map((l,i)=>`<button type="button" class="secondary" data-playback="${e(l.url)}" data-server-label="سيرفر ${i+1}" aria-controls="film-player" aria-pressed="${i===0?'true':'false'}"><span class="server-symbol" aria-hidden="true">▶</span><span class="server-caption">سيرفر ${i+1}</span></button>`).join('')}</div>${links.length>1?'<p class="player-help">إذا تعذّر التشغيل، اختر سيرفرًا آخر.</p>':''}</section>`;
  return `<section class="movie-sources"><h2>${type==='downloads'?'سيرفرات التحميل':'سيرفرات المشاهدة'}</h2><div class="source-links">${links.map((l,i)=>`<a class="secondary${type==='downloads'?' download-server':''}" href="${e(l.url)}" target="_blank" rel="nofollow noopener noreferrer">${type==='downloads'?downloadIcon:'▶'} <span>سيرفر ${i+1}</span></a>`).join('')}</div></section>`;
}
export function movieContent(m) {
  const year=(m.release_date||'').slice(0,4);
  const anime=(m.genres||[]).some(g=>g.id===16);
 const region=anime?null:sectionKey(m.original_language);
  const cast=(m.credits?.cast||[]).slice(0,6);
  const related=uniqueMovies((m.recommendations?.results||[]).filter(r=>!r.adult)).slice(0,6);
  const preview=upcomingPreview(m),name=movieDisplayTitle(m);
  const labels=[...(m.genres||[]).map(genreLabel),...(m.is_biography?[movieTopicSections.biography.label]:[])];
  const rating=preview&&!(Number(m.vote_count)>0&&Number(m.vote_average)>0)?'':`<span class="rating">★ ${Number(m.vote_average||0).toFixed(1)} / 10 <small>TMDB</small></span>`;
  const trailerButton=!preview||hasMovieTrailer(m)?`<button class="secondary" data-trailer="movie-${m.id}">▶ الإعلان التشويقي</button>`:'';
  const category=movieCategory(m);
  const director=m.credits?.crew?.find(p=>p.job==='Director')?.name;
  const tags=[m.source_adult_category?`<a href="${adultMovieCategory.path}">أفلام +18</a>`:'',year?`<a href="/movies/year/${year}/">أفلام ${year}</a>`:'',region?`<a href="/movies/${region}/">${movieSections[region].name}</a>`:'',...(m.genres||[]).map(g=>genrePath(g.id)?`<a href="${genrePath(g.id)}">${e(g.name)}</a>`:''),m.is_biography?`<a href="${movieTopicSections.biography.path}">${movieTopicSections.biography.name}</a>`:''].join('');
  const poster=image(m.poster_path),coverImage=poster?`<img class="movie-cover" src="${poster}" alt="${e(name)}" width="300" height="450" fetchpriority="high">`:'';
  const cover=poster&&isFutureMovie(m)?`<div class="movie-cover-wrap">${coverImage}${moviePosterBadge(m)}</div>`:coverImage;
  return `<div class="content movie-detail"><nav class="movie-breadcrumb" aria-label="مسار الصفحة"><a href="/">الرئيسية</a> / <a href="${anime?'/anime/movies/':'/movies/'}">${anime?'أفلام أنمي':'الأفلام'}</a>${category&&category.path!==(anime?'/anime/movies/':'/movies/')?` / <a href="${category.path}">${e(category.name)}</a>`:''}</nav><header class="movie-intro film-masthead${poster?'':' film-masthead--no-cover'}">${image(m.backdrop_path)?`<img class="film-backdrop" src="${image(m.backdrop_path,'w1280')}" alt="" aria-hidden="true">`:''}${cover}<div class="film-heading"><span class="editorial-label">${e(labels.join(' · ')||'سينما')}</span><h1>${e(name)}</h1><div class="meta">${rating}${year?`<span>${year}</span>`:''}${m.runtime?`<span>${m.runtime} دقيقة</span>`:''}</div><div class="actions">${(m.externalSources||[]).some(r=>r.playback?.some(l=>safeLink(l.url)))?'<a class="primary film-watch-cta" href="#movie-watch">▶ مشاهدة الفيلم</a>':'<a class="primary" href="#movie-story">قصة الفيلم</a>'}${trailerButton}</div></div></header>${preview?'':sourceButtons(m,'playback')+sourceButtons(m,'downloads')}<section class="movie-story" id="movie-story"><h2>قصة الفيلم</h2><p>${e(m.overview||'لم تتوفر بعد قصة عربية لهذا الفيلم.')}</p></section><section class="movie-description"><h2>الوصف والتفاصيل</h2><p>${e(movieDescription(m))}</p></section>${movieFacts(m)}<nav class="movie-tags" aria-label="تصنيفات الفيلم">${tags}</nav>${related.length?`<section class="section-gap"><div class="section-heading"><h2>أفلام مشابهة</h2></div><div class="grid">${related.map(card).join('')}</div></section>`:''}</div>`;
}
export function renderSeoPage(template,metadata,content,items=[]) {
  const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
  const clientItems=items.map(m=>({id:m.id,media_type:m.media_type||'movie',name:m.name,series_display_title:m.series_display_title,title:m.title,display_title:m.display_title&&m.media_type!=='tv'?movieDisplayTitle(m):m.display_title,movie_presentation_version:m.movie_presentation_version,public_path:m.public_path,poster_path:m.poster_path,release_date:m.release_date,original_language:m.original_language,genre_ids:m.genre_ids||m.genres?.map(g=>g.id),vote_count:m.vote_count,vote_average:m.vote_average,videos:m.videos}));
  const head=`<link rel="canonical" href="${e(metadata.canonical)}"><meta name="robots" content="${metadata.noindex?'noindex, follow':'index, follow, max-image-preview:large'}"><meta property="og:title" content="${e(metadata.title)}"><meta property="og:description" content="${e(metadata.description)}"><meta property="og:url" content="${e(metadata.canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="سيما هَب"><meta property="og:locale" content="ar_AR"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(metadata.title)}"><meta name="twitter:description" content="${e(metadata.description)}">${metadata.image?`<meta property="og:image" content="${e(metadata.image)}"><meta name="twitter:image" content="${e(metadata.image)}">`:''}<script type="application/ld+json">${json(metadata.schema)}</script>`;
  return template.replace(/<title>[\s\S]*?<\/title>/,()=>`<title>${e(metadata.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/,()=>`<meta name="description" content="${e(metadata.description)}">`)
    .replace('</head>',()=>head+'</head>')
    .replace('<main id="main" tabindex="-1"></main>',()=>`<main id="main" tabindex="-1" data-server-rendered="true">${content}</main><script type="application/json" id="movie-page-data">${json(clientItems)}</script>`)
    .replaceAll('href="#/','href="/#/');
}

// Persist only public publication metadata; secrets and user lists never enter this index.
export function createMovieIndex(directory = new URL('./data/',import.meta.url)) {
  const file=new URL('movie-index.json',directory);
  let queue=Promise.resolve();
  async function read(){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}}
  return {
    async all(){await queue;return read();},
    remember(movies){const work=queue.catch(()=>{}).then(async()=>{
      const index=await read();let changed=false;
      for(const m of movies){if(!usesMoviePresentation(m,'movie')||!m.id||!m.overview)continue;
        const hash=createHash('sha256').update(JSON.stringify([m.title,m.overview,m.poster_path,m.release_date])).digest('hex');
        if(index[m.id]?.hash!==hash||index[m.id]?.path!==(m.public_path||moviePath(m.id))){index[m.id]={path:(m.public_path||moviePath(m.id)),hash,lastmod:new Date().toISOString()};changed=true;}
      }
      if(changed){await mkdir(directory,{recursive:true});await writeFile(new URL('movie-index.tmp',directory),JSON.stringify(index,null,2));await rename(new URL('movie-index.tmp',directory),file);}
    });queue=work;return work;},
  };
}
export function sitemapXml(origin,entries) {return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.map(row=>`<url><loc>${e(new URL(row.path,origin).href)}</loc>${row.lastmod?`<lastmod>${e(row.lastmod)}</lastmod>`:''}${image(row.poster)?`<image:image><image:loc>${e(origin+image(row.poster))}</image:loc></image:image>`:''}</url>`).join('')}</urlset>`;}
