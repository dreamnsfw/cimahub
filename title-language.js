// A requested English locale may still return the untranslated original title.
const normalizedTitle=value=>typeof value==='string'?value.replace(/\p{Cf}/gu,'').trim():'';
export const latinTitle=value=>{const name=normalizedTitle(value);return /[\p{Script=Latin}0-9]/u.test(name)&&!/[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\p{S}]/u.test(name);};
export const englishWorkName=item=>[item?.english_title,item?.title,item?.name,item?.original_title,item?.original_name].map(normalizedTitle).find(latinTitle);

export async function resolveEnglishMetadata(item,english,type,load){
 const name=englishWorkName(english)||englishWorkName(item);
 const language=item.original_language||english.original_language;
 const original=normalizedTitle(item[type==='tv'?'original_name':'original_title']||english[type==='tv'?'original_name':'original_title']);
 // Latin letters alone do not establish that a Spanish or Portuguese name is English.
 const untranslated=language&&language!=='en'&&name&&name===original;
 if(name&&!untranslated)return {...english,[type==='tv'?'name':'title']:name};
 try{
  const details=await load(`${type}/${item.id}`,new URLSearchParams({language:'en-US',append_to_response:'alternative_titles,translations'}));
  const translated=details.translations?.translations?.find(t=>t.iso_639_1==='en'&&latinTitle(t.data?.[type==='tv'?'name':'title']));
  const alternatives=details.alternative_titles?.titles||details.alternative_titles?.results||[];
  const alternative=alternatives.find(t=>latinTitle(t.title)&&/english/i.test(t.type||''))||alternatives.find(t=>latinTitle(t.title)&&['US','GB','AU','CA','NZ','IE'].includes(t.iso_3166_1));
  const resolved=translated?.data?.[type==='tv'?'name':'title']||alternative?.title;
  if(resolved)return {...english,[type==='tv'?'name':'title']:normalizedTitle(resolved)};
 }catch{/* Leave an unavailable name unresolved rather than inventing a translation. */}
 return english;
}
