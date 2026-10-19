import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(name,context,next){
 if(name==='./d1-client.js')return {url:'cimahub:path-client',shortCircuit:true};
 if(name==='./managed-content.js')return {url:'cimahub:path-managed',shortCircuit:true};
 return next(name,context);
},load(url,context,next){
 if(url==='cimahub:path-client')return {format:'module',shortCircuit:true,source:`export const prefetchCatalog=async()=>{};export const d1Request=async operation=>{if(operation!=='catalog.get')throw new Error('Unexpected persistent write');return null;};`};
 if(url==='cimahub:path-managed')return {format:'module',shortCircuit:true,source:`export const resolveManaged=async()=>null,managedWorks=async()=>[],rememberAndApply=async(data,type,options)=>{if(options.persist)throw new Error('Unexpected content persistence');return data;};`};
 return next(url,context);
}});
const {createD1SeoCatalog}=await import('../d1-seo-catalog.js');
test('D1 creates named movie links in memory without saving records or image mappings',async()=>{
 const catalog=createD1SeoCatalog();
 const movie=await catalog.decorate({id:1003598,title:'Avengers: Secret Wars',release_date:'2027-12-15',poster_path:'/poster.jpg',backdrop_path:'/cover.jpg'});
 assert.equal(movie.public_path,'/avengers-secret-wars-2027/');
 assert.equal(movie.poster_path,'/poster.jpg');
 assert.equal(movie.backdrop_path,'/cover.jpg');
});
