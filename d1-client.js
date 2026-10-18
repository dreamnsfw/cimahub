import {d1Statement,d1Rows} from './d1-sql.js';
const catalogCache=new Map(),catalogPending=new Map();
export async function prefetchCatalog(namespace,keys){
 keys=[...new Set(keys)].filter(key=>{const old=catalogCache.get(namespace+':'+key);return !old||old.expires<=Date.now();});
 if(!keys.length)return;
 const rows=await d1Request('catalog.getmany',{namespace,keys});const values=new Map(rows.map(row=>[row.key,JSON.parse(row.value)]));
 for(const key of keys)catalogCache.set(namespace+':'+key,{value:values.get(key)??null,expires:Date.now()+60000});
}
export const d1Enabled=()=>Boolean(process.env.D1_GATEWAY_URL && process.env.D1_GATEWAY_TOKEN);
export async function d1Request(operation,data={}){
 const cacheKey=operation==='catalog.get'?data.namespace+':'+data.key:null;
 if(cacheKey){const old=catalogCache.get(cacheKey);if(old&&old.expires>Date.now())return structuredClone(old.value);if(catalogPending.has(cacheKey))return structuredClone(await catalogPending.get(cacheKey));}
 if(operation==='catalog.set')catalogCache.delete(data.namespace+':'+data.key);
 const work=performRequest(operation,data).then(value=>{
  if(cacheKey){while(catalogCache.size>=3000)catalogCache.delete(catalogCache.keys().next().value);catalogCache.set(cacheKey,{value,expires:Date.now()+60000});}
  if(operation==='catalog.set')catalogCache.set(data.namespace+':'+data.key,{value:data.value,expires:Date.now()+60000});
  return value;
 }).finally(()=>{if(cacheKey)catalogPending.delete(cacheKey);});
 if(cacheKey)catalogPending.set(cacheKey,work);
 return structuredClone(await work);
}
async function performRequest(operation,data){
 const endpoint=new URL(process.env.D1_GATEWAY_URL);
 if(endpoint.protocol!=='https:' && endpoint.hostname!=='127.0.0.1')throw new Error('D1 gateway requires HTTPS');
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.D1_GATEWAY_TOKEN},body:JSON.stringify({operation,...data}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Object.assign(new Error('D1 database request failed'),{code:'D1_GATEWAY_'+response.status});
 return response.json();
}
export async function d1Batch(statements){
 if(!statements.length)return [];
 const results=await d1Request('query',{statements:statements.map(({sql,params})=>d1Statement(sql,params))});
 return results.map(result=>({rows:d1Rows(result),rowCount:result.results?.length||result.meta?.changes||0}));
}
export async function d1Query(sql,params=[]){
 if(sql.startsWith('WITH updated AS (UPDATE admin_users SET password_hash=')){
  const results=await d1Batch([{sql:'UPDATE admin_users SET password_hash=$2 WHERE id=$1',params},{sql:'DELETE FROM admin_sessions WHERE user_id=$1',params:[params[0]]}]);return results[1];
 }
 // IDs are generated in the application rather than a PostgreSQL default.
 if(sql.startsWith('INSERT INTO admin_users(email,password_hash,role)')){
  sql=sql.replace('(email,password_hash,role) VALUES($1,$2,$3)','(id,email,password_hash,role) VALUES($4,$1,$2,$3)');params=[...params,crypto.randomUUID()];
 }
 return (await d1Batch([{sql,params}]))[0];
}
