import {query} from './database.js';
import {runBoundedSync} from './sync-execution.js';

export async function runRecordedJob({name,run,queryFn=query,timeoutMs=180000,bounded=true}){
 const row=(await queryFn("INSERT INTO job_runs(job,status) VALUES($1,'running') RETURNING id",[name])).rows[0];
 try{
  const details=await (bounded?runBoundedSync(run,{timeoutMs}):run());
  await queryFn("UPDATE job_runs SET status='success',details=$2 WHERE id=$1",[row.id,JSON.stringify(details??{})]);
  return {ok:true,status:'success',runId:row.id};
 }catch(error){
  await queryFn("UPDATE job_runs SET status='error',details=$2 WHERE id=$1",[row.id,JSON.stringify({error:String(error.message).slice(0,500),...(error.code==='SYNC_JOB_TIMEOUT'?{code:error.code}:{})})]);
  if(error.code==='SYNC_JOB_TIMEOUT')throw Object.assign(error,{runId:row.id});
  throw Object.assign(new Error('The sync batch failed. Check the latest run details.'),{status:502,code:'SYNC_JOB_FAILED',runId:row.id});
 }
}
