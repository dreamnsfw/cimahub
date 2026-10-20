import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

let database,openedPath;
export const publicDatabasePath=()=>process.env.PUBLIC_DATABASE_PATH||fileURLToPath(new URL('./db/public.sqlite',import.meta.url));
export function publicDatabaseAvailable(){return existsSync(publicDatabasePath());}
export function preparedProviderResponse(key){
 if(!publicDatabaseAvailable())return;
 const result=publicDatabaseRequest('query',{statements:[{sql:"SELECT name FROM sqlite_master WHERE type='table' AND name='prepared_provider_responses'"}]});
 if(!result[0].results.length)return;
 const row=publicDatabaseRequest('query',{statements:[{sql:'SELECT body FROM prepared_provider_responses WHERE key=?',params:[key]}]})[0].results[0];
 return row?JSON.parse(row.body):undefined;
}
export function publicDatabaseRequest(operation,input={}){
 const path=publicDatabasePath();
 if(!database||openedPath!==path){database?.close();database=new DatabaseSync(path,{readOnly:true});openedPath=path;}
 const rows=(sql,params=[])=>database.prepare(sql).all(...params);
 if(operation==='health')return {ready:true};
 if(operation==='query')return input.statements.map(({sql,params=[]})=>{
  if(!/^\s*SELECT\b/i.test(sql))throw new Error('Public database is read-only');
  return {results:rows(sql,params),meta:{changes:0}};
 });
 if(operation==='catalog.get')return JSON.parse(rows('SELECT value FROM seo_records WHERE namespace=? AND key=?',[input.namespace,input.key])[0]?.value||'null');
 if(operation==='catalog.getmany')return rows('SELECT key,value FROM seo_records WHERE namespace=? AND key IN (SELECT value FROM json_each(?))',[input.namespace,JSON.stringify(input.keys)]);
 if(operation==='catalog.list')return rows('SELECT key,value FROM seo_records WHERE namespace=? ORDER BY key',[input.namespace]);
 if(operation==='document.read'){
  const chunks=rows('SELECT body FROM data_document_chunks WHERE path=? ORDER BY ordinal',[input.path]);
  return chunks.length?chunks.map(row=>row.body).join(''):null;
 }
 if(operation==='document.stat')return rows('SELECT bytes,updated_at FROM data_documents WHERE path=?',[input.path])[0]||null;
 if(operation==='document.list')return rows('SELECT path FROM data_documents WHERE substr(path,1,length(?))=? ORDER BY path',[input.prefix,input.prefix]);
 throw new Error('Unsupported public database operation: '+operation);
}
