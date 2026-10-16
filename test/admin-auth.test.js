import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {hashPassword,verifyPassword,hashSessionToken,validateAdminPassword,normalizeAdminEmail,adminSessionCookie,requireAdminOrigin,readAdminJson,createAdminAuth,bootstrapAdministrator} from '../admin-auth.js';

const password='Example-secure-password-1';
function request({body,method='POST',headers={},ip='127.0.0.1'}={}){
 const stream=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);
 stream.method=method;stream.headers={host:'admin.test',origin:'http://admin.test','content-type':'application/json',...headers};stream.socket={remoteAddress:ip};return stream;
}
function response(){return {headers:{},status:null,text:'',setHeader(name,value){this.headers[name]=value;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(text){this.text=text;this.data=JSON.parse(text);}};}
async function invoke(auth,path,options={}){const res=response();assert.equal(await auth.handle(request(options),res,new URL(path,'http://admin.test')),true);return res;}
function fakeDatabase({users=[]}={}){
 const sessions=new Map(),calls=[];
 const queryFn=async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id FROM admin_users'))return {rows:users.filter(user=>user.active&&user.role==='administrator').slice(0,1)};
  if(sql.startsWith('INSERT INTO admin_users')){
   if(users.some(user=>user.email===params[1]||user.active&&user.role==='administrator'))return {rows:[]};
   const user={id:params[0],email:params[1],password_hash:params[2],role:'administrator',active:true};users.push(user);return {rows:[user]};
  }
  if(sql.startsWith('SELECT id,email,password_hash'))return {rows:users.filter(user=>user.email===params[0])};
  if(sql.startsWith('DELETE FROM admin_sessions WHERE expires_at')){for(const [key,value]of sessions)if(value.expires_at<=params[0])sessions.delete(key);return {rows:[]};}
  if(sql.startsWith('INSERT INTO admin_sessions')){sessions.set(params[0],{user_id:params[1],csrf_token:params[2],expires_at:params[3]});return {rows:[]};}
  if(sql.startsWith('SELECT u.id')){
   const session=sessions.get(params[0]),user=session&&users.find(user=>user.id===session.user_id&&user.active);
   return {rows:user&&session.expires_at>params[1]?[{...user,csrf_token:session.csrf_token}]:[]};
  }
  if(sql.startsWith('DELETE FROM admin_sessions WHERE token_hash')){sessions.delete(params[0]);return {rows:[]};}
  if(sql.startsWith('DELETE FROM admin_sessions WHERE user_id')){for(const [key,value]of sessions)if(value.user_id===params[0])sessions.delete(key);return {rows:[]};}
  if(sql.startsWith('SELECT password_hash'))return {rows:users.filter(user=>user.id===params[0]&&user.active)};
  if(sql.startsWith('WITH updated AS')){
   users.find(user=>user.id===params[0]).password_hash=params[1];
   for(const [key,value]of sessions)if(value.user_id===params[0])sessions.delete(key);return {rows:[]};
  }
  throw new Error('Unrecognized test query');
 };
 return {queryFn,users,sessions,calls};
}
async function fixture(options={}){
 const user={id:randomUUID(),email:'owner@example.test',password_hash:await hashPassword(password),role:'administrator',active:true};
 const db=fakeDatabase({users:[user]}),auth=createAdminAuth({queryFn:db.queryFn,secure:false,siteUrl:'http://admin.test',...options});return {user,db,auth};
}

test('passwords use unique salts and verify with no plaintext storage',async()=>{
 const first=await hashPassword(password),second=await hashPassword(password);
 assert.notEqual(first,second);assert.ok(!first.includes(password));assert.match(first,/^scrypt\$32768\$8\$1\$/);
 assert.equal(await verifyPassword(password,first),true);assert.equal(await verifyPassword(password+'wrong',first),false);
 assert.equal(await verifyPassword(password,'scrypt$999999999$8$1$invalid$invalid'),false);
 assert.equal(await verifyPassword('x'.repeat(129),first),false);
});
test('password boundaries allow the supplied 12-character initial password and reject weak or oversized input',()=>{
 assert.equal(validateAdminPassword('Password123!'),'Password123!');
 assert.throws(()=>validateAdminPassword('short'),{status:400,message:'Password must contain at least 12 characters and no more than 128 bytes.'});assert.throws(()=>validateAdminPassword('أ'.repeat(65)),{status:400});
 assert.equal(normalizeAdminEmail(' Owner@Example.Test '),'owner@example.test');
});
test('administrator bootstrap never overwrites an existing administrator password',async()=>{
 const db=fakeDatabase(),options={queryFn:db.queryFn,initializeFn:async()=>true};
 assert.equal((await bootstrapAdministrator({email:' Owner@Example.Test ',password},options)).created,true);
 const encoded=db.users[0].password_hash;
 assert.equal((await bootstrapAdministrator({email:'owner@example.test',password:'Another-secure-password-2'},options)).created,false);
 assert.equal(db.users[0].password_hash,encoded);assert.equal(db.users[0].role,'administrator');
});
test('origin validation rejects null, missing, unrelated and malformed origins',()=>{
 const good=request();assert.doesNotThrow(()=>requireAdminOrigin(good,'http://admin.test'));
 for(const origin of ['null',undefined,'https://evil.test','http://admin.test/path','http://admin.test.evil.test'])assert.throws(()=>requireAdminOrigin(request({headers:{origin}}),'http://admin.test'),{status:403});
 assert.doesNotThrow(()=>requireAdminOrigin(request({headers:{host:'internal:3000',origin:'https://admin.test'}}),'https://admin.test'));
});
test('JSON input limits reject incorrect content type, arrays, invalid JSON and oversized streams',async()=>{
 await assert.rejects(readAdminJson(request({body:{},headers:{'content-type':'text/plain'}})),{status:415});
 for(const body of ['[]','null','{'])await assert.rejects(readAdminJson(request({body})),{status:400});
 await assert.rejects(readAdminJson(request({body:'x'.repeat(65537)})),{status:413});
 assert.deepEqual(await readAdminJson(request({body:{value:'عربي'}})),{value:'عربي'});
});
test('login issues an HttpOnly session cookie while persisting only its hash and returning public account fields',async()=>{
 const {auth,db,user}=await fixture();
 const res=await invoke(auth,'/api/admin/login',{body:{email:' OWNER@EXAMPLE.TEST ',password}});
 assert.equal(res.status,200);assert.deepEqual(res.data.user,{id:user.id,email:user.email,role:user.role});
 assert.deepEqual(Object.keys(res.data).sort(),['csrf','user']);assert.match(res.headers['Set-Cookie'],/; HttpOnly; SameSite=Strict; Max-Age=28800/);
 const token=res.headers['Set-Cookie'].split(';')[0].split('=')[1];
 assert.ok(db.sessions.has(hashSessionToken(token)));assert.equal(db.sessions.has(token),false);assert.notEqual(res.data.csrf,token);
 const session=await auth.requireUser(request({headers:{cookie:'cimahub_admin='+token}}));assert.equal(session.user.id,user.id);
 await assert.rejects(auth.requireMutation(request({headers:{cookie:'cimahub_admin='+token}})),{status:403});
 await assert.rejects(auth.requireMutation(request({headers:{cookie:'cimahub_admin='+token,'x-csrf-token':res.data.csrf,origin:'https://evil.test'}})),{status:403});
 assert.equal((await auth.requireMutation(request({headers:{cookie:'cimahub_admin='+token,'x-csrf-token':res.data.csrf}}))).user.id,user.id);
});
test('expired and inactive sessions cannot authenticate',async()=>{
 let time=Date.UTC(2026,9,14);const {auth,db,user}=await fixture({now:()=>time});
 const login=await invoke(auth,'/api/admin/login',{body:{email:user.email,password}}),cookie=login.headers['Set-Cookie'].split(';')[0];
 user.active=false;assert.equal(await auth.session(request({headers:{cookie}})),null);user.active=true;
 time+=8*60*60*1000;assert.equal(await auth.session(request({headers:{cookie}})),null);assert.equal(db.sessions.size,1);
 await assert.rejects(auth.requireUser(request({headers:{cookie}})),{status:401});
});
test('invalid login attempts are rate limited per email even across separate client addresses',async()=>{
 const {auth,user}=await fixture();
 for(let index=0;index<8;index++)assert.equal((await invoke(auth,'/api/admin/login',{body:{email:user.email,password:'incorrect'},ip:'127.0.0.'+(index+1)})).status,401);
 assert.equal((await invoke(auth,'/api/admin/login',{body:{email:user.email,password},ip:'127.0.0.20'})).status,429);
});
test('logout requires CSRF and revokes only the supplied session',async()=>{
 const {auth,db,user}=await fixture();
 const one=await invoke(auth,'/api/admin/login',{body:{email:user.email,password}}),two=await invoke(auth,'/api/admin/login',{body:{email:user.email,password}});
 const cookie=one.headers['Set-Cookie'].split(';')[0];
 assert.equal((await invoke(auth,'/api/admin/logout',{headers:{cookie}})).status,403);assert.equal(db.sessions.size,2);
 const logout=await invoke(auth,'/api/admin/logout',{headers:{cookie,'x-csrf-token':one.data.csrf}});
 assert.equal(logout.status,200);assert.match(logout.headers['Set-Cookie'],/Max-Age=0/);assert.equal(db.sessions.size,1);
 assert.equal(await auth.session(request({headers:{cookie}})),null);assert.ok(await auth.session(request({headers:{cookie:two.headers['Set-Cookie'].split(';')[0]}})));
});
test('changing password checks the existing password and revokes every session atomically',async()=>{
 const {auth,db,user}=await fixture();
 const one=await invoke(auth,'/api/admin/login',{body:{email:user.email,password}});await invoke(auth,'/api/admin/login',{body:{email:user.email,password}});
 const headers={cookie:one.headers['Set-Cookie'].split(';')[0],'x-csrf-token':one.data.csrf};
 assert.equal((await invoke(auth,'/api/admin/password',{headers,body:{currentPassword:'incorrect',newPassword:'Replacement-password-2'}})).status,400);assert.equal(db.sessions.size,2);
 const changed=await invoke(auth,'/api/admin/password',{headers,body:{currentPassword:password,newPassword:'Replacement-password-2'}});
 assert.equal(changed.status,200);assert.equal(db.sessions.size,0);assert.equal(await verifyPassword('Replacement-password-2',user.password_hash),true);assert.equal(await verifyPassword(password,user.password_hash),false);
 assert.equal(db.calls.filter(call=>call.sql.startsWith('WITH updated AS')).length,1);
});
test('session endpoint is private, methods are constrained, and authentication database failures are generic',async()=>{
 const {auth}=await fixture();assert.equal((await invoke(auth,'/api/admin/session',{method:'GET'})).status,401);
 const method=await invoke(auth,'/api/admin/login',{method:'GET'});assert.equal(method.status,405);assert.equal(method.headers.Allow,'POST');assert.equal(method.data.error,'Request method is not allowed.');
 const down=createAdminAuth({queryFn:async()=>{throw new Error('postgres://secret-connection');},siteUrl:'http://admin.test'});
 const res=await invoke(down,'/api/admin/login',{body:{email:'owner@example.test',password}});assert.equal(res.status,503);assert.ok(!res.text.includes('secret-connection'));assert.equal(res.data.error,'Unable to connect to the admin database. Please try again.');
 assert.match(adminSessionCookie('a'.repeat(43),{secure:true}),/; Secure$/);
 assert.throws(()=>adminSessionCookie('bad; injection'));
});
