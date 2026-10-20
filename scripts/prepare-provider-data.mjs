import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {categoryPaths} from '../category-seo.js';
import {movieSections,movieGenres,movieTopicSections,adultMovieCategory,comingSoonMovieCategory} from '../movie-seo.js';
export async function prepareProviderData(){
 const file=fileURLToPath(new URL('../db/public.sqlite',import.meta.url));
 const db=new DatabaseSync(file);
 db.exec('CREATE TABLE IF NOT EXISTS prepared_provider_responses (key TEXT PRIMARY KEY,body TEXT NOT NULL)');
 const save=db.prepare('INSERT OR REPLACE INTO prepared_provider_responses(key,body) VALUES(?,?)');
 const original=globalThis.fetch;
 let providerRequests=0;
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));
  if(url.hostname==='api.themoviedb.org'){
   providerRequests++;
   const response=await original(input,options);
   if(response.ok){const data=await response.clone().json();url.searchParams.delete('api_key');save.run(url.pathname.replace(/^\/3\//,'')+'?'+url.searchParams,JSON.stringify(data));}
   return response;
  }
  if(process.env.D1_GATEWAY_URL&&url.origin===new URL(process.env.D1_GATEWAY_URL).origin)throw Error('Public preparation attempted a live database request');
  return original(input,options);
 };
 process.env.VERCEL='1';
 process.env.SITE_URL='https://cimahub.net';
 const {server}=await import('../server.js');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const paths=new Set(['/', '/categories/','/top/','/recent/','/episodes/','/seasons/','/movies/',...categoryPaths,...Object.keys(movieSections).map(k=>'/movies/'+k+'/'),...Object.keys(movieGenres).map(k=>'/movies/genre/'+k+'/'),...Object.values(movieTopicSections).map(s=>s.path),adultMovieCategory.path,comingSoonMovieCategory.path,...Array.from({length:4},(_,i)=>'/movies/year/'+(new Date().getFullYear()-i)+'/')]);
 for(const row of db.prepare("SELECT key,value FROM seo_records WHERE namespace='pages'").all()){
  const page=JSON.parse(row.value);if(page.path?.includes('/season/'))paths.add(page.path);
 }
 let done=0;
 try{
  // Sequential preparation keeps external requests bounded and makes failures fail the build.
  for(const path of paths){
   const response=await original(base+path,{signal:AbortSignal.timeout(60000)});await response.arrayBuffer();
   if(response.status>=500)throw Error('Cannot prepare public route '+path+': '+response.status);
   done++;if(done%25===0)console.log('Prepared public routes: '+done+'/'+paths.size);
  }
  console.log('Prepared public routes: '+done+'; provider requests: '+providerRequests);
 }finally{globalThis.fetch=original;await new Promise(resolve=>server.close(resolve));db.close();}
}
