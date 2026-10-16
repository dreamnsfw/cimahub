export const mediaType=m=>m.media_type|| (m.name?'tv':'movie');
export const mediaLink=m=>m.public_path||(m.movie_presentation_version?`/movie/${m.id}/`:`/#/details/${mediaType(m)}/${m.id}`);
export function seriesLink(m,season,episode){
 if(!season)return mediaLink(m);
 return m.public_path?`${m.public_path}season/${season}/${episode?`episode/${episode}/`:''}`:`/#/details/tv/${m.id}/season/${season}${episode?`/episode/${episode}`:''}`;
}
