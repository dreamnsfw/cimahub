import {DatabaseSync} from 'node:sqlite';
import {readFile,rename,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('../db/public.sqlite',import.meta.url));
const tables=['content_items','site_settings','content_sources','source_scopes','taxonomy','content_parts','seo_records','data_documents','data_document_chunks','movie_index'];
await mkdir(new URL('../db/',import.meta.url),{recursive:true});
const temporary=output+'.tmp',db=new DatabaseSync(temporary);
let source;
if(process.env.PUBLIC_DATABASE_EXPORT_SQL){source=new DatabaseSync(':memory:');source.exec(await readFile(process.env.PUBLIC_DATABASE_EXPORT_SQL,'utf8'));}
db.exec(await readFile(new URL('../db/d1-schema.sql',import.meta.url),'utf8'));
db.exec('PRAGMA foreign_keys=OFF;BEGIN');
try{
 for(const table of tables){
  db.exec(`DELETE FROM ${table}`);
  let cursor=0,total=0;
  while(true){
   const sql=`SELECT rowid AS _export_rowid,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`,params=[cursor,table==='data_document_chunks'?25:500];
   let rows;
   if(source)rows=source.prepare(sql).all(...params);
   else{
    const direct=Boolean(process.env.D1_BUILD_READ_TOKEN);
    const config=direct?JSON.parse(await readFile(new URL('../cloudflare/wrangler.jsonc',import.meta.url),'utf8')):null;
    const endpoint=direct?`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${config.d1_databases[0].database_id}/query`:process.env.D1_GATEWAY_URL;
    const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+(direct?process.env.D1_BUILD_READ_TOKEN:process.env.D1_GATEWAY_TOKEN),'Content-Type':'application/json'},body:JSON.stringify(direct?{sql,params}:{operation:'query',statements:[{sql,params}]}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Cannot prepare public data: ${table} returned ${response.status}`);
    const batch=await response.json();rows=(direct?batch.result:batch)[0]?.results;
   }
   if(!Array.isArray(rows))throw new Error('Invalid public export response');
   if(!rows.length)break;
   for(const row of rows){cursor=row._export_rowid;const {_export_rowid,...value}=row,columns=Object.keys(value);db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(value));}
   total+=rows.length;
  }
  console.log(`Prepared ${table}: ${total}`);
 }
 if(!db.prepare('SELECT count(*) AS n FROM content_items').get().n)throw new Error('Refusing to publish an empty content database');
 // Authentication, sessions, job logs and runtime secrets are never copied.
 db.exec('COMMIT;VACUUM');db.close();source?.close();await rename(temporary,output);
 console.log(`Public database ready: ${(await stat(output)).size} bytes`);
}catch(error){try{db.exec('ROLLBACK');db.close();}catch{}throw error;}
await (await import('./prepare-provider-data.mjs')).prepareProviderData();
