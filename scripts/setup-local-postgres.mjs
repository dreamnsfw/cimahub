import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const url='https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip';
const base=path.resolve('.runtime/postgres');
async function range(start,end){const r=await fetch(url,{headers:{Range:`bytes=${start}-${end??''}`},signal:AbortSignal.timeout(180000)});if(r.status!==206){await r.body?.cancel();throw new Error('PostgreSQL archive range download unavailable');}return Buffer.from(await r.arrayBuffer());}
async function binaries(){
 const tail=await range(384620317-65536,384620316);let pos=tail.length-22;for(;pos>=0;pos--)if(tail.readUInt32LE(pos)===0x06054b50)break;
 const directory=await range(tail.readUInt32LE(pos+16),tail.readUInt32LE(pos+16)+tail.readUInt32LE(pos+12)-1);const entries=[];
 for(let at=0;at<directory.length;){if(directory.readUInt32LE(at)!==0x02014b50)throw new Error('Invalid archive directory');const n=directory.readUInt16LE(at+28),x=directory.readUInt16LE(at+30),c=directory.readUInt16LE(at+32);const name=directory.toString('utf8',at+46,at+46+n);if(/^pgsql\/(?:bin\/[^/]+\.(?:exe|dll)|lib\/[^/]+\.(?:dll|so)|share\/(?:[^/]+|timezonesets\/[^/]+|timezone\/.+|extension\/[^/]+\.(?:sql|control)))$/i.test(name))entries.push({name,size:directory.readUInt32LE(at+20),offset:directory.readUInt32LE(at+42),method:directory.readUInt16LE(at+10)});at+=46+n+x+c;}
 entries.sort((a,b)=>a.offset-b.offset);const groups=[];
 for(const e of entries){const last=groups.at(-1);const end=e.offset+30+Buffer.byteLength(e.name)+200+e.size;if(last&&e.offset-last.end<65536&&end-last.start<4194304){last.entries.push(e);last.end=end;}else groups.push({start:e.offset,end,entries:[e]});}
 console.log(`Downloading PostgreSQL runtime: ${entries.length} files, ${Math.round(groups.reduce((n,g)=>n+g.end-g.start,0)/1048576)} MB`);
 let cursor=0,done=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<groups.length){const g=groups[cursor++];const data=await range(g.start,g.end);for(const e of g.entries){const at=e.offset-g.start;if(data.readUInt32LE(at)!==0x04034b50)throw new Error('Invalid archive file');const start=at+30+data.readUInt16LE(at+26)+data.readUInt16LE(at+28),compressed=data.subarray(start,start+e.size);const body=e.method===8?inflateRawSync(compressed):compressed;const target=path.resolve(base,e.name.replace(/^pgsql\//,''));if(!target.startsWith(base+path.sep))throw new Error('Invalid archive path');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);}if(++done%5===0)console.log(`Runtime groups ${done}/${groups.length}`);}}));
}
async function run(name,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(path.join(base,'bin',name+'.exe'),args,{windowsHide:true,...options});let output='';child.stdout?.on('data',b=>output+=b);child.stderr?.on('data',b=>output+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(new Error(`${name} failed: ${output.slice(-1400)}`)));});}
try{await stat(path.join(base,'bin/postgres.exe'));}catch{await binaries();}
const data=path.resolve('.runtime/pgdata'),secret=path.resolve('.runtime/pg-bootstrap-secret');let initialized=false;try{await stat(path.join(data,'PG_VERSION'));initialized=true;}catch{}
let password;try{password=(await readFile(secret,'utf8')).trim();}catch{password=randomBytes(32).toString('base64url');await writeFile(secret,password,{mode:0o600});}
if(!initialized){console.log('Initializing local database');await run('initdb',['-D',data,'-U','cimahub','--pwfile='+secret,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);}
try{await run('pg_ctl',['-D',data,'status']);}catch{await run('pg_ctl',['-D',data,'-l',path.resolve('.runtime/postgres.log'),'-o','-h 127.0.0.1 -p 5433','-w','start']);}
let env=await readFile('.env','utf8').catch(()=> '');const connection=`postgresql://cimahub:${encodeURIComponent(password)}@127.0.0.1:5433/cimahub`;
process.env.DATABASE_URL=connection.replace(/\/cimahub$/,'/postgres');const {Client}=await import('pg');const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='cimahub'")).rowCount)await client.query('CREATE DATABASE cimahub');await client.end();
env=env.replace(/^DATABASE_URL=.*(?:\r?\n|$)/m,'');await writeFile('.env',env.trimEnd()+'\nDATABASE_URL='+connection+'\n');console.log('Local PostgreSQL ready on 127.0.0.1:5433; connection saved privately in .env');
