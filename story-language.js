export const hasEastAsianText=text=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text||'');
export const hasUnsupportedText=text=>/(?![\p{Script=Latin}\p{Script=Arabic}])\p{L}/u.test(text||'');
export function cleanCredits(credits,english){
 const result={...credits};
 for(const field of ['cast','crew'])result[field]=(credits?.[field]||[]).map(person=>{
  const translated=(english?.[field]||[]).find(p=>p.id===person.id);
  const name=hasUnsupportedText(person.name)?translated?.name:person.name;
  const character=hasUnsupportedText(person.character)?translated?.character:person.character;
  return {...person,name:name&&!hasUnsupportedText(name)?name:'',character:hasUnsupportedText(character)?'':character};
 }).filter(person=>person.name);
 return result;
}

// Replace known names exactly; never delete unknown names from a sentence.
export async function cleanStory(item,english,translate,{cachedOnly=false}={}){
 let story=item.overview||'';
 const name=english?.title||english?.name;
 if(name&&!hasUnsupportedText(name)){
  for(const original of [item.original_title,item.original_name,english?.original_title,english?.original_name]){
   if(original&&hasUnsupportedText(original))story=story.replaceAll(original,name);
  }
 }
 if(!hasUnsupportedText(story))return story;
 const source=english?.overview;
 if(!source||hasUnsupportedText(source))return '';
 const translated=translate?await translate({id:item.id,text:source,language:'en',cachedOnly}):'';
 return translated&&!hasUnsupportedText(translated)?translated:source;
}
