import {localImage,posterPlaceholder} from './public/media-images.js';
import {escapeHtml as e, movieGenres, movieSections, movieDisplayTitle, moviePosterBadge, isFutureMovie} from './movie-seo.js';
import {pagination,MAX_LISTING_PAGES} from './public/pagination.js';

export const tvGenres={action:[10759,'أكشن ومغامرة'],crime:[80,'جريمة'],drama:[18,'دراما'],comedy:[35,'كوميديا'],mystery:[9648,'غموض'],'sci-fi-fantasy':[10765,'خيال علمي وفانتازيا'],animation:[16,'أنمي'],family:[10751,'عائلية'],documentary:[99,'وثائقية'],kids:[10762,'أطفال'],news:[10763,'أخبار'],reality:[10764,'تلفزيون الواقع'],soap:[10766,'دراما يومية'],talk:[10767,'برامج حوارية'],'war-politics':[10768,'حرب وسياسة'],western:[37,'ويسترن']};
export const tvSections={'english-series':'foreign','asian-series':'asian','arabic-series':'arabic','indian-series':'indian','turkish-series':'turkish'};
// Anime collections use supported animation intersections, not every TV genre.
export const animeTvGenres=Object.fromEntries(['action','crime','drama','comedy','mystery','sci-fi-fantasy','family','documentary','kids','reality','talk','war-politics','western'].map(slug=>[slug,tvGenres[slug]]));
const regionNames={foreign:'أجنبية',asian:'آسيوية',arabic:'عربية',indian:'هندية',turkish:'تركية'};
export const animeGenrePaths=[...Object.keys(movieGenres).map(slug=>`/anime/movies/genre/${slug}/`),...Object.keys(animeTvGenres).map(slug=>`/anime/series/genre/${slug}/`)];
export const categoryPaths=['/anime/movies/','/anime/series/',...animeGenrePaths,'/series/',...Object.keys(tvSections).map(key=>`/series-category/${key}/`),...Object.keys(tvGenres).map(key=>`/series-genre/${key}/`)];

export function parseCategoryListing(url){
  if(!categoryPaths.includes(url.pathname))return null;
  const path=url.pathname,anime=path.startsWith('/anime/'),type=path.startsWith('/anime/movies/')?'movie':'tv';
  const genreOptions=type==='movie'?movieGenres:anime?animeTvGenres:tvGenres;
  const params=new URLSearchParams({language:'ar-SA',include_adult:'false','vote_count.gte':'10'});
  let name=anime?(type==='movie'?'أفلام أنمي':'مسلسلات أنمي'):'المسلسلات';
  let region='',baseGenre='';
  if(anime)baseGenre='16';
  const slug=path.split('/')[2];
  if(path.startsWith('/series-category/')){region=tvSections[slug];name=`مسلسلات ${regionNames[region]}`;}
  if(path.startsWith('/series-genre/')){baseGenre=String(tvGenres[slug][0]);name=`مسلسلات ${tvGenres[slug][1]}`;}
  const genreSlug=anime&&path.includes('/genre/')?path.split('/')[4]:undefined;
  const namedGenre=genreSlug?String(genreOptions[genreSlug][0]):'';
  if(genreSlug)name+=' '+genreOptions[genreSlug][1];
  const query=new URLSearchParams();
  const page=Number(url.searchParams.get('page')||1);
  if(!Number.isInteger(page)||page<1||page>MAX_LISTING_PAGES)return null;
  const newest=type==='movie'?'primary_release_date.desc':'first_air_date.desc';
  const sort=url.searchParams.get('sort')||'popularity.desc';
  if(!['popularity.desc','vote_average.desc',newest].includes(sort))return null;
  const year=url.searchParams.get('year')||'',genre=url.searchParams.get('genre')||'';
  const selectedRegion=url.searchParams.get('region')||region;
  if(year&&!/^(19|20)\d{2}$/.test(year))return null;
  if(genre&&!Object.values(genreOptions).some(([id])=>String(id)===genre))return null;
  if(selectedRegion&&!Object.hasOwn(movieSections,selectedRegion))return null;
  if(region&&selectedRegion!==region)return null;
  if(baseGenre||genre)params.set('with_genres',[...new Set([baseGenre,namedGenre,genre].filter(Boolean))].join(','));
  if(selectedRegion)params.set('with_original_language',movieSections[selectedRegion].language);
  if(year){params.set(type==='movie'?'primary_release_year':'first_air_date_year',year);query.set('year',year);}
  if(genre&&genre!==baseGenre&&genre!==namedGenre)query.set('genre',genre);
  if(selectedRegion&&selectedRegion!==region)query.set('region',selectedRegion);
  if(sort!=='popularity.desc')query.set('sort',sort);
  if(page>1)query.set('page',String(page));
  params.set('sort_by',sort);params.set('page',String(page));
  if(sort==='vote_average.desc')params.set('vote_count.gte','200');
  const currentYear=new Date().getFullYear();
  const translated=region==='arabic'?'':' مترجمة';
  const seoName=name==='المسلسلات'?'مسلسلات عربية وأجنبية':name;
  const seoTitle=`مشاهدة وتحميل ${seoName} ${currentYear}${translated} كاملة HD اون لاين`;
  const regionalDescriptions={
    foreign:`مشاهدة وتحميل مسلسلات أجنبية ${currentYear} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب. أحدث المسلسلات الأمريكية والبريطانية بجميع المواسم والحلقات وروابط التحميل المباشرة.`,
    asian:`مشاهدة وتحميل مسلسلات آسيوية كورية ويابانية وصينية ${currentYear} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب، مع أحدث الحلقات والمواسم وروابط المشاهدة والتحميل المباشرة.`,
    arabic:`مشاهدة وتحميل مسلسلات عربية ومصرية ${currentYear} كاملة بجودة عالية HD اون لاين على سيما هَب، مع أحدث المسلسلات العربية وجميع المواسم والحلقات وسيرفرات المشاهدة وروابط التحميل.`,
    indian:`مشاهدة وتحميل مسلسلات هندية ${currentYear} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب. مسلسلات هندية رومانسية ودرامية بجميع المواسم والحلقات وروابط التحميل المباشرة.`,
    turkish:`مشاهدة وتحميل مسلسلات تركية ${currentYear} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب، مع أحدث حلقات المسلسلات التركية الرومانسية والدرامية وجميع المواسم وروابط التحميل المباشرة.`
  };
  const description=region?regionalDescriptions[region]:anime
    ?`مشاهدة وتحميل ${name} ${currentYear} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب. ${type==='tv'?'أحدث حلقات الأنمي وجميع المواسم والحلقات':'أحدث أفلام الأنمي المترجمة'} مع سيرفرات المشاهدة وروابط التحميل المباشرة.`
    :name==='المسلسلات'
      ?`مشاهدة وتحميل مسلسلات عربية وأجنبية وآسيوية وهندية وتركية ${currentYear} كاملة بجودة عالية HD اون لاين على سيما هَب، مع المسلسلات المترجمة وجميع المواسم والحلقات وروابط التحميل المباشرة.`
      :`مشاهدة وتحميل ${name} ${currentYear} مترجمة كاملة بجودة عالية HD اون لاين على سيما هَب، مع جميع المواسم والحلقات وأحدث المسلسلات وروابط المشاهدة والتحميل المباشرة.`;
  return {path,name,description,seoTitle,type,anime,params,page,genreOptions,baseGenre,namedGenre,genreSlug,region,selectedRegion,genre,year,sort,canonicalPath:path+(query.size?'?'+query:''),noindex:['year','genre','region','sort'].some(key=>query.has(key))};
}

const poster=m=>localImage(m.poster_path);
const title=m=>m.display_title&&m.title&&!m.name?movieDisplayTitle(m):m.display_title||m.series_display_title||m.title||m.name;
const detail=(m,type)=>m.public_path||(m.movie_presentation_version?`/movie/${m.id}/`:`/#/details/${type}/${m.id}`);
export function categoryItems(data,listing){
  const seen=new Set();
  return (data.results||[]).filter(m=>{
    if(m.adult||seen.has(m.id))return false;
    const ids=m.genre_ids||m.genres?.map(g=>g.id)||[];
    if(listing.anime&&!ids.includes(16))return false;
    seen.add(m.id);return true;
  });
}
export function categoryMetadata(listing,items,origin){
  const canonical=origin+listing.canonicalPath;
  const name=listing.name+(listing.page>1?` — الصفحة ${listing.page}`:'');
  const breadcrumbs=[{name:'الرئيسية',item:origin+'/'},...(listing.path==='/series/'?[]:!listing.anime?[{name:'المسلسلات',item:origin+'/series/'}]:[]),{name:listing.name,item:canonical}];
  const graph=[
    {'@type':'CollectionPage','@id':canonical+'#page',url:canonical,name,description:listing.description,inLanguage:'ar',mainEntity:{'@type':'ItemList',itemListElement:items.map((m,i)=>({'@type':'ListItem',position:(listing.page-1)*20+i+1,name:title(m),url:origin+detail(m,listing.type)}))}},
    {'@type':'BreadcrumbList',itemListElement:breadcrumbs.map((item,i)=>({'@type':'ListItem',position:i+1,...item}))},
  ];
  return {title:`${listing.seoTitle}${listing.page>1?' — الصفحة '+listing.page:''} | سيما هَب`,description:(listing.page>1?`الصفحة ${listing.page}: `:'')+listing.description,canonical,noindex:listing.noindex||!items.length,image:poster(items[0]||{})?origin+poster(items[0]):undefined,schema:{'@context':'https://schema.org','@graph':graph}};
}
export function categoryContent(listing,items,totalPages){
  const select=(name,label,values,current)=>`<select name="${name}" aria-label="${label}">${values.map(([value,text])=>`<option value="${e(value)}"${String(value)===String(current)?' selected':''}>${e(text)}</option>`).join('')}</select>`;
  const newest=listing.type==='movie'?'primary_release_date.desc':'first_air_date.desc';
  const fixedGenre=Object.values(listing.genreOptions).find(([id])=>String(id)===(listing.namedGenre||listing.baseGenre));
  const filters=select('genre',fixedGenre?'نوع إضافي':'النوع',[['',fixedGenre?`${fixedGenre[1]} — كل النتائج`:'كل الأنواع'],...Object.values(listing.genreOptions).filter(([id])=>String(id)!==listing.baseGenre&&String(id)!==listing.namedGenre)],listing.genre)
    +select('year','سنة الإصدار',[['','كل السنوات'],...Array.from({length:50},(_,i)=>{const year=new Date().getFullYear()-i;return [year,year];})],listing.year)
    +(!listing.region?select('region','القسم',[['','كل الأقسام'],...Object.entries(regionNames)],listing.selectedRegion):'')
    +select('sort','الترتيب',[['popularity.desc','الأكثر شعبية'],['vote_average.desc','الأعلى تقييمًا'],[newest,'الأحدث إصدارًا']],listing.sort);
  const categoryLinks=listing.anime?[['/anime/movies/','أفلام أنمي'],['/anime/series/','مسلسلات أنمي']]:[['/series/','كل المسلسلات'],...Object.entries(tvSections).map(([slug,region])=>[`/series-category/${slug}/`,`مسلسلات ${regionNames[region]}`])];
  const genreLinks=Object.entries(listing.genreOptions).map(([slug,[,name]])=>[listing.anime?`/anime/${listing.type==='tv'?'series':'movies'}/genre/${slug}/`:listing.type==='tv'?`/series-genre/${slug}/`:`/movies/genre/${slug}/`,`${listing.type==='tv'?'مسلسلات':'أفلام'}${listing.anime?' أنمي':''} ${name}`]).filter(([path])=>!path.endsWith('/animation/'));
  const links=categoryLinks.map(([path,name])=>`<a href="${path}"${path===listing.path?' aria-current="page"':''}>${name}</a>`).join('');
  const cards=items.map(m=>`<article class="card"><a class="poster-link" href="${e(detail(m,listing.type))}" title="${e(title(m))}" aria-label="${e(title(m))}">${poster(m)?`<img src="${poster(m)}" alt="${e(title(m))}" loading="lazy" width="300" height="450">`:posterPlaceholder(m.title||m.name,(m.release_date||m.first_air_date||'').slice(0,4))}${listing.type==='movie'?moviePosterBadge(m):''}${listing.type==='movie'&&isFutureMovie(m)&&!(Number(m.vote_count)>0&&Number(m.vote_average)>0)?'':`<span class="poster-rating">★ ${Number(m.vote_average||0).toFixed(1)}</span>`}</a><h3><a href="${e(detail(m,listing.type))}" dir="auto">${e(title(m))}</a></h3><div class="card-info"><span>${e((m.release_date||m.first_air_date||'').slice(0,4))}</span></div></article>`).join('');
  const pageLink=page=>{const query=new URLSearchParams(listing.canonicalPath.split('?')[1]);query.delete('page');if(page>1)query.set('page',page);return listing.path+(query.size?'?'+query:'');};
  return `<div class="content"><nav class="movie-breadcrumb" aria-label="مسار الصفحة"><a href="/">الرئيسية</a> / <span aria-current="page">${e(listing.name)}</span></nav><div class="page-heading${listing.anime?' anime-category-heading':''}"><h1>${e(listing.name)}</h1>${listing.anime?`<nav class="anime-category-switch" aria-label="فئات الأنمي">${links}</nav>`:''}<p>${e(listing.description)}</p></div><form class="filters" action="${listing.path}" method="get">${filters}<div class="filter-actions"><button class="primary" type="submit">تطبيق</button><a class="filter-reset" href="${listing.path}">مسح الفلاتر</a></div></form>${items.length?`<div class="grid catalog-grid">${cards}</div>`:`<div class="empty filter-empty"><h2>لا توجد نتائج تطابق هذه الفلاتر</h2><a class="secondary" href="${listing.path}">مسح الفلاتر</a></div>`}${pagination(listing.page,totalPages,pageLink)}${!listing.anime?`<nav class="movie-tags" aria-label="فئات المسلسلات">${links}</nav>`:''}<nav class="movie-tags" aria-label="أنواع الأعمال">${genreLinks.map(([path,name])=>`<a href="${path}">${e(name)}</a>`).join('')}</nav></div>`;
}
