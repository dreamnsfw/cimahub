const now=()=>new Date().toISOString();
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const statement=(db,sql,params=[])=>db.prepare(sql).bind(...params);
const rows=async(db,sql,params=[])=> (await statement(db,sql,params).all()).results;
export default {
 async fetch(request,env){
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  const expected=env.GATEWAY_TOKEN;
  if(!expected||request.headers.get('Authorization')!=='Bearer '+expected)return reply({error:'Unauthorized'},401);
  try{
   const input=await request.json(),db=env.DB;
   if(input.operation==='health'){await db.prepare('SELECT 1 FROM site_settings LIMIT 1').all();return reply({ready:true});}
   if(input.operation==='query'){
    if(!Array.isArray(input.statements)||!input.statements.length||input.statements.length>40)return reply({error:'Invalid batch'},400);
    return reply(await db.batch(input.statements.map(s=>statement(db,s.sql,s.params))));
   }
   if(input.operation==='catalog.get')return reply((await rows(db,'SELECT value FROM seo_records WHERE namespace=? AND key=?',[input.namespace,input.key])).map(r=>JSON.parse(r.value))[0]??null);
   if(input.operation==='catalog.getmany')return reply(await rows(db,'SELECT key,value FROM seo_records WHERE namespace=? AND key IN (SELECT value FROM json_each(?))',[input.namespace,JSON.stringify(input.keys)]));
   if(input.operation==='catalog.list')return reply(await rows(db,'SELECT key,value FROM seo_records WHERE namespace=? ORDER BY key',[input.namespace]));
   if(input.operation==='catalog.set'){
    if(!['works','images','pages','collections'].includes(input.namespace))return reply({error:'Invalid namespace'},400);
    await statement(db,'INSERT INTO seo_records(namespace,key,value) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value',[input.namespace,input.key,JSON.stringify(input.value)]).run();return reply({ok:true});
   }
   if(input.operation==='document.read'){
    const result=await rows(db,'SELECT c.body FROM data_documents d JOIN data_document_chunks c ON c.path=d.path WHERE d.path=? ORDER BY c.ordinal',[input.path]);
    return reply(result.length?result.map(r=>r.body).join(''):null);
   }
   if(input.operation==='document.stat')return reply((await rows(db,'SELECT bytes,updated_at FROM data_documents WHERE path=?',[input.path]))[0]??null);
   if(input.operation==='document.list')return reply(await rows(db,'SELECT path FROM data_documents WHERE substr(path,1,length(?))=? ORDER BY path',[input.prefix,input.prefix]));
   if(input.operation==='document.write'){
    const previous=(await rows(db,'SELECT revision FROM data_documents WHERE path=?',[input.path]))[0];
    if(input.exclusive&&previous)return reply({error:'EEXIST'},409);
    const old=previous?await rows(db,'SELECT body FROM data_document_chunks WHERE path=? ORDER BY ordinal',[input.path]):[];
    let body=input.append?old.map(r=>r.body).join('')+input.body:input.body;
    if(previous&&old.map(r=>r.body).join('')===body)return reply({ok:true,unchanged:true});
    const parts=chunks(body);if(parts.length>35)return reply({error:'Document requires normalization'},413);
    // One atomic batch replaces both the metadata and every chunk.
    await db.batch([
     statement(db,`INSERT INTO data_documents(path,bytes,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET bytes=excluded.bytes,revision=excluded.revision,updated_at=excluded.updated_at`,[input.path,new TextEncoder().encode(body).length,crypto.randomUUID(),now()]),
     ...(old.length>parts.length?[statement(db,'DELETE FROM data_document_chunks WHERE path=? AND ordinal>=?',[input.path,parts.length])]:[]),
     ...parts.flatMap((part,i)=>old[i]?.body===part?[]:[statement(db,'INSERT INTO data_document_chunks(path,ordinal,body) VALUES(?,?,?) ON CONFLICT(path,ordinal) DO UPDATE SET body=excluded.body',[input.path,i,part])])
    ]);return reply({ok:true});
   }
   if(input.operation==='document.rename'){
    if(input.from===input.to)return reply({ok:true});
    if(!(await rows(db,'SELECT 1 FROM data_documents WHERE path=?',[input.from])).length)return reply({error:'ENOENT'},404);
    const source=await rows(db,'SELECT body FROM data_document_chunks WHERE path=? ORDER BY ordinal',[input.from]);
    const target=await rows(db,'SELECT body FROM data_document_chunks WHERE path=? ORDER BY ordinal',[input.to]);
    if(target.length&&source.map(r=>r.body).join('')===target.map(r=>r.body).join('')){await statement(db,'DELETE FROM data_documents WHERE path=?',[input.from]).run();return reply({ok:true,unchanged:true});}
    await db.batch([
     statement(db,'DELETE FROM data_documents WHERE path=?',[input.to]),
     statement(db,'INSERT INTO data_documents(path,bytes,revision,updated_at) SELECT ?,bytes,revision,updated_at FROM data_documents WHERE path=?',[input.to,input.from]),
     statement(db,'INSERT INTO data_document_chunks(path,ordinal,body) SELECT ?,ordinal,body FROM data_document_chunks WHERE path=?',[input.to,input.from]),
     statement(db,'DELETE FROM data_documents WHERE path=?',[input.from])]);return reply({ok:true});
   }
   if(input.operation==='user.update'){
    const results=await db.batch([
     statement(db,`UPDATE admin_users SET role=?,active=? WHERE id=? AND (?<>id OR (?=1 AND ?='administrator')) AND (role<>'administrator' OR active=0 OR (?=1 AND ?='administrator') OR EXISTS(SELECT 1 FROM admin_users other WHERE other.id<>admin_users.id AND other.active=1 AND other.role='administrator')) RETURNING id,email,role,active,created_at`,[input.role,Number(input.active),input.id,input.actor,Number(input.active),input.role,Number(input.active),input.role]),
     statement(db,'DELETE FROM admin_sessions WHERE user_id=? AND changes()>0',[input.id])]);
    if(!results[0].results.length)return reply({error:'Account change conflicts with administrator protections'},409);
    return reply(results[0].results[0]);
   }
   return reply({error:'Unknown operation'},400);
  }catch(error){console.error('D1 operation failed',String(error.message).slice(0,120).replace(/https?:\/\/\S+/g,'[URL]'));return reply({error:'Database operation failed'},500);}
 }
};
import {documentChunks as chunks} from './document-chunks.mjs';
