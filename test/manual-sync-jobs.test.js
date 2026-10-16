import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {runBoundedSync,syncFetchSignal,checkSyncDeadline,joinSyncWorkers} from '../sync-execution.js';
import {runRecordedJob} from '../admin-jobs.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fakeDatabase(events=[]){
 const calls=[];
 return {calls,queryFn:async(sql,params=[])=>{
  calls.push({sql,params});
  if(/^\s*INSERT\s+INTO\s+job_runs\b/i.test(sql)){events.push('record-running');return {rows:[{id:71}],rowCount:1};}
  if(/^\s*UPDATE\s+job_runs\b/i.test(sql)){events.push('record-finished');return {rows:[],rowCount:1};}
  throw new Error('Unexpected job-record query');
 }};
}
function recordedStatus(call){return call.params.find(value=>['running','success','error','failed'].includes(value))||call.sql.match(/status\s*=\s*'(running|success|error|failed)'/i)?.[1];}
function abortableUpstream(signal,{events,delayMs=300}={}){
 return new Promise((resolve,reject)=>{
  const finish=()=>{signal.removeEventListener('abort',abort);resolve('upstream-result');};
  const timer=setTimeout(finish,delayMs);
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);events?.push('upstream-aborted');reject(signal.reason);};
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
}

test('bounded sync returns completed work and clears its deadline after success',async()=>{
 let signal;
 const result=await runBoundedSync(async()=>{signal=syncFetchSignal(1000);checkSyncDeadline();return {processed:3};},{timeoutMs:25});
 assert.deepEqual(result,{processed:3});
 await delay(45);assert.equal(signal.aborted,false);
 assert.doesNotThrow(checkSyncDeadline);
});
test('a deadline cancels upstream work and waits for cleanup before rejecting',async()=>{
 const events=[],writes=[];
 await assert.rejects(runBoundedSync(async()=>{
  try{await abortableUpstream(syncFetchSignal(1000),{events});checkSyncDeadline();writes.push('must-not-run');}
  finally{await delay(10);events.push('cleanup-finished');}
 },{timeoutMs:20}),{code:'SYNC_JOB_TIMEOUT',status:504});
 assert.deepEqual(events,['upstream-aborted','cleanup-finished']);
 await delay(35);assert.deepEqual(writes,[]);assert.deepEqual(events,['upstream-aborted','cleanup-finished']);
});
test('deadline checks prevent writes after an upstream abort is caught',async()=>{
 let aborted=false;const writes=[];
 await assert.rejects(runBoundedSync(async()=>{
  const signal=syncFetchSignal(1000);
  try{await abortableUpstream(signal);}catch{aborted=signal.aborted;}
  checkSyncDeadline();writes.push('must-not-run');
 },{timeoutMs:20}),{code:'SYNC_JOB_TIMEOUT',status:504});
 assert.equal(aborted,true);assert.deepEqual(writes,[]);
});
test('recorded jobs await their work before reporting success',async()=>{
 const events=[],db=fakeDatabase(events),started=deferred(),release=deferred();let resolved=false;
 const pending=runRecordedJob({name:'sources',queryFn:db.queryFn,timeoutMs:1000,run:async()=>{events.push('work-started');started.resolve();await release.promise;events.push('work-finished');return {processed:2};}}).then(value=>{resolved=true;return value;});
 await started.promise;
 assert.equal(resolved,false);assert.deepEqual(events,['record-running','work-started']);assert.equal(db.calls.length,1);
 release.resolve();assert.deepEqual(await pending,{ok:true,status:'success',runId:71});
 assert.deepEqual(events,['record-running','work-started','work-finished','record-finished']);
 assert.equal(recordedStatus(db.calls.at(-1)),'success');
 assert.ok(db.calls[0].params.includes('sources'));
 assert.ok(db.calls.at(-1).params.includes(71));
 assert.ok(db.calls.at(-1).params.includes(JSON.stringify({processed:2})));
});
test('recorded jobs persist an upstream error and reject with a useful response status',async()=>{
 const db=fakeDatabase();
 await assert.rejects(runRecordedJob({name:'sources',queryFn:db.queryFn,run:async()=>{throw new Error('Upstream service unavailable');}}),{code:'SYNC_JOB_FAILED',status:502,runId:71});
 assert.equal(db.calls.length,2);assert.ok(['error','failed'].includes(recordedStatus(db.calls[1])));
 assert.match(JSON.stringify(db.calls[1].params),/Upstream service unavailable/);
 assert.ok(db.calls[1].params.includes(71));
});
test('timed-out recorded jobs finish cancellation before saving the terminal error',async()=>{
 const events=[],db=fakeDatabase(events),writes=[];
 await assert.rejects(runRecordedJob({name:'sources',queryFn:db.queryFn,timeoutMs:20,run:async()=>{
  try{await abortableUpstream(syncFetchSignal(1000),{events});checkSyncDeadline();writes.push('must-not-run');}
  finally{await delay(10);events.push('cleanup-finished');}
 }}),{code:'SYNC_JOB_TIMEOUT',status:504});
 assert.deepEqual(events,['record-running','upstream-aborted','cleanup-finished','record-finished']);
 assert.ok(['error','failed'].includes(recordedStatus(db.calls.at(-1))));
 assert.match(JSON.stringify(db.calls.at(-1).params),/SYNC_JOB_TIMEOUT|timed? ?out|deadline/i);
 const callCount=db.calls.length;await delay(35);assert.equal(db.calls.length,callCount);assert.deepEqual(writes,[]);
});
test('a failed worker does not detach the remaining workers from the recorded job',async()=>{
 const events=[],db=fakeDatabase(events),writes=[];
 await assert.rejects(runRecordedJob({name:'sources',queryFn:db.queryFn,timeoutMs:1000,run:async()=>joinSyncWorkers([
  (async()=>{await delay(5);throw new Error('First upstream failed');})(),
  (async()=>{await delay(25);checkSyncDeadline();writes.push('completed-write');events.push('remaining-worker-finished');})()
 ])}),{code:'SYNC_JOB_FAILED',status:502});
 assert.deepEqual(events,['record-running','remaining-worker-finished','record-finished']);assert.deepEqual(writes,['completed-write']);
 await delay(30);assert.deepEqual(writes,['completed-write']);assert.equal(db.calls.length,2);
});
