import {escapeHtml as e} from './movie-seo.js';
import {localImage} from './public/media-images.js';
import {mediaLink,seriesLink} from './public/media-links.js';
import {hdSuffix,summary} from './seo-content.js';

export const seasonLabel=n=>({1:'الأول',2:'الثاني',3:'الثالث',4:'الرابع',5:'الخامس',6:'السادس',7:'السابع',8:'الثامن',9:'التاسع',10:'العاشر'}[n]||String(n));
export function seriesTitle(m,season,episode,{includeSeriesYear=true}={}){
 const anime=(m.genres||[]).some(g=>g.id===16),name=m.original_name||m.name;
 return [`مسلسل${anime?' أنمي':''}`,name,includeSeriesYear?(m.first_air_date||'').slice(0,4):'',season?`الموسم ${seasonLabel(season)}`:'',episode?`الحلقة ${episode}`:'',m.original_language==='ar'?'':episode?'مترجمة':'مترجم',episode?'':'كامل'].filter(Boolean).join(' ');
}
export function seriesPage(m,origin,{season,episode,seasonData,episodeData,player=''}={}){
 const anime=m.genres?.some(g=>g.id===16),category=anime?'/anime/series/':'/series/',categoryName=anime?'مسلسلات أنمي':'المسلسلات';
 const name=seriesTitle(m,season,episode),path=seriesLink(m,season,episode),canonical=origin+path;
 const story=(episode?episodeData?.overview:season?seasonData?.overview:m.overview)||'';
 const storyHeading=episode?'قصة الحلقة':season?'قصة الموسم':anime?'قصة الأنمي':'قصة المسلسل';
 const description=summary(`مشاهدة وتحميل ${name}${hdSuffix(m)} اون لاين على سيما هَب. ${story||'روابط مشاهدة وتحميل المواسم والحلقات.'}`);
 const crumb=[{name:'الرئيسية',item:origin+'/'},{name:categoryName,item:origin+category},{name:m.original_name||m.name,item:origin+mediaLink(m)}];
 if(season)crumb.push({name:`الموسم ${seasonLabel(season)}`,item:origin+seriesLink(m,season)});
 if(episode)crumb.push({name:`الحلقة ${episode}`,item:canonical});
 const type=episode?'TVEpisode':season?'TVSeason':'TVSeries';
 const entity={'@type':type,'@id':canonical+'#work',name,url:canonical,description:story||description,inLanguage:m.original_language,...(m.poster_path?{image:origin+localImage(m.poster_path)}:{}),...(player.includes('<iframe')?{potentialAction:{'@type':'WatchAction',target:canonical+'#movie-watch'}}:{})};
 if(season){entity.seasonNumber=season;entity.partOfSeries={'@type':'TVSeries',name:m.original_name||m.name,url:origin+mediaLink(m)};}
 if(episode){delete entity.seasonNumber;entity.episodeNumber=episode;entity.partOfSeason={'@type':'TVSeason',seasonNumber:season,url:origin+seriesLink(m,season)};}
 const date=episode?episodeData?.air_date:season?seasonData?.air_date:m.first_air_date;
 if(date)entity.datePublished=date;
 if(!season&&m.number_of_episodes)entity.numberOfEpisodes=m.number_of_episodes;
 if(!season&&m.number_of_seasons)entity.numberOfSeasons=m.number_of_seasons;
 if(season&&!episode&&seasonData?.episodes)entity.numberOfEpisodes=seasonData.episodes.length;
 const useful=!!story||player.includes('<iframe')||(season&&!episode?seasonData?.episodes?.length>0:!season?m.seasons?.some(s=>s.season_number>0):!!(episodeData?.air_date&&episodeData?.name&&seasonData?.episodes?.length));
 const metadata={title:`مشاهدة ${name}${hdSuffix(m)} | سيما هَب`,description,canonical,image:m.poster_path?origin+localImage(m.poster_path):undefined,noindex:!useful,schema:{'@context':'https://schema.org','@graph':[entity,{'@type':'BreadcrumbList',itemListElement:crumb.map((c,i)=>({'@type':'ListItem',position:i+1,...c}))}]}};
 const ratingSubject=episodeData?.vote_count?episodeData:seasonData?.vote_count?seasonData:m;
 const ratingLabel=ratingSubject===m&&(season||episode)?'تقييم المسلسل · TMDB':'TMDB';
 const titleAttr=e(name),poster=localImage(m.poster_path),backdrop=localImage(m.backdrop_path,'w1280');
 let language=m.original_language||'';try{if(language)language=new Intl.DisplayNames(['ar'],{type:'language'}).of(language);}catch{}
 const header=`<section class="hero detail-hero series-detail-hero" aria-label="تفاصيل العمل">${backdrop?`<img class="hero-image" src="${backdrop}" alt="" fetchpriority="high">`:''}${poster?`<img class="series-mobile-cover" src="${poster}" alt="${titleAttr}" width="150" height="225">`:''}<div class="hero-content"><div class="eyebrow"><span class="dot"></span><a href="${category}">${categoryName}</a></div><h1 dir="auto">${titleAttr}</h1><div class="meta"><span class="rating">★ ${Number(ratingSubject.vote_average||0).toFixed(1)} <small>${ratingLabel}</small></span><span>${e((m.first_air_date||'').slice(0,4))}</span>${language?`<span class="badge">${e(language)}</span>`:''}${date?`<time datetime="${e(date)}">${e(date)}</time>`:''}</div><div class="actions"><button class="primary" data-trailer="tv-${m.id}">▶ الإعلان التشويقي</button>${player.includes('<iframe')?'<a class="secondary" href="#movie-watch">مشاهدة الحلقة</a>':story?`<a class="secondary" href="#work-story">${storyHeading}</a>`:''}</div></div></section>`;
 const seasons=(m.seasons||[]).filter(s=>s.season_number>0).sort((a,b)=>b.season_number-a.season_number);
 const seasonCards=seasons.map(s=>{const label=seriesTitle(m,s.season_number);return `<article class="card season-card"><a class="poster-link" href="${e(seriesLink(m,s.season_number))}" title="${e(label)}">${poster?`<img src="${localImage(s.poster_path)||poster}" alt="${e(label)}" loading="lazy" width="300" height="450">`:''}<span class="poster-type">الموسم ${seasonLabel(s.season_number)}</span></a><h3><a href="${e(seriesLink(m,s.season_number))}">${e(label)}</a></h3></article>`;}).join('');
 const episodes=(seasonData?.episodes||[]).filter(x=>x.episode_number>0).sort((a,b)=>a.episode_number-b.episode_number);
 const episodeLinks=episodes.map(x=>`<a class="episode-button" href="${e(seriesLink(m,season,x.episode_number))}" title="${e(seriesTitle(m,season,x.episode_number))}"${x.episode_number===episode?' aria-current="page"':''}>الحلقة ${x.episode_number}</a>`).join('');
 const genres=(m.genres||[]).map(g=>g.id===16?'أنمي':g.name).join('، ');
 const content=`${header}<div class="content series-detail-content"><nav class="series-breadcrumb" aria-label="مسار التصفح">${crumb.map(c=>`<a href="${e(new URL(c.item).pathname)}">${e(c.name)}</a>`).join(' / ')}</nav>${episode?`<section class="episode-page"><h2>الحلقة ${episode}</h2>${date?`<p>تاريخ العرض: <time datetime="${e(date)}">${e(date)}</time></p>`:''}<a class="secondary" href="${e(seriesLink(m,season))}">جميع حلقات الموسم</a></section>${player}`:''}${story?`<section class="movie-story" id="work-story"><h2>${storyHeading}</h2><p>${e(story)}</p></section>`:''}<section class="movie-description"><h2>الوصف والتفاصيل</h2><p>مشاهدة وتحميل ${e(name)}${e(hdSuffix(m))} اون لاين على سيما هَب. ${genres?`من تصنيف ${e(genres)}. `:''}${language?`اللغة الأصلية: ${e(language)}. `:''}${episode?`جميع حلقات الموسم ${seasonLabel(season)}.`:season?`يضم هذا الموسم ${episodes.length} حلقات مدرجة.`:`المواسم والحلقات: ${seasons.length} مواسم مدرجة لهذا العمل.`}</p></section>${season?`<section class="season-episodes"><h2>حلقات الموسم ${seasonLabel(season)}</h2><div class="episode-grid">${episodeLinks||'<p>لا توجد حلقات مدرجة.</p>'}</div></section>`:''}${seasons.length?`<section class="series-seasons"><h2>مواسم ${anime?'الأنمي':'المسلسل'}</h2><div class="grid">${seasonCards}</div></section>`:''}</div>`;
 return {metadata,content};
}
