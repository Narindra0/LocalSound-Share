'use strict';
(() => {
  const get=id=>document.getElementById(id);
  const themes={vinyl:'Vinyle',cassette:'K7',cd:'CD',reel:'Bandes',mp3:'MP3',radio:'Radio'};
  const palettes={terracotta:'Terre cuite',forest:'Forêt',ocean:'Bleu nuit',plum:'Prune'};
  const host=document.body.classList.contains('host-page');
  let room={theme:'vinyl',palette:'terracotta'},dirty=false;
  const prefs=globalThis.LocalSoundPrefs;
  let personal=prefs?.read('personalTheme','room') || 'room';
  let personalPalette=prefs?.read('personalPalette','room') || 'room';
  if(personal!=='room'&&!themes[personal])personal='room';
  if(personalPalette!=='room'&&!palettes[personalPalette])personalPalette='room';
  function apply(){
    const theme=host||personal==='room'?room.theme:personal;
    const palette=host||personalPalette==='room'?room.palette:personalPalette;
    document.body.dataset.theme=theme;document.body.dataset.palette=palette;
    const caption=document.querySelector('.deck-caption >span');if(caption)caption.textContent={vinyl:'FACE A — LE DIRECT',cassette:'FACE A — LA MIXTAPE',cd:'PISTE 01 — LE DIRECT',reel:'BANDE A — LE STUDIO',mp3:'PLAYLIST — LE DIRECT',radio:'SUR LES ONDES LOCALES'}[theme];
    const playingLabel=document.querySelector('.now-playing .overline');if(playingLabel)playingLabel.textContent={vinyl:'SUR LA PLATINE',cassette:'SUR LA K7',cd:'SUR LE CD',reel:'SUR LES BANDES',mp3:'DANS LE LECTEUR',radio:'À L’ANTENNE'}[theme];
    const edition={vinyl:'001',cassette:'002',cd:'003',reel:'004',mp3:'005',radio:'006'}[theme];
    const corner=document.querySelector('.deck-corner');if(corner)corner.textContent='LS / '+edition;
    for(const element of document.querySelectorAll('[data-deck-edition]'))element.textContent='№ '+edition+' · '+{vinyl:'VINYL',cassette:'TAPE',cd:'DIGITAL',reel:'STUDIO',mp3:'POCKET',radio:'RADIO'}[theme];
    const personalStatus=get('personalThemeStatus');if(personalStatus)personalStatus.textContent=personal==='room'?'Vous suivez l’ambiance du salon : '+themes[room.theme]+'.':'Votre écran utilise le lecteur '+themes[theme]+'.';
    for(const input of document.querySelectorAll('input[name="personalThemeChoice"]'))input.checked=input.value===personal;
    for(const input of document.querySelectorAll('input[name="personalPaletteChoice"]'))input.checked=input.value===personalPalette;
    if(get('personalTheme'))get('personalTheme').value=personal;
    if(get('personalPreviewLabel'))get('personalPreviewLabel').textContent=themes[theme]+' · '+palettes[palette];
    if(get('personalStyleStatus'))get('personalStyleStatus').textContent=personal==='room'&&personalPalette==='room'?'Vous suivez l’ambiance choisie par l’hôte.':'Votre style est mémorisé uniquement sur cet appareil.';
  }
  window.updateAppearance=value=>{
    if(value&&themes[value.theme]&&palettes[value.palette])room={theme:value.theme,palette:value.palette};
    apply();
    if(host&&!dirty){
      const theme=get('appearanceForm')?.querySelector('input[name="sessionTheme"][value="'+room.theme+'"]');if(theme)theme.checked=true;
      const palette=get('appearanceForm')?.querySelector('input[name="sessionPalette"][value="'+room.palette+'"]');if(palette)palette.checked=true;
      updatePreview();
    }
  };
  window.updateThemeTrack=metadata=>{
    for(const element of document.querySelectorAll('.theme-track-title'))element.textContent=metadata?.title || 'Le son du moment.';
  };
  function updatePreview(){
    const form=get('appearanceForm');if(!form)return;
    const theme=form.querySelector('input[name="sessionTheme"]:checked')?.value || room.theme;
    const palette=form.querySelector('input[name="sessionPalette"]:checked')?.value || room.palette;
    form.dataset.previewPalette=palette;
    get('appearancePreviewLabel').textContent=themes[theme]+' · '+palettes[palette];
  }
  get('appearanceForm')?.addEventListener('change',()=>{dirty=true;updatePreview();get('appearanceResult').textContent='Aperçu choisi. Appliquez-le pour personnaliser le salon.';});
  get('appearanceForm')?.addEventListener('submit',async event=>{
    event.preventDefault();get('saveAppearance').disabled=true;
    try{
      const response=await fetch('/api/appearance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:event.target.querySelector('input[name="sessionTheme"]:checked').value,palette:event.target.querySelector('input[name="sessionPalette"]:checked').value})});
      const data=await response.json();if(!response.ok)throw new Error(data.error || 'Ambiance non enregistrée.');
      dirty=false;window.updateAppearance(data.appearance);get('appearanceResult').textContent='Ambiance appliquée au salon et mémorisée.';
    }catch(err){get('appearanceResult').textContent=err.message;}
    finally{get('saveAppearance').disabled=false;}
  });
  if(get('personalTheme')){
    get('personalTheme').value=personal;
    get('personalTheme').addEventListener('change',event=>{personal=event.target.value;prefs?.write('personalTheme',personal);apply();});
  }
  for(const input of document.querySelectorAll('input[name="personalThemeChoice"]'))input.addEventListener('change',event=>{
    personal=event.target.value;prefs?.write('personalTheme',personal);apply();
  });
  for(const input of document.querySelectorAll('input[name="personalPaletteChoice"]'))input.addEventListener('change',event=>{
    personalPalette=event.target.value;prefs?.write('personalPalette',personalPalette);apply();
  });
  get('resetPersonalAppearance')?.addEventListener('click',()=>{
    personal='room';personalPalette='room';prefs?.write('personalTheme',personal);prefs?.write('personalPalette',personalPalette);apply();
  });
  window.updateAppearance(room);
})();
