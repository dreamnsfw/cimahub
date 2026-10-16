import {cleanStory} from './story-language.js';
import {movieAudience} from './movie-certification.js';
import {englishWorkName,resolveEnglishMetadata} from './title-language.js';
// Animation uses its own presentation policy.
export function usesMoviePresentation(item, fallbackType) {
  const type = item.media_type || fallbackType || (item.title ? 'movie' : 'tv');
  const genres = item.genre_ids || item.genres?.map(genre => genre.id) || [];
  return type === 'movie' && !genres.includes(16);
}

export function selectMovieImage(images = [], originalLanguage) {
  for (const language of [...new Set(['en', originalLanguage, null])]) {
    if (language === undefined) continue;
    const candidates = images.filter(image => image.iso_639_1 === language);
    candidates.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0));
    if (candidates.length) return candidates[0].file_path;
  }
  // Never fall back to an unrelated localized poster.
  return null;
}

export function movieIdentityTitle(item) {
  const anime=(item.genre_ids||item.genres?.map(genre=>genre.id)||[]).includes(16);
  return ['مشاهدة فيلم'+(anime?' أنمي':''),item.title||item.original_title||'Untitled',(item.release_date||'').slice(0,4),item.original_language==='ar'?'':'مترجم'].filter(Boolean).join(' ');
}

export function presentMovie(item, english, fallbackType) {
  if (!usesMoviePresentation(item, fallbackType)) return item;
  const arabic=(item.original_language||english.original_language)==='ar';
  const name = arabic?(item.original_title||item.title||english.original_title):(englishWorkName(english)||englishWorkName(item)||'Untitled');
  return {
    ...item,
    ...movieAudience(item,english),
    english_title: englishWorkName(english),
    title: name,
    display_title: movieIdentityTitle({...item,title:name,release_date:item.release_date||english.release_date,original_language:item.original_language||english.original_language}),
    poster_path: selectMovieImage(english.images?.posters, item.original_language || english.original_language) || item.poster_path || english.poster_path,
    backdrop_path: selectMovieImage(english.images?.backdrops, item.original_language || english.original_language) || item.backdrop_path || english.backdrop_path,
    movie_presentation_version: 1,
  };
}

export async function applyMoviePresentation(data, endpoint, load, translate) {
  const type = endpoint.startsWith('movie/') || endpoint === 'discover/movie' ? 'movie'
    : endpoint.startsWith('tv/') || endpoint === 'discover/tv' ? 'tv' : undefined;
  async function update(item, fallback, detail = false) {
    if (!usesMoviePresentation(item, fallback)) return item;
    let english = await load(`movie/${item.id}`, new URLSearchParams({
      language: 'en-US', append_to_response: 'images,release_dates',
      include_image_language: [...new Set(['en', item.original_language, 'null'].filter(Boolean))].join(','),
    })).catch(() => item);
    if((item.original_language||english.original_language)!=='ar')english=await resolveEnglishMetadata(item,english,'movie',load);
    const result = presentMovie(item, english, fallback);
    if (!result.overview?.trim() && translate) {
      let source = english.overview;
      let language = 'en';
      if (!source?.trim() && detail && item.original_language && !['en', 'ar'].includes(item.original_language)) {
        try {
          const original = await load(`movie/${item.id}`, new URLSearchParams({language:item.original_language}));
          source = original.overview; language = item.original_language;
        } catch { /* Missing source must not prevent the movie from loading. */ }
      }
      result.overview = await translate({id:item.id, text:source, language, cachedOnly:!detail}) || result.overview;
    }
    result.overview=await cleanStory({...item,overview:result.overview},english,translate,{cachedOnly:!detail});
    return result;
  }
  async function updateList(list, fallback) {
    const output = [...list];
    let cursor = 0;
    await Promise.all(Array.from({length: Math.min(5, list.length)}, async () => {
      while (cursor < list.length) { const index = cursor++; output[index] = await update(list[index], fallback); }
    }));
    return output;
  }
  if (Array.isArray(data.results)) return {...data, results: await updateList(data.results, type)};
  if (/^(movie|tv)\/\d+$/.test(endpoint)) {
    const result = await update(data, type, true);
    if (result.recommendations?.results) return {...result, recommendations: {
      ...result.recommendations, results: await updateList(result.recommendations.results, type),
    }};
    return result;
  }
  return data;
}
