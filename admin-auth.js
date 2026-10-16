import {randomBytes,randomUUID,scrypt as scryptCallback,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {query,initializeDatabase} from './database.js';

const scrypt=promisify(scryptCallback);
const SESSION_COOKIE='cimahub_admin';
const SESSION_MS=8*60*60*1000;
const MAX_BODY_BYTES=64*1024;
const PASSWORD_OPTIONS={N:32768,r:8,p:1,maxmem:64*1024*1024};
const TOKEN_PATTERN=/^[A-Za-z0-9_-]{43}$/;

export class AdminAuthError extends Error{
 constructor(status,message){super(message);this.name='AdminAuthError';this.status=status;}
}
export function normalizeAdminEmail(value){return String(value??'').trim().toLowerCase();}
export function validateAdminPassword(password){
 if(typeof password!=='string'||[...password].length<12||Buffer.byteLength(password,'utf8')>128)throw new AdminAuthError(400,'Password must contain at least 12 characters and no more than 128 bytes.');
 return password;
}
export async function hashPassword(password){
 validateAdminPassword(password);
 const salt=randomBytes(24),key=await scrypt(password,salt,64,PASSWORD_OPTIONS);
 return `scrypt$32768$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password,encoded){
 if(typeof password!=='string'||Buffer.byteLength(password,'utf8')>128||typeof encoded!=='string')return false;
 const parts=encoded.split('$');
 if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!=='32768'||parts[2]!=='8'||parts[3]!=='1'||!/^[A-Za-z0-9_-]{32}$/.test(parts[4])||!/^[A-Za-z0-9_-]{86}$/.test(parts[5]))return false;
 const expected=Buffer.from(parts[5],'base64url'),actual=await scrypt(password,Buffer.from(parts[4],'base64url'),64,PASSWORD_OPTIONS);
 return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function hashSessionToken(token){return createHash('sha256').update(token).digest('hex');}
function equalTokens(left,right){
 if(typeof left!=='string'||typeof right!=='string'||!TOKEN_PATTERN.test(left)||!TOKEN_PATTERN.test(right))return false;
 return timingSafeEqual(Buffer.from(left),Buffer.from(right));
}
function requestIsSecure(req,secure,siteUrl=process.env.SITE_URL){
 if(secure||req.socket?.encrypted)return true;
 try{return new URL(siteUrl||'http://localhost').protocol==='https:';}catch{return false;}
}
export function adminSessionCookie(token,{secure=false,clear=false}={}){
 if(!clear&&!TOKEN_PATTERN.test(token))throw new TypeError('Invalid session token');
 return `${SESSION_COOKIE}=${clear?'':token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:SESSION_MS/1000}${secure?'; Secure':''}`;
}
function sessionToken(req){
 const cookies=String(req.headers?.cookie||'').split(';').map(part=>part.trim());
 const matches=cookies.filter(part=>part.startsWith(SESSION_COOKIE+'='));
 if(matches.length!==1)return null;
 const token=matches[0].slice(SESSION_COOKIE.length+1);
 return TOKEN_PATTERN.test(token)?token:null;
}
export function requireAdminOrigin(req,siteUrl=process.env.SITE_URL){
 const origin=req.headers?.origin;
 if(typeof origin!=='string'||origin==='null')throw new AdminAuthError(403,'Request origin is not allowed.');
 try{
  const supplied=new URL(origin);
  const expected=siteUrl?new URL(siteUrl):new URL(`${req.socket?.encrypted?'https':'http'}://${req.headers?.host||''}`);
  if(!['http:','https:'].includes(supplied.protocol)||supplied.origin!==origin||supplied.origin!==expected.origin)throw new Error('origin');
 }catch{throw new AdminAuthError(403,'Request origin is not allowed.');}
}
export async function readAdminJson(req){
 if(!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers?.['content-type']||'')))throw new AdminAuthError(415,'Request data must use JSON.');
 const length=Number(req.headers?.['content-length']);
 if(Number.isFinite(length)&&length>MAX_BODY_BYTES)throw new AdminAuthError(413,'Request exceeds the allowed size.');
 let size=0;const chunks=[];
 for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buffer.length;if(size>MAX_BODY_BYTES)throw new AdminAuthError(413,'Request exceeds the allowed size.');chunks.push(buffer);}
 try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('object');return data;}catch{throw new AdminAuthError(400,'Request data is invalid.');}
}
function publicUser(row){return {id:row.id,email:row.email,role:row.role};}
export async function bootstrapAdministrator({email,password},{queryFn=query,initializeFn=initializeDatabase}={}){
 const normalized=normalizeAdminEmail(email);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)||normalized.length>254)throw new AdminAuthError(400,'Email address is invalid.');
 validateAdminPassword(password);
 await initializeFn();
 const existing=await queryFn("SELECT id FROM admin_users WHERE active=TRUE AND role='administrator' LIMIT 1");
 if(existing.rows.length)return {created:false};
 const encoded=await hashPassword(password);
 const result=await queryFn("INSERT INTO admin_users(id,email,password_hash,role,active) SELECT $1,$2,$3,'administrator',TRUE WHERE NOT EXISTS(SELECT 1 FROM admin_users WHERE active=TRUE AND role='administrator') ON CONFLICT DO NOTHING RETURNING id,email,role",[randomUUID(),normalized,encoded]);
 return {created:result.rows.length===1,...(result.rows[0]?{user:publicUser(result.rows[0])}:{})};
}

export function createAdminAuth({queryFn=query,now=Date.now,secure=process.env.NODE_ENV==='production',siteUrl=process.env.SITE_URL}={}){
 const attempts=new Map();
 let dummyHash;
 function enforceLoginLimit(req,email){
  const timestamp=now(),windowMs=15*60*1000;
  for(const [key,value]of attempts)if(timestamp-value.started>=windowMs)attempts.delete(key);
  const keys=['ip:'+String(req.socket?.remoteAddress||'unknown'),'email:'+email.slice(0,254)];
  for(const key of keys){const entry=attempts.get(key);if(entry?.count>=8)throw new AdminAuthError(429,'Too many login attempts. Try again in 15 minutes.');}
  if(attempts.size>10000)throw new AdminAuthError(429,'Too many login attempts. Try again later.');
  for(const key of keys){const entry=attempts.get(key)||{started:timestamp,count:0};entry.count++;attempts.set(key,entry);}
 }
 async function session(req){
  const token=sessionToken(req);if(!token)return null;
  const tokenHash=hashSessionToken(token);
  const result=await queryFn('SELECT u.id,u.email,u.role,s.csrf_token FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.active=TRUE',[tokenHash,new Date(now())]);
  const row=result.rows[0];
  if(!row||!['administrator','editor'].includes(row.role))return null;
  return {user:publicUser(row),csrf:row.csrf_token,tokenHash};
 }
 async function requireUser(req){const current=await session(req);if(!current)throw new AdminAuthError(401,'Sign in to the admin panel to continue.');return current;}
 async function requireMutation(req,current){
  requireAdminOrigin(req,siteUrl);
  const authenticated=current||await requireUser(req);
  if(!equalTokens(req.headers?.['x-csrf-token'],authenticated.csrf))throw new AdminAuthError(403,'Request verification failed. Refresh the page and try again.');
  return authenticated;
 }
 async function invalidateSessions(userId){await queryFn('DELETE FROM admin_sessions WHERE user_id=$1',[userId]);}
 function respond(res,status,data,cookie){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(data));
 }
 async function handle(req,res,url){
  const pathname=url.pathname.replace(/\/$/,'');
  if(!['/api/admin/session','/api/admin/login','/api/admin/logout','/api/admin/password'].includes(pathname))return false;
  const method=pathname==='/api/admin/session'?'GET':'POST';
  if(req.method!==method){res.setHeader('Allow',method);respond(res,405,{error:'Request method is not allowed.'});return true;}
  try{
   if(pathname==='/api/admin/session'){const current=await requireUser(req);respond(res,200,{user:current.user,csrf:current.csrf});return true;}
   requireAdminOrigin(req,siteUrl);
   if(pathname==='/api/admin/login'){
    const body=await readAdminJson(req),email=normalizeAdminEmail(body.email??body.username);
    enforceLoginLimit(req,email);
    const result=await queryFn('SELECT id,email,password_hash,role,active FROM admin_users WHERE email=$1',[email.slice(0,254)]),user=result.rows[0];
    dummyHash??=hashPassword(randomBytes(32).toString('base64url'));
    const valid=await verifyPassword(body.password,user?.password_hash||await dummyHash);
    if(!valid||!user?.active||!['administrator','editor'].includes(user.role))throw new AdminAuthError(401,'Email or password is incorrect.');
    const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
    await queryFn('DELETE FROM admin_sessions WHERE expires_at<=$1',[new Date(now())]);
    await queryFn('INSERT INTO admin_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)',[hashSessionToken(token),user.id,csrf,new Date(now()+SESSION_MS)]);
    respond(res,200,{user:publicUser(user),csrf},adminSessionCookie(token,{secure:requestIsSecure(req,secure,siteUrl)}));return true;
   }
   const current=await requireMutation(req);
   if(pathname==='/api/admin/logout'){
    await queryFn('DELETE FROM admin_sessions WHERE token_hash=$1',[current.tokenHash]);
    respond(res,200,{ok:true},adminSessionCookie('',{clear:true,secure:requestIsSecure(req,secure,siteUrl)}));return true;
   }
   const body=await readAdminJson(req);
   validateAdminPassword(body.newPassword);
   const result=await queryFn('SELECT password_hash FROM admin_users WHERE id=$1 AND active=TRUE',[current.user.id]);
   if(!await verifyPassword(body.currentPassword,result.rows[0]?.password_hash))throw new AdminAuthError(400,'Current password is incorrect.');
   const encoded=await hashPassword(body.newPassword);
   // An update and session revocation belong to one database statement.
   await queryFn('WITH updated AS (UPDATE admin_users SET password_hash=$2 WHERE id=$1 RETURNING id) DELETE FROM admin_sessions WHERE user_id IN(SELECT id FROM updated)',[current.user.id,encoded]);
   respond(res,200,{ok:true},adminSessionCookie('',{clear:true,secure:requestIsSecure(req,secure,siteUrl)}));return true;
  }catch(error){
   const status=Number.isInteger(error.status)?error.status:503;
   respond(res,status,{error:error instanceof AdminAuthError?error.message:'Unable to connect to the admin database. Please try again.'});return true;
  }
 }
 return {session,requireUser,requireMutation,handle,invalidateSessions,readJson:readAdminJson};
}
