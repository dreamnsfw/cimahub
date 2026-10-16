const words=value=>String(value||'').normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
const useful=value=>words(value).filter(w=>!['the','of','and','a','an','in','on','with','for','to'].includes(w));
const titleOf=work=>work.name||'';
function distance(a,b){
 let previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=next;}
 return previous[b.length];
}
export function suggestedQuery(query,works){
 const term=words(query).join('');if(!/^[a-z]{5,40}$/.test(term))return;
 const dictionary=new Map();for(const work of works){if(work.adult)continue;for(const word of new Set(words(titleOf(work))))if(/^[a-z]{5,40}$/.test(word))dictionary.set(word,(dictionary.get(word)||0)+1);}
 const signature=value=>[...value].sort().join(''),candidates=[];
 for(const [word,count] of dictionary){
  if(word===term)return words(query).length>1?word:undefined;
  if(Math.abs(word.length-term.length)>2)continue;
  const edit=distance(term,word),reordered=word.length===term.length&&signature(word)===signature(term);
  if(edit<=(term.length>=8?2:1)||reordered)candidates.push({word,edit:reordered?Math.min(edit,2):edit,count});
 }
 candidates.sort((a,b)=>a.edit-b.edit||b.count-a.count);
 if(candidates.length===1||candidates[0]&&(candidates[0].edit<candidates[1].edit||candidates[0].count>candidates[1].count))return candidates[0].word;
}
export function matchingWorks(query,works){
 const tokens=useful(query),compact=tokens.join('');if(!compact)return [];
 return works.filter(w=>['movie','tv'].includes(w.type)&&!w.adult).map(work=>{
  const name=useful(titleOf(work)).join(''),full=name+(work.year||'');
  const score=name===compact?3:full.includes(compact)?2:tokens.length>1&&tokens.every(t=>full.includes(t))?1:0;
  return {work,score};
 }).filter(r=>r.score).sort((a,b)=>b.score-a.score).map(r=>r.work);
}
export async function searchWithCatalog({query,page=1,remote,works,load}){
 const data=await remote(query,page);
 if((data.results||[]).some(m=>!m.adult&&m.media_type!=='person'))return data;
 const known=await works(),suggestion=suggestedQuery(query,known);
 if(suggestion){const related=await remote(suggestion,page);if((related.results||[]).some(m=>!m.adult&&m.media_type!=='person'))return {...related,corrected_query:suggestion};}
 const seen=new Set(),matches=matchingWorks(query,known).filter(m=>{const key=m.type+':'+m.id;if(seen.has(key))return false;seen.add(key);return true;});
 if(!matches.length)return data;
 const slice=matches.slice((page-1)*20,page*20),results=[];
 for(let i=0;i<slice.length;i+=4)results.push(...await Promise.all(slice.slice(i,i+4).map(async m=>({...await load(m),media_type:m.type}))));
 return {...data,page,total_results:matches.length,total_pages:Math.ceil(matches.length/20),results};
}
