import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(new URL('../db/public.sqlite',import.meta.url),{readOnly:true});
if(!db.prepare('SELECT count(*) AS n FROM content_items').get().n)throw Error('Empty public data');
for(const table of ['admin_users','admin_sessions','job_runs','runtime_state'])if(db.prepare('SELECT count(*) AS n FROM '+table).get().n)throw Error('Private data present');
db.close();console.log('Prepared public data verified');
