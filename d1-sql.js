// SQL adaptations are deliberately limited to the application's existing
// statements. Values stay bound parameters throughout the conversion.
const shallowMerge=(left,right)=>`(SELECT json_group_object(key,json(encoded)) FROM (
 SELECT key,CASE type WHEN 'text' THEN json_quote(value) WHEN 'null' THEN 'null' WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(value AS TEXT) END AS encoded FROM json_each(${left}) WHERE key NOT IN (SELECT key FROM json_each(${right}))
 UNION ALL SELECT key,CASE type WHEN 'text' THEN json_quote(value) WHEN 'null' THEN 'null' WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(value AS TEXT) END AS encoded FROM json_each(${right})))`;
export function d1Statement(sql, params = []) {
  let text=sql.trim();
  if(text.includes('jsonb_to_recordset')){
    text=`INSERT INTO content_items(key,kind,provider_id,slug,name,year,snapshot)
      SELECT value->>'key',value->>'kind',value->>'provider_id',value->>'slug',value->>'name',value->>'year',value->'snapshot'
      FROM json_each($1) WHERE true
      ON CONFLICT(key) DO UPDATE SET
      snapshot=${shallowMerge('content_items.snapshot','excluded.snapshot')},
      name=CASE WHEN json_type(content_items.overrides,'$.title') IS NOT NULL OR json_type(content_items.overrides,'$.name') IS NOT NULL THEN content_items.name ELSE excluded.name END,
      year=CASE WHEN excluded.year='' THEN content_items.year ELSE excluded.year END,
      slug=coalesce(content_items.slug,excluded.slug),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING *`;
  }
  text=text.replace(/(\w+)\s*=\s*ANY\(\$(\d+)::text\[\]\)/g,(_,field,n)=>`${field} IN (SELECT value FROM json_each($${n}))`);
  text=text.replace(/(overrides|snapshot)->'(genre_ids|genres)'\s*@>\s*'[^']*'::jsonb/g,(_,field,key)=>`EXISTS(SELECT 1 FROM json_each(${field},'$.${key}') WHERE ${key==='genre_ids'?'value':"value->>'id'"}=16)`);
  text=text.replace(/\b(overrides|snapshot)\s*\?\s*'([^']+)'/g,(_,field,key)=>`json_type(${field},'$.${key}') IS NOT NULL`);
  text=text.replace(/overrides-\$2::text\[\]/g,()=>{
    const fields=params[1];
    if(!Array.isArray(fields)||fields.some(f=>!/^\w+$/.test(f)))throw new Error('Invalid JSON reset fields');
    return fields.length?`json_remove(overrides,${fields.map(f=>`'$.${f}'`).join(',')})`:'overrides';
  });
  text=text.replace(/((?:\w+\.)?(?:overrides|snapshot|data))\s*\|\|\s*(\$\d+(?:::jsonb)?|excluded\.(?:snapshot|data))/gi,(_,left,right)=>shallowMerge(left,right.replace('::jsonb','')));
  text=text.replace(/::(?:jsonb|text\[\]|text|int|bigint)\b(?:\[\])?/g,'');
  text=text.replace(/\bILIKE\b/g,'LIKE').replace(/\b(?:clock_timestamp|now)\(\)/g,"strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  text=text.replace(/\s+FOR UPDATE\b/g,'');
  const values=[];
  text=text.replace(/\$(\d+)/g,(_,n)=>{
    const value=params[Number(n)-1];
    if(value===undefined)throw new Error('Missing SQL parameter');
    values.push(value instanceof Date?value.toISOString():typeof value==='boolean'?Number(value):Array.isArray(value)?JSON.stringify(value):value);
    return '?';
  });
  return {sql:text,params:values};
}

export function d1Rows(result){
  return (result.results||[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
    if(['overrides','snapshot','value','details','data'].includes(key)&&typeof value==='string'){
      try{return [key,JSON.parse(value)];}catch{throw new Error('Invalid stored JSON');}
    }
    return [key,['active','enabled','managed','is_anime'].includes(key)&&value!==null?Boolean(value):value];
  })));
}
