import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
const database=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const pgctl=path.resolve('.runtime/postgres/bin/pg_ctl.exe'),cluster=path.resolve('.runtime/pgdata');
function run(command,args,stdio='pipe'){return new Promise((resolve,reject)=>{const p=spawn(command,args,{windowsHide:true,stdio});let errors='';p.stderr?.on('data',b=>errors+=b);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(errors||'Local database startup failed')));});}
if(database?.hostname==='127.0.0.1'&&database.port==='5433'&&existsSync(pgctl)&&existsSync(cluster)){
 try{await run(pgctl,['-D',cluster,'status']);}catch{await run(pgctl,['-D',cluster,'-l',path.resolve('.runtime/postgres.log'),'-o','-h 127.0.0.1 -p 5433','-w','start']);}
}
const child=spawn(process.execPath,['--env-file=.env',...(process.argv.includes('--watch')?['--watch']:[]),'server.js'],{stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code||0);child.on('error',()=>{console.error('تعذر تشغيل الموقع');process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
