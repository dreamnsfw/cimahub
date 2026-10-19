export default {
 fetch(request){
  const url=new URL(request.url);
  if(url.hostname!=='www.cimahub.net')return new Response('Not found',{status:404});
  url.hostname='cimahub.net';url.protocol='https:';url.port='';
  return Response.redirect(url.href,308);
 }
};
