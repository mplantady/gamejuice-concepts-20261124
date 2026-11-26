/* Preference controller only. Playback remains in the original mixer. */
(() => {
 'use strict';let muted=false,platformMuted=false,manager=null,earlyMuteApplied=false,earlyMuteError='',managerError='';
 try{muted=localStorage.getItem('woofdoku-sound-muted')==='true'}catch{}
 // Capture listener runs before the source's luna:build startup listener. The
 // resource gate has evaluated App by then, but Board.OnEnable has not played
 // game_start. Apply the existing native preference immediately after its
 // singleton initializes, preserving the original call and return value.
 addEventListener('luna:build',()=>{
  if(!muted)return;
  try{
   const proto=App.AudioManager.prototype,original=proto.OnSingletonAwake;
   if(typeof original!=='function')throw new Error('Native audio initialization hook unavailable');
   const own=Object.getOwnPropertyDescriptor(proto,'OnSingletonAwake');
   proto.OnSingletonAwake=function(...args){
    const value=original.apply(this,args);this.SetMuted(true);earlyMuteApplied=true;
    if(own)Object.defineProperty(proto,'OnSingletonAwake',own);else delete proto.OnSingletonAwake;
    return value;
   };
  }catch(error){earlyMuteError=String(error.message||error)}
 },{capture:true,once:true});
 function resolveManager(){
  try{
   if(!window.App?.AudioManager||!window.UnityEngine)return null;
   const singleton=App.MonoSingleton$1(App.AudioManager);
   // Instance is only read behind HasInstance, never used to create a manager.
   const live=singleton.HasInstance?singleton.Instance:null;
   if(live?.gameObject?.activeInHierarchy&&typeof live.SetMuted==='function')manager=live;
   else{
    const candidates=Array.from(UnityEngine.Resources.FindObjectsOfTypeAll(App.AudioManager)||[])
      .map(value=>Bridge.rValue(value)).filter(value=>value?.gameObject?.activeInHierarchy&&typeof value.SetMuted==='function');
    manager=candidates.length===1?candidates[0]:null;
   }
   managerError='';return manager;
  }catch(error){managerError=String(error.message||error);return null}
 }
 function apply(){const live=resolveManager();if(live)live.SetMuted(muted)}
 function setMuted(value){muted=!!value;try{localStorage.setItem('woofdoku-sound-muted',String(muted))}catch{}apply();return muted}
 window.WoofdokuBridge.ready.then(apply);
 for(const n of ['luna:mute','luna:unsafe:mute'])addEventListener(n,()=>{platformMuted=true});
 for(const n of ['luna:unmute','luna:unsafe:unmute'])addEventListener(n,()=>{platformMuted=false;apply()});
 window.WoofAudio={version:'storybook-native-samples-1',setMuted,event:()=>false,getRecordingNode:()=>null,diagnostics:()=>({muted,platformMuted,nativeMuted:resolveManager()?.IsMuted??null,nativeManagerResolved:!!manager,nativeManagerName:manager?.gameObject?.name||'',managerError,earlyMuteApplied,earlyMuteError,resources:window.WoofNativeAudioResources?.diagnostics?.(),playback:'original native mixer only'})};
})();
