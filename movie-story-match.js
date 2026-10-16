const stop=new Set('التي الذي هذا هذه هناك بينما حيث بعد قبل خلال حول يجد نفسه يصبح تصبح بين على الى إلى عن من في مع ان أن هو هي ثم كل حتى قد كان كانت حياة'.split(' '));
function words(text){return new Set((text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=4&&!stop.has(w)).map(w=>w.replace(/^ال/,'')));}
export function storyScore(left,right){const a=words(left),b=words(right);const common=[...a].filter(w=>b.has(w)).length;return {common,coverage:common/Math.max(1,Math.min(a.size,b.size))};}
export function extractStory(html){return (html.match(/class=["'][^"']*\bStoryBoxText\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'').replace(/<[^>]+>/g,' ').replace(/&[a-z0-9#]+;/gi,' ');}
// Call only after independently checking title and release year for every candidate.
export async function matchByStory(story,candidates,loadMovie){
  if(!story.trim()||!candidates.length)return null;
  const ranked=[];
  for(const movie of candidates){
    const arabic=await loadMovie(`movie/${movie.id}`,new URLSearchParams({language:'ar-SA'}));
    const overview=arabic.overview;
    // Missing competing evidence must not turn an ambiguous name into a unique match.
    if(!overview)return null;
    ranked.push({movie,...storyScore(story,overview)});
  }
  ranked.sort((a,b)=>b.coverage-a.coverage);
  const best=ranked[0],second=ranked[1];
  if(best.common<6||best.coverage<0.6||(second&&best.coverage-second.coverage<0.2))return null;
  return {...best.movie,storyEvidence:{method:'arabic-story-overlap',common:best.common,coverage:best.coverage,runnerUpCoverage:second?.coverage??null}};
}
