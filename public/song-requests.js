'use strict';
(() => {
  const get = id=>document.getElementById(id), isHost = document.body.classList.contains('host-page');
  let current = {items:[],count:0,revision:-1};
  const busy = new Set();
  const statusLabels = {pending:'En attente',accepted:'À écouter',played:'Joué',declined:'Non retenu'};
  const node = (tag, text, className) => { const element=document.createElement(tag); if(text)element.textContent=text;if(className)element.className=className;return element; };
  async function responseData(response) {
    const data = await response.json();
    if(!response.ok)throw new Error(data.error || 'La demande n’a pas pu être envoyée.');
    return data;
  }
  async function changeStatus(id,status) {
    busy.add(id);render(current);
    try {
      const data=await responseData(await fetch('/api/requests/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})}));
      render(data);get('requestsStatus').textContent='La demande a été mise à jour.';
    } catch(err){get('requestsStatus').textContent=err.message;}
    finally{busy.delete(id);render(current);}
  }
  function itemNode(item) {
    const li=node('li',null,'song-request');li.dataset.requestId=item.id;
    const header=node('div',null,'request-heading');
    header.append(node('strong',item.title),node('span',statusLabels[item.status] || item.status,'request-badge '+item.status));li.append(header);
    li.append(node('p','Proposé par '+item.name,'field-hint'));
    if(isHost&&['pending','accepted'].includes(item.status)){
      const actions=node('div',null,'request-actions');
      const button=(label,status)=>{const el=node('button',label,status==='declined'?'btn-ghost':'btn-primary');el.type='button';el.disabled=busy.has(item.id);el.addEventListener('click',()=>changeStatus(item.id,status));actions.append(el);};
      if(item.status==='pending')button('Accepter','accepted');else button('Marquer comme joué','played');
      button('Ne pas retenir','declined');
      if(item.url){const link=node('a','Dans le lecteur YouTube ↗','request-link');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.addEventListener('click',event=>{if(window.openYoutubeSource){event.preventDefault();window.openYoutubeSource(item.url);}});actions.append(link);}
      li.append(actions);
    }
    return li;
  }
  function render(snapshot) {
    if(!snapshot||!Array.isArray(snapshot.items)||snapshot.revision<current.revision)return;
    current=snapshot;
    get('requestCount').textContent=String(snapshot.count);
    get('requestCount').hidden=!snapshot.count;
    const active=snapshot.items.filter(item=>['pending','accepted'].includes(item.status)).sort((a,b)=>Number(b.status==='accepted')-Number(a.status==='accepted')||(a.status==='accepted'?a.updatedAt-b.updatedAt:a.createdAt-b.createdAt));
    const history=snapshot.items.filter(item=>!['pending','accepted'].includes(item.status)).sort((a,b)=>b.updatedAt-a.updatedAt);
    get('requestsList').replaceChildren(...active.map(itemNode));
    get('requestsEmpty').hidden=active.length>0;
    get('requestsHistoryList').replaceChildren(...history.map(itemNode));
    get('requestsHistory').hidden=!history.length;
  }
  window.renderSongRequests=render;
  get('openRequestsModal').addEventListener('click',async()=>{
    try{render(await responseData(await fetch('/api/requests',{cache:'no-store'})));}
    catch(err){get('requestsStatus').textContent='Liste indisponible. '+err.message;}
  });
  const form=get('requestForm');
  if(form){
    const prefs=globalThis.LocalSoundPrefs;
    get('requestName').value=prefs?.read('requestName','') || '';
    form.addEventListener('submit',async event=>{
      event.preventDefault();get('sendRequest').disabled=true;get('requestsStatus').textContent='Envoi à l’hôte…';
      try{
        const name=get('requestName').value.trim();
        const data=await responseData(await fetch('/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,title:get('requestTitle').value.trim(),url:get('requestUrl').value.trim()})}));
        prefs?.write('requestName',name);render(data);
        get('requestTitle').value='';get('requestUrl').value='';get('requestsStatus').textContent='Proposition envoyée ! L’hôte choisit la suite.';
      }catch(err){get('requestsStatus').textContent=err.message;}
      finally{get('sendRequest').disabled=false;}
    });
  }
})();
