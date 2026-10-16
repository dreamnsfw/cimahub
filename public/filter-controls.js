export function enhanceFilters(root=document){
 for(const select of root.querySelectorAll('.filters select:not([data-enhanced])')){
  select.dataset.enhanced='true';
  const wrapper=document.createElement('div');wrapper.className='filter-control';
  const button=document.createElement('button');button.type='button';button.className='filter-trigger';
  const label=select.getAttribute('aria-label')||select.name;
  const visibleLabel=document.createElement('span');visibleLabel.className='filter-label';visibleLabel.textContent=({genre:'النوع',year:'السنة',region:'القسم',sort:'الترتيب',type:'نوع العمل'})[select.name]||label;
  const caption=document.createElement('span'),chevron=document.createElement('span');chevron.className='filter-chevron';chevron.setAttribute('aria-hidden','true');
  button.append(caption,chevron);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const panel=document.createElement('div');panel.className='filter-options';panel.hidden=true;panel.setAttribute('role','listbox');panel.setAttribute('aria-label',label);
  panel.id='filter-options-'+select.name+'-'+Math.random().toString(36).slice(2,8);button.setAttribute('aria-controls',panel.id);
  select.before(wrapper);wrapper.append(visibleLabel,select,button,panel);select.hidden=true;
  const options=[...select.options].map(option=>{
   const item=document.createElement('button');item.type='button';item.setAttribute('role','option');item.tabIndex=-1;item.textContent=option.text;item.disabled=option.disabled;
   item.addEventListener('click',()=>{select.value=option.value;sync();close(true);select.dispatchEvent(new Event('change',{bubbles:true}));});panel.append(item);return item;
  });
  function sync(){caption.textContent=select.selectedOptions[0]?.text||label;button.setAttribute('aria-label',label+': '+caption.textContent);options.forEach((item,i)=>item.setAttribute('aria-selected',String(i===select.selectedIndex)));}
  function close(focus=false){panel.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus();}
  function open(){document.dispatchEvent(new Event('close-filter-menus'));panel.hidden=false;button.setAttribute('aria-expanded','true');const box=button.getBoundingClientRect(),width=Math.min(box.width,innerWidth-24);panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(box.left,innerWidth-width-12))+'px';const below=innerHeight-box.bottom-12,above=box.top-12;const useBelow=below>=Math.min(280,panel.scrollHeight)||below>=above;panel.style.maxHeight=Math.max(80,Math.min(280,useBelow?below-6:above-6))+'px';panel.style.top=useBelow?box.bottom+6+'px':'auto';panel.style.bottom=useBelow?'auto':innerHeight-box.top+6+'px';options[Math.max(0,select.selectedIndex)]?.focus({preventScroll:true});options[Math.max(0,select.selectedIndex)]?.scrollIntoView({block:'nearest'});}
  button.addEventListener('click',()=>panel.hidden?open():close());
  button.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}});
  panel.addEventListener('keydown',e=>{const index=options.indexOf(document.activeElement);let next;if(e.key==='ArrowDown')next=Math.min(options.length-1,index+1);if(e.key==='ArrowUp')next=Math.max(0,index-1);if(e.key==='Home')next=0;if(e.key==='End')next=options.length-1;if(next!==undefined){e.preventDefault();options[next]?.focus();}if(e.key==='Escape'){e.preventDefault();close(true);}if(e.key==='Tab')close();});
  const controller=new AbortController(),signal=controller.signal;
  document.addEventListener('close-filter-menus',()=>close(),{signal});
  document.addEventListener('pointerdown',e=>{if(!wrapper.contains(e.target))close();},{signal});
  window.addEventListener('resize',()=>close(),{signal});
  window.addEventListener('scroll',e=>{if(!panel.contains(e.target))close();},{signal,capture:true});
  select.addEventListener('change',sync);sync();
  const cleanup=new MutationObserver(()=>{if(!wrapper.isConnected){controller.abort();cleanup.disconnect();}});cleanup.observe(document.body,{childList:true,subtree:true});
 }
}
