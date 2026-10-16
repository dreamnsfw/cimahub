import {query,dbEnabled} from './database.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const statuses=new Set(['published','draft','hidden']);
const textFields={name:500,overview:30000,seo_title:500,seo_description:2000};
const imageFields=new Set(['poster_path','still_path']);
const numberFields={runtime:1440,episode_count:10000};
const partNumber=(value,max,label)=>{const n=Number(value);if((typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))||!Number.isInteger(n)||n<0||n>max)throw fail(400,`${label} is invalid.`);return n;};
const seasonNumber=value=>{const n=partNumber(value,1000,'Season number');if(!n)throw fail(400,'Season numbers start at 1.');return n;};
const coordinates=(season,episode)=>({season_number:seasonNumber(season),episode_number:partNumber(episode,10000,'Episode number')});
const identity=row=>`${row.season_number}:${row.episode_number}`;
const publicData=data=>Object.fromEntries(Object.entries(data||{}).filter(([key])=>key!=='status'));
const published=row=>!row?.data?.status||row.data.status==='published';

export function validatePartData(body,{creating=false}={}){
 if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Season or episode data is invalid.');
 const data={};
 for(const [key,value]of Object.entries(body)){
  if(Object.hasOwn(textFields,key)){if(typeof value!=='string'||value.length>textFields[key])throw fail(400,'Text value is invalid.');data[key]=value.trim();if(key==='name'&&!data.name)throw fail(400,'Season or episode name is required.');}
  else if(imageFields.has(key)){
   if(value===null||value===''){data[key]=null;continue;}
   if(typeof value!=='string'||!/^\/[a-zA-Z0-9_-]+\.(?:jpg|png|webp)$/.test(value))throw fail(400,'Use an image path from the site media library.');data[key]=value;
  }else if(key==='air_date'){
   if(value===null||value===''){data[key]=null;continue;}
   if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw fail(400,'Air date is invalid.');
   const date=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw fail(400,'Air date is invalid.');data[key]=value;
  }else if(Object.hasOwn(numberFields,key)){if(value===null||value===''){data[key]=null;continue;}data[key]=partNumber(value,numberFields[key],'Numeric value');}
  else if(key==='status'){if(!statuses.has(value))throw fail(400,'Publication status is invalid.');data.status=value;}
  else if(key==='noindex'){if(typeof value!=='boolean')throw fail(400,'Indexing preference is invalid.');data.noindex=value;}
 }
 if(creating){if(!data.name)throw fail(400,'Season or episode name is required.');data.status??='published';}
 if(!Object.keys(data).length)throw fail(400,'Choose season or episode fields to update.');
 return data;
}
function providerRow(data,season,episode=0){
 return {...coordinates(season,episode),data:{...data,status:'published'},manual:false};
}
export function mergePartRows(provider=[],manual=[]){
 const rows=new Map(provider.map(row=>[identity(row),row]));
 for(const row of manual){const old=rows.get(identity(row));rows.set(identity(row),{...old,...row,data:{...old?.data,...row.data},manual:true});}
 return [...rows.values()].sort((a,b)=>a.season_number-b.season_number||a.episode_number-b.episode_number);
}
async function rowsFor(key,{season,queryFn=query}={}){
 return (await queryFn('SELECT season_number,episode_number,data,updated_at FROM content_parts WHERE content_key=$1'+(season===undefined?'':' AND season_number=$2')+' ORDER BY season_number,episode_number',season===undefined?[key]:[key,season])).rows;
}

export async function handleParts({req,url,body,loadTMDB,queryFn=query}){
 const path=decodeURIComponent(url.pathname);
 const match=path.match(/^\/api\/admin\/content\/((?:movie|tv):[1-9]\d{0,14})\/parts(?:\/(\d+)\/(\d+))?\/?$/);
 if(!match)return {handled:false};
 const key=match[1],item=(await queryFn('SELECT * FROM content_items WHERE key=$1',[key])).rows[0];
 if(!item)throw fail(404,'Content was not found.');
 if(item.kind!=='tv'||!key.startsWith('tv:'))throw fail(400,'Seasons and episodes are only available for series.');
 const selected=match[2]===undefined?null:coordinates(match[2],match[3]);
 const providerId=item.provider_id||Number(key.split(':')[1]);
 const snapshots=item.snapshot&&typeof item.snapshot==='object'?item.snapshot:{};
 const loaded=new Map();
 async function provider(endpoint,fallback){
  if(!loaded.has(endpoint))loaded.set(endpoint,(async()=>{try{if(!loadTMDB)return {data:fallback,unavailable:true};return {data:await loadTMDB(endpoint,new URLSearchParams({language:'ar-SA'})),unavailable:false};}catch{return {data:fallback,unavailable:true};}})());
  return loaded.get(endpoint);
 }
 async function providerParts(season){
  if(season===undefined){const work=await provider('tv/'+providerId,snapshots);return {items:(work.data.seasons||[]).filter(value=>value.season_number>0).map(value=>providerRow(value,value.season_number)),unavailable:work.unavailable};}
  const work=await provider('tv/'+providerId,snapshots);
  const details=await provider(`tv/${providerId}/season/${season}`,{});
  const parent=(work.data.seasons||[]).find(value=>value.season_number===season);
  const seasonData=parent||details.data.name?{...parent,...details.data}:null;
  return {items:[...(seasonData?[providerRow(Object.fromEntries(Object.entries(seasonData).filter(([field])=>field!=='episodes')),season)]:[]),...(details.data.episodes||[]).map(value=>providerRow(value,season,value.episode_number))],unavailable:details.unavailable};
 }
 const existing=await rowsFor(key,{queryFn});
 if(req.method==='GET'){
  const requested=selected?.season_number??(url.searchParams.has('season')?seasonNumber(url.searchParams.get('season')):undefined);
  const source=await providerParts(requested),manual=existing.filter(row=>requested===undefined||row.season_number===requested);
  const merged=mergePartRows(source.items,manual);
  if(selected){const found=merged.find(row=>identity(row)===identity(selected));if(!found)throw fail(404,'Season or episode was not found.');return {handled:true,data:{item:found}};}
  return {handled:true,data:{items:merged,providerUnavailable:source.unavailable}};
 }
 if(req.method!=='POST'&&req.method!=='PATCH')throw fail(405,'Request method is not supported.');
 if(req.method==='POST'&&selected||req.method==='PATCH'&&!selected)throw fail(405,'Use the correct season or episode endpoint.');
 const point=selected||coordinates(body?.season_number,body?.episode_number??0),isEpisode=point.episode_number>0;
 if(selected&&(['season_number','episode_number'].some(field=>body?.[field]!==undefined&&Number(body[field])!==selected[field])))throw fail(400,'Season and episode numbers cannot be changed through the update endpoint.');
 const patch=validatePartData(body,{creating:req.method==='POST'});
 const manual=existing.find(row=>identity(row)===identity(point));
 const source=await providerParts(isEpisode?point.season_number:undefined);
 const sourcePart=source.items.find(row=>identity(row)===identity(point));
 if(req.method==='POST'&&(manual||sourcePart))throw fail(409,'Season or episode already exists. Edit it instead.');
 if(req.method==='PATCH'&&!manual&&!sourcePart)throw fail(source.unavailable?503:404,source.unavailable?'Unable to verify provider data right now.':'Season or episode was not found.');
 if(req.method==='POST'&&isEpisode&&!existing.some(row=>row.season_number===point.season_number&&row.episode_number===0)&&!source.items.some(row=>row.season_number===point.season_number&&row.episode_number===0))throw fail(400,'Add the season before adding its episodes.');
 const result=await queryFn(req.method==='POST'?
  'INSERT INTO content_parts(content_key,season_number,episode_number,data) VALUES($1,$2,$3,$4::jsonb) RETURNING season_number,episode_number,data,updated_at':
  'INSERT INTO content_parts(content_key,season_number,episode_number,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(content_key,season_number,episode_number) DO UPDATE SET data=content_parts.data || excluded.data,updated_at=now() RETURNING season_number,episode_number,data,updated_at',
 [key,point.season_number,point.episode_number,JSON.stringify(patch)]);
 const changed=mergePartRows(sourcePart?[sourcePart]:[],[{...result.rows[0],manual:true}])[0];
 return {handled:true,data:{item:changed}};
}

export async function applySeriesParts(data,key,{queryFn=query,enabled=dbEnabled()}={}){
 if(!enabled||!key?.startsWith('tv:'))return data;
 const manual=await rowsFor(key,{queryFn});if(!manual.length)return data;
 const rows=mergePartRows((data.seasons||[]).filter(value=>value.season_number>0).map(value=>providerRow(value,value.season_number)),manual.filter(row=>row.episode_number===0));
 const seasons=rows.filter(published).map(row=>({...publicData(row.data),season_number:row.season_number}));
 return {...data,seasons,number_of_seasons:seasons.filter(row=>row.season_number>0).length};
}
export async function applySeasonParts(data,key,season,{queryFn=query,enabled=dbEnabled()}={}){
 if(!enabled||!key?.startsWith('tv:'))return data;
 const manual=await rowsFor(key,{season,queryFn}),parent=manual.find(row=>row.episode_number===0);
 if(parent&&!published(parent))throw fail(404,'الموسم غير متاح');
 const episodes=mergePartRows((data.episodes||[]).map(value=>providerRow(value,season,value.episode_number)),manual.filter(row=>row.episode_number>0)).filter(published).map(row=>({...publicData(row.data),season_number:season,episode_number:row.episode_number}));
 return {...data,...publicData(parent?.data),season_number:season,episodes};
}
export async function applyEpisodePart(data,key,season,episode,{queryFn=query,enabled=dbEnabled()}={}){
 if(!enabled||!key?.startsWith('tv:'))return data;
 const manual=await rowsFor(key,{season,queryFn}),parent=manual.find(row=>row.episode_number===0),part=manual.find(row=>row.episode_number===episode);
 if(parent&&!published(parent)||part&&!published(part))throw fail(404,'الحلقة غير متاحة');
 return {...data,...publicData(part?.data),season_number:season,episode_number:episode};
}
