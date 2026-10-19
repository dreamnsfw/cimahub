// Encode once. Encoding each individual character can exhaust a Free Worker's
// CPU allowance when a document is several hundred kilobytes long.
export function documentChunks(value,limit=30000){
 const bytes=new TextEncoder().encode(value),decoder=new TextDecoder(),parts=[];
 for(let start=0;start<bytes.length;){
  let end=Math.min(start+limit,bytes.length);
  while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
  if(end===start)throw new Error('Chunk limit cannot fit a Unicode character');
  parts.push(decoder.decode(bytes.subarray(start,end)));start=end;
 }
 return parts.length?parts:[''];
}
