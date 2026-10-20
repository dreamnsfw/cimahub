export async function publishContent({hook=process.env.CONTENT_PUBLISH_HOOK,fetcher=fetch}={}){
 if(!hook){if(process.env.VERCEL&&process.env.PUBLIC_DATABASE_REQUIRED==='1')throw new Error('Automatic content publication is not configured');return;}
 const url=new URL(hook);
 if(url.origin!=='https://api.vercel.com'||!url.pathname.startsWith('/v1/integrations/deploy/'))throw new Error('Invalid publication hook');
 const response=await fetcher(url,{method:'POST',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Automatic content publication failed');
}
