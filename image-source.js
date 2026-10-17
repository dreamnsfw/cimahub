const sourcePath=value=>typeof value==='string'&&/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(value)?value:null;

// A named poster can reach a fresh server before its catalog image map does.
// Resolve its owner and recover the provider path instead of treating the slug
// as a TMDB image hash (which always produces a missing image).
export function createImageSourceResolver({catalog,load}){
 const pending=new Map();
 return async name=>{
  const saved=sourcePath(await catalog.imageSource(name));
  if(saved&&saved!=='/'+name)return saved;
  const named=name.match(/^([a-z0-9-]+)-(poster|backdrop)(?:-\d+)?\.(jpg|png|webp)$/);
  if(!named)return sourcePath('/'+name);
  if(pending.has(name))return pending.get(name);
  const work=(async()=>{
   const record=await catalog.resolve(named[1]);
   if(!record||!['movie','tv'].includes(record.type))return null;
   const item=await load(`${record.type}/${record.id}`,new URLSearchParams({language:'en-US'}));
   return sourcePath(item[named[2]+'_path']);
  })().finally(()=>pending.delete(name));
  pending.set(name,work);return work;
 };
}
