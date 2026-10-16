import {readFile} from 'node:fs/promises';
import {readFile as readData} from './storage.js';
import {query,transaction,dbEnabled} from './database.js';
import {createAdminAuth,readAdminJson,hashPassword,normalizeAdminEmail} from './admin-auth.js';
import {handleParts} from './admin-parts.js';
import {safeLink,movieLinks} from './qfilm-import.js';
import {siteNavigationGroups} from './site-navigation.js';
import {currentSettings,invalidateManagedCaches} from './managed-content.js';
import {runRecordedJob} from './admin-jobs.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(v,max=500)=>{if(typeof v!=='string'||v.length>max)throw fail(400,'Invalid text value.');return v.trim();};
const keyOf=v=>{if(!/^(movie|tv):[1-9]\d{0,14}$/.test(v))throw fail(400,'Invalid content ID.');return v;};
const fields=new Set(['title','name','overview','release_date','first_air_date','original_language','poster_path','backdrop_path','seo_title','seo_description','noindex','adult_category','genre_ids','genres']);
const paginate=url=>{const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)throw fail(400,'Invalid page number.');return page;};
// Use the same Animation genre as the site's existing anime sections. Manual
// genre edits take precedence over provider data, including an empty selection.
const animeSql=`coalesce(CASE
 WHEN overrides ? 'genre_ids' THEN overrides->'genre_ids' @> '[16]'::jsonb
 WHEN overrides ? 'genres' THEN overrides->'genres' @> '[{"id":16}]'::jsonb
 WHEN snapshot ? 'genre_ids' THEN snapshot->'genre_ids' @> '[16]'::jsonb
 ELSE snapshot->'genres' @> '[{"id":16}]'::jsonb END,false)`;
const librarySql=`(SELECT *,${animeSql} AS is_anime FROM content_items) library`;
function contentWithType(item){
 const o=item.overrides||{},s=item.snapshot||{};
 const ids=Array.isArray(o.genre_ids)?o.genre_ids:Array.isArray(o.genres)?o.genres.map(g=>g.id):Array.isArray(s.genre_ids)?s.genre_ids:(s.genres||[]).map(g=>g.id);
 return {...item,is_anime:ids.includes(16)};
}
function patchContent(body,item){
 const patch={};
 for(const [field,value] of Object.entries(body)){
  if(!fields.has(field))continue;
  if(['noindex','adult_category'].includes(field)){if(typeof value!=='boolean')throw fail(400,'Choose a valid value.');patch[field]=value;}
  else if(field==='genre_ids'){if(!Array.isArray(value)||value.length>30||value.some(x=>!Number.isInteger(x)||x<1))throw fail(400,'Invalid genres.');patch[field]=value;}
  else if(field==='genres'){if(!Array.isArray(value)||value.length>30||value.some(x=>!Number.isInteger(x.id)||typeof x.name!=='string'||x.name.length>100))throw fail(400,'Invalid genres.');patch[field]=value;}
  else {patch[field]=text(value,field==='overview'?30000:field==='seo_description'?1000:500);if(/^(first_air_date|release_date)$/.test(field)&&patch[field]&&(!/^\d{4}-\d{2}-\d{2}$/.test(patch[field])||!Number.isFinite(Date.parse(patch[field]))||new Date(patch[field]).toISOString().slice(0,10)!==patch[field]))throw fail(400,'Invalid date.');if(/^(poster_path|backdrop_path)$/.test(field)&&patch[field]&&!/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(patch[field]))throw fail(400,'Use a valid TMDB image path.');}
 }
 if(body.name!==undefined){const name=text(body.name,300);if(!name)throw fail(400,'A title is required.');patch[item.kind==='movie'?'title':'name']=name;patch.original_title=item.kind==='movie'?name:undefined;patch.original_name=item.kind==='tv'?name:undefined;delete patch[item.kind==='movie'?'name':'title'];}
 return Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined));
}
export async function seedAdminTaxonomy(){
 if(!dbEnabled())return;
 const items=new Map(siteNavigationGroups().flatMap(g=>[...(g.featured||[]),...g.sections.flatMap(s=>s.links)]).map(x=>[x.path,x]));let order=0;
 for(const item of items.values())await query('INSERT INTO taxonomy(key,kind,label,path,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[item.path,item.path.startsWith('/anime/')?'anime':item.path.startsWith('/series')?'tv':'movie',item.label,item.path,order++]);
}
export function createAdminApi({origin,loadWork,loadTMDB,onChange=()=>{},jobs={},awaitJobs=false}){
 const auth=createAdminAuth({siteUrl:origin});const running=new Set();
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});res.end(JSON.stringify(data));};
  const changed=async()=>{invalidateManagedCaches();await onChange();};
 async function refreshSourceRows(item,season=0,episode=0){
  if((await query('SELECT 1 FROM source_scopes WHERE content_key=$1 AND season_number=$2 AND episode_number=$3 AND managed',[item.key,season,episode])).rowCount)return;
  let records=[];
  if(item.kind==='movie')records=await movieLinks(Number(item.provider_id));
  else if(season&&episode){try{const saved=JSON.parse(await readData(new URL(`./data/series-links/${item.provider_id}.json`,import.meta.url),'utf8'));records=[saved.episodes?.[`${season}-${episode}`]].filter(Boolean);}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const r of records)for(const kind of ['playback','download'])for(const link of r[kind==='download'?'downloads':'playback']||[]){const url=safeLink(link.url);if(url)await query('INSERT INTO content_sources(content_key,season_number,episode_number,kind,label,url,quality) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS(SELECT 1 FROM content_sources WHERE content_key=$1 AND coalesce(season_number,0)=$2 AND coalesce(episode_number,0)=$3 AND kind=$4 AND url=$6)',[item.key,season,episode,kind,link.label||'',url,r.quality||'']);}
 }
 async function itemByKey(key){const row=(await query('SELECT * FROM content_items WHERE key=$1',[keyOf(key)])).rows[0];if(!row)throw fail(404,'Content not found.');return row;}
 async function sourceBody(body,previous={}){
  const value={...previous,...body},item=await itemByKey(value.content_key);const season=Number(value.season_number||0),episode=Number(value.episode_number||0);
  if(!Number.isInteger(season)||!Number.isInteger(episode)||season<0||episode<0||(season===0)!==(episode===0)||item.kind==='movie'&&(season||episode))throw fail(400,'Select both a season and an episode for series; use zero for movies.');
  if(item.kind==='tv'&&(!season||!episode))throw fail(400,'A series source must belong to a specific season and episode.');
  if(!['playback','download'].includes(value.kind)||!safeLink(value.url))throw fail(400,'Invalid source URL.');
  if(value.active!==undefined&&typeof value.active!=='boolean')throw fail(400,'Invalid source status.');
  if(value.active===undefined)value.active=true;
  const order=Number(value.sort_order||0);if(!Number.isInteger(order)||Math.abs(order)>100000)throw fail(400,'Invalid source order.');
  return {...value,season_number:season,episode_number:episode,label:text(value.label||'',200),quality:text(value.quality||'',100),url:safeLink(value.url),sort_order:order};
 }
 return {auth,async handle(req,res,url){
  if(url.pathname==='/admin'||url.pathname==='/admin/'||url.pathname.startsWith('/admin-assets/')){
   if(!['GET','HEAD'].includes(req.method)){send(res,405,{error:'Method not supported.'});return true;}
   const name=url.pathname.startsWith('/admin-assets/')?url.pathname.slice('/admin-assets/'.length):'index.html';
   if(!['index.html','admin.css','admin.js'].includes(name)){send(res,404,{error:'File not found.'});return true;}
   const body=await readFile(new URL('./public/admin/'+name,import.meta.url));res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://image.tmdb.org data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"});res.end(req.method==='HEAD'?undefined:body);return true;
  }
  if(!url.pathname.startsWith('/api/admin/'))return false;
  try{
   if(!dbEnabled())throw fail(503,'The administration database is unavailable.');
   if(await auth.handle(req,res,url))return true;
   const session=await auth.requireUser(req),user=session.user;
   if(!['GET','HEAD'].includes(req.method))await auth.requireMutation(req,session);
   const path=decodeURIComponent(url.pathname.slice('/api/admin'.length));let body;
   if(['POST','PATCH','PUT'].includes(req.method))body=await readAdminJson(req);
   const admin=()=>{if(user.role!=='administrator')throw fail(403,'Administrator access is required.');};
   const parts=await handleParts({req,url,body,loadTMDB});
   if(parts.handled){if(req.method!=='GET')await changed();send(res,200,parts.data);return true;}
   let result;
   if(path==='/dashboard'&&req.method==='GET'){
    const counts=(await query(`SELECT count(*) FILTER(WHERE kind='movie' AND NOT is_anime)::int movies,count(*) FILTER(WHERE kind='tv' AND NOT is_anime)::int series,count(*) FILTER(WHERE is_anime)::int anime,count(*) FILTER(WHERE kind='movie' AND is_anime)::int anime_movies,count(*) FILTER(WHERE kind='tv' AND is_anime)::int anime_series,count(*) FILTER(WHERE status<>'published')::int hidden FROM ${librarySql}`)).rows[0];
    counts.sources=Number((await query('SELECT count(*) FROM content_sources WHERE active')).rows[0].count);counts.users=Number((await query('SELECT count(*) FROM admin_users WHERE active')).rows[0].count);
    result={counts,database:'PostgreSQL'};
   }else if(path==='/content'&&req.method==='GET'){
    const page=paginate(url),q=text(url.searchParams.get('q')||'',300),kind=url.searchParams.get('type')||'',status=url.searchParams.get('status')||'';
    if(!['','movie','tv','anime','anime-movie','anime-tv'].includes(kind))throw fail(400,'Invalid content type.');
    if(!['','published','draft','hidden'].includes(status))throw fail(400,'Invalid content status.');
    const params=[`%${q}%`,kind,status],where="WHERE (name ILIKE $1 OR slug ILIKE $1 OR key ILIKE $1) AND ($2='' OR ($2='movie' AND kind='movie' AND NOT is_anime) OR ($2='tv' AND kind='tv' AND NOT is_anime) OR ($2='anime' AND is_anime) OR ($2='anime-movie' AND kind='movie' AND is_anime) OR ($2='anime-tv' AND kind='tv' AND is_anime)) AND ($3='' OR status=$3)";
    const total=Number((await query(`SELECT count(*) FROM ${librarySql} `+where,params)).rows[0].count);result={items:(await query(`SELECT * FROM ${librarySql} `+where+' ORDER BY updated_at DESC,key LIMIT 24 OFFSET $4',[...params,(page-1)*24])).rows,total,page,pages:Math.max(1,Math.ceil(total/24))};
   }else if(path==='/content'&&req.method==='POST'){
    if(!['movie','tv'].includes(body.type)||!Number.isSafeInteger(Number(body.tmdbId))||Number(body.tmdbId)<1)throw fail(400,'Enter a valid content type and TMDB ID.');
    const item=await loadWork(body.type,Number(body.tmdbId));await changed();result={item};
   }else if(/^\/content\/(movie|tv):\d+(?:\/reset)?$/.test(path)){
    const key=keyOf(path.split('/')[2]);let item=await itemByKey(key);
    if(req.method==='GET'&&(!item.snapshot?.id||!item.snapshot?.overview)){try{item=await loadWork(item.kind,Number(item.provider_id));}catch{/* Existing imported data remains editable when the provider is offline. */}}
    if(req.method==='GET')result={item,sources:(await query('SELECT * FROM content_sources WHERE content_key=$1 ORDER BY season_number,episode_number,sort_order,id',[key])).rows};
    else if(req.method==='PATCH'){
     const patch=patchContent(body,item);let slug=item.slug,status=item.status;
     if(body.slug!==undefined){slug=text(body.slug,160);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||['admin','api','movies','movie','series','anime','categories','top','recent','episodes','seasons','search','uploads','terms','dmca'].includes(slug))throw fail(400,'The URL slug is invalid or reserved.');}
     if(body.status!==undefined){if(!['published','draft','hidden'].includes(body.status))throw fail(400,'Invalid content status.');status=body.status;}
     const name=body.name===undefined?item.name:body.name.trim();
     result={item:(await query('UPDATE content_items SET overrides=overrides || $2::jsonb,name=$3,slug=$4,status=$5,updated_at=now() WHERE key=$1 RETURNING *',[key,JSON.stringify(patch),name,slug,status])).rows[0]};await changed();
    }else if(req.method==='DELETE'){await query("UPDATE content_items SET status='hidden',updated_at=now() WHERE key=$1",[key]);await changed();result={ok:true};}
    else if(req.method==='POST'&&path.endsWith('/reset')){
     if(!Array.isArray(body.fields)||body.fields.some(f=>!fields.has(f)&&!['original_name','original_title'].includes(f)))throw fail(400,'Select valid fields to restore.');
     const reset=new Set(body.fields);if(reset.has('name')||reset.has('title'))for(const f of ['name','title','original_name','original_title'])reset.add(f);
     result={item:(await query("UPDATE content_items SET overrides=overrides-$2::text[],name=CASE WHEN $3 THEN coalesce(snapshot->>'name',snapshot->>'title',name) ELSE name END,updated_at=now() WHERE key=$1 RETURNING *",[key,[...reset],reset.has('name')||reset.has('title')])).rows[0]};await changed();
    }else throw fail(405,'Method not supported.');
   }else if(path==='/sources'&&req.method==='GET'){
    const key=keyOf(url.searchParams.get('key')||''),season=Number(url.searchParams.get('season')||0),episode=Number(url.searchParams.get('episode')||0);const item=await itemByKey(key);
    if(!Number.isInteger(season)||!Number.isInteger(episode)||season<0||episode<0)throw fail(400,'Invalid season or episode number.');
    await refreshSourceRows(item,season,episode);result={items:(await query('SELECT * FROM content_sources WHERE content_key=$1 AND ($2=0 OR coalesce(season_number,0)=$2) AND ($3=0 OR coalesce(episode_number,0)=$3) ORDER BY season_number,episode_number,sort_order,id',[key,season,episode])).rows};
   }else if(path==='/sources'&&req.method==='POST'){
    const s=await sourceBody(body);await refreshSourceRows(await itemByKey(s.content_key),s.season_number,s.episode_number);result=await transaction(async c=>{await c.query('INSERT INTO source_scopes(content_key,season_number,episode_number) VALUES($1,$2,$3) ON CONFLICT(content_key,season_number,episode_number) DO UPDATE SET managed=true',[s.content_key,s.season_number,s.episode_number]);return {item:(await c.query('INSERT INTO content_sources(content_key,season_number,episode_number,kind,label,url,quality,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[s.content_key,s.season_number,s.episode_number,s.kind,s.label,s.url,s.quality,s.active,s.sort_order])).rows[0]};});await changed();
   }else if(/^\/sources\/\d+$/.test(path)){
    const id=path.split('/')[2],previous=(await query('SELECT * FROM content_sources WHERE id=$1',[id])).rows[0];if(!previous)throw fail(404,'Source not found.');
    if(req.method==='PATCH'){const s=await sourceBody(body,previous);if(s.content_key!==previous.content_key||s.season_number!==previous.season_number||s.episode_number!==previous.episode_number)throw fail(400,'Add a new source to use a different title or episode.');await transaction(async c=>{await c.query('INSERT INTO source_scopes(content_key,season_number,episode_number) VALUES($1,$2,$3) ON CONFLICT(content_key,season_number,episode_number) DO UPDATE SET managed=true',[previous.content_key,previous.season_number||0,previous.episode_number||0]);await c.query('UPDATE content_sources SET kind=$2,label=$3,url=$4,quality=$5,active=$6,sort_order=$7,updated_at=now() WHERE id=$1',[id,s.kind,s.label,s.url,s.quality,s.active,s.sort_order]);});}
    else if(req.method==='DELETE'){await transaction(async c=>{await c.query('INSERT INTO source_scopes(content_key,season_number,episode_number) VALUES($1,$2,$3) ON CONFLICT(content_key,season_number,episode_number) DO UPDATE SET managed=true',[previous.content_key,previous.season_number||0,previous.episode_number||0]);await c.query('DELETE FROM content_sources WHERE id=$1',[id]);});}else throw fail(405,'Method not supported.');await changed();result={ok:true};
   }else if(path==='/taxonomy'&&req.method==='GET')result={items:(await query('SELECT * FROM taxonomy ORDER BY sort_order,key')).rows};
   else if(path.startsWith('/taxonomy/')&&req.method==='PATCH'){
    admin();const key=path.slice('/taxonomy/'.length),label=text(body.label,200),order=Number(body.sort_order||0);if(!label||typeof body.enabled!=='boolean'||!Number.isInteger(order))throw fail(400,'Invalid category details.');
    const row=await query('UPDATE taxonomy SET label=$2,enabled=$3,sort_order=$4,updated_at=now() WHERE key=$1 RETURNING *',[key,label,body.enabled,order]);if(!row.rowCount)throw fail(404,'Category not found.');await changed();result={item:row.rows[0]};
   }else if(path==='/settings'&&req.method==='GET')result={settings:await currentSettings()};
   else if(path==='/settings'&&req.method==='PUT'){
    admin();const values=body.settings||body,validated={};const allowed=new Set(['site_name','site_description','contact_email','maintenance','maintenance_message','header_notice','home_recent_limit','sync_enabled','sync_interval_hours']);
    for(const [key,v] of Object.entries(values)){if(!allowed.has(key))continue;if(['maintenance','sync_enabled'].includes(key)){if(typeof v!=='boolean')throw fail(400,'Invalid setting value.');validated[key]=v;}else if(['home_recent_limit','sync_interval_hours'].includes(key)){const n=Number(v);if(!Number.isInteger(n)||n<1||n>(key==='home_recent_limit'?48:168))throw fail(400,'The setting is outside the allowed range.');validated[key]=n;}else validated[key]=text(v,key==='site_description'?2000:500);}
    if(validated.contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(validated.contact_email))throw fail(400,'Invalid contact email.');
    if('site_name'in validated&&!validated.site_name)throw fail(400,'A site name is required.');await transaction(async c=>{for(const [k,v] of Object.entries(validated))await c.query('INSERT INTO site_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()',[k,JSON.stringify(v)]);});await changed();result={settings:await currentSettings()};
   }else if(path==='/jobs'&&req.method==='GET'){
    const settings=await currentSettings();result={jobs:Object.entries(jobs).map(([name,job])=>({name,label:({sources:'Update movie sources',discovery:'Discover new movies',adult:'Update 18+ category'}[name]||job.label),running:running.has(name),enabled:settings.sync_enabled!==false})),runs:(await query('SELECT * FROM job_runs ORDER BY id DESC LIMIT 50')).rows};
   }else if(/^\/jobs\/[a-z-]+\/run$/.test(path)&&req.method==='POST'){
    admin();const name=path.split('/')[2],job=jobs[name];if(!job)throw fail(404,'Sync job not found.');if(running.has(name))throw fail(409,'This sync job is already running.');running.add(name);
    const task=runRecordedJob({name,run:()=>job.run(),bounded:awaitJobs}).finally(()=>running.delete(name));
    if(awaitJobs)result=await task;else{void task.catch(()=>{});result={ok:true};}
   }else if(path==='/users'&&req.method==='GET'){admin();result={items:(await query('SELECT id,email,role,active,created_at FROM admin_users ORDER BY created_at')).rows};
   }else if(path==='/users'&&req.method==='POST'){
    admin();const email=normalizeAdminEmail(body.email);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!['administrator','editor'].includes(body.role))throw fail(400,'Invalid account details.');const hash=await hashPassword(body.password);result={item:(await query('INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role,active,created_at',[email,hash,body.role])).rows[0]};
   }else if(/^\/users\/[0-9a-f-]{36}$/i.test(path)&&req.method==='PATCH'){
    admin();const id=path.split('/')[2];if(body.active!==undefined&&typeof body.active!=='boolean'||body.role!==undefined&&!['administrator','editor'].includes(body.role))throw fail(400,'Invalid account details.');
    result=await transaction(async c=>{const admins=(await c.query("SELECT id FROM admin_users WHERE role='administrator' AND active FOR UPDATE")).rows;const previous=(await c.query('SELECT id,email,role,active FROM admin_users WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!previous)throw fail(404,'Account not found.');const active=body.active??previous.active,role=body.role??previous.role;if(id===user.id&&(!active||role!=='administrator'))throw fail(400,'You cannot deactivate your own account or remove its administrator access.');if(previous.role==='administrator'&&previous.active&&(!active||role!=='administrator')&&admins.length<=1)throw fail(400,'At least one active administrator is required.');const item=(await c.query('UPDATE admin_users SET role=$2,active=$3 WHERE id=$1 RETURNING id,email,role,active,created_at',[id,role,active])).rows[0];await c.query('DELETE FROM admin_sessions WHERE user_id=$1',[id]);return {item};});
   }else throw fail(404,'Admin page not found.');
   if(result?.item?.snapshot&&['movie','tv'].includes(result.item.kind))result.item=contentWithType(result.item);
   send(res,200,result);return true;
  }catch(error){const status=error.code==='23505'?409:error.status||500;send(res,status,{error:error.code?.startsWith('SYNC_JOB_')?error.message:status===409?'This value already exists.':status>=500?'Unable to complete the operation. Check the database connection.':error.message,...(error.runId?{runId:error.runId,status:'error'}:{})});return true;}
 }};
}
