import {AsyncLocalStorage} from 'node:async_hooks';

const execution=new AsyncLocalStorage();
export function checkSyncDeadline(){execution.getStore()?.throwIfAborted();}
export function syncFetchSignal(timeoutMs){
 const deadline=execution.getStore(),request=AbortSignal.timeout(timeoutMs);
 return deadline?AbortSignal.any([deadline,request]):request;
}
export async function runBoundedSync(task,{timeoutMs=180000}={}){
 const controller=new AbortController();
 const error=Object.assign(new Error('The sync batch timed out. Run it again to continue.'),{status:504,code:'SYNC_JOB_TIMEOUT'});
 const timer=setTimeout(()=>controller.abort(error),timeoutMs);
 try{return await execution.run(controller.signal,async()=>{checkSyncDeadline();const result=await task();checkSyncDeadline();return result;});}
 finally{clearTimeout(timer);}
}
// Wait for every worker to stop before a deadline failure reaches the response.
export async function joinSyncWorkers(workers){
 const results=await Promise.allSettled(workers),failure=results.find(result=>result.status==='rejected');
 if(failure)throw failure.reason;
 return results.map(result=>result.value);
}
