import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/database-worker.mjs';
const request=headers=>new Request('https://database.example/',{method:'POST',headers,body:JSON.stringify({operation:'health'})});
test('D1 gateway fails closed without a configured secret, before reading the database',async()=>{
 const env={get DB(){throw new Error('Unauthorized database access');}};
 assert.equal((await worker.fetch(request({'Content-Type':'application/json'}),env)).status,401);
 assert.equal((await worker.fetch(request({Authorization:'Bearer arbitrary'}),env)).status,401);
});
test('D1 gateway rejects missing and incorrect tokens even for health requests',async()=>{
 const env={GATEWAY_TOKEN:'fixture-secret',get DB(){throw new Error('Unauthorized database access');}};
 assert.equal((await worker.fetch(request({}),env)).status,401);
 assert.equal((await worker.fetch(request({Authorization:'Bearer wrong-secret'}),env)).status,401);
 assert.equal((await worker.fetch(new Request('https://database.example/'),env)).status,405);
});
