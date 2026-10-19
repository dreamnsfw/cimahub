import test from 'node:test';
import assert from 'node:assert/strict';
import {withD1ReadOnly,d1Request} from '../d1-client.js';

test('public request suppresses persistent caches and rejects SQL mutations without gateway calls',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json([]);};
 const beforeUrl=process.env.D1_GATEWAY_URL;process.env.D1_GATEWAY_URL='https://fixture.example';
 try{
  await withD1ReadOnly(async()=>{
   for(const operation of ['catalog.set','document.write','document.rename'])assert.equal((await d1Request(operation)).skipped,true);
   await assert.rejects(d1Request('query',{statements:[{sql:'UPDATE content_items SET name=?',params:[]}]}),{code:'D1_READ_ONLY'});
   assert.equal(calls,0);
   await d1Request('query',{statements:[{sql:'SELECT * FROM content_items',params:[]}]});
   assert.equal(calls,1);
  });
  await d1Request('catalog.set',{namespace:'works',key:'fixture',value:{}});
  assert.equal(calls,2);
 }finally{globalThis.fetch=original;if(beforeUrl===undefined)delete process.env.D1_GATEWAY_URL;else process.env.D1_GATEWAY_URL=beforeUrl;}
});
