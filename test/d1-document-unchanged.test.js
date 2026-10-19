import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/database-worker.mjs';

test('sync saving an identical document sends no database writes',async()=>{
 let writes=0;
 const DB={prepare(sql){return {bind(){return this;},async all(){return {results:sql.includes('SELECT revision')?[{revision:'existing'}]:[{body:'{"items":[1]}'}]};},async run(){writes++;}};},async batch(){writes++;}};
 const request=body=>new Request('https://fixture.example',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({operation:'document.write',path:'data/fixture.json',body})});
 const response=await worker.fetch(request('{"items":[1]}'),{DB,GATEWAY_TOKEN:'fixture'});
 assert.equal(response.status,200);assert.equal((await response.json()).unchanged,true);assert.equal(writes,0);
 await worker.fetch(request('{"items":[2]}'),{DB,GATEWAY_TOKEN:'fixture'});
 assert.equal(writes,1);
});
