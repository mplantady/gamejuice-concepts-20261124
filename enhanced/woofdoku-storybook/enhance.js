/* Storybook presentation. Native Luna owns every rule, input, clock and outcome. */
(() => {
'use strict';
const bridge=window.WoofdokuBridge,feedback=window.WoofFeedback,art=document.createElement('canvas');art.id='woof-art';document.body.append(art);
const ctx=art.getContext('2d',{willReadFrequently:true}),imgs={},events=[],history=[],loaded=[],assetErrors=[];
let ready=false,snapshot=null,last=performance.now(),ambient=0,frame=0,resultWasVisible=false,lastResultPose=null,lastLives=null;
let gentle=matchMedia('(prefers-reduced-motion: reduce)').matches;
try{gentle=localStorage.getItem('woofdoku-gentle')==='true'||gentle}catch{}
window.WoofNativeMotion?.setGentle(gentle);
let muted=window.WoofAudio?.diagnostics().muted||false,lastMajor=-10000,hostReaction=null,resultReaction=null;
const poses=['rest','anticipate','delight','content','concern','blink','wave','settle'];
const statuses=new Map(),dogReactions=new Map(),key=(x,y)=>x+','+y;
const assets=[...poses.map(p=>[p,'assets/dog-'+p+'.png']),['background','assets/blue-cloth.jpg'],['footer','assets/toy-footer.png'],['resultBadge','assets/result-badge-base.png']];
const assetReady=Promise.all(assets.map(([name,path])=>new Promise(resolve=>{const im=new Image();im.onload=()=>{imgs[name]=im;loaded.push(name);resolve()};im.onerror=()=>{assetErrors.push(path);resolve()};im.src=path})));
const preferences=document.createElement('nav');preferences.id='woof-preferences';preferences.setAttribute('aria-label','Playback preferences');
const sound=document.createElement('button'),motion=document.createElement('button');
function labels(){sound.textContent=muted?'Sound off':'Sound on';sound.setAttribute('aria-pressed',String(!muted));motion.textContent=gentle?'Gentle motion':'Full motion';motion.setAttribute('aria-pressed',String(gentle))}
sound.onclick=()=>{muted=!muted;window.WoofAudio?.setMuted(muted);labels()};
motion.onclick=()=>setGentle(!gentle,true);
preferences.append(sound,motion);document.body.append(preferences);labels();
for(const type of ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup'])preferences.addEventListener(type,e=>e.stopPropagation());
function setGentle(value,persist=false){
 const next=!!value;
 if(next!==gentle){gentle=next;feedback?.reset(next);dogReactions.clear();hostReaction=null;if(resultReaction)resultReaction={...resultReaction,quiet:true};}
 window.WoofNativeMotion?.setGentle(gentle);
 if(persist)try{localStorage.setItem('woofdoku-gentle',String(gentle))}catch{}
 labels();
}
function event(type,data={}){
 const now=performance.now(),e={type,at:now,...data};events.push(e);history.push(e);if(history.length>300)history.shift();
 if(Number.isInteger(data.x)&&Number.isInteger(data.y))feedback?.cell(type,{...data,at:now});
 if(type==='place')dogReactions.set(key(data.x,data.y),e);
 if(type==='invalid'){hostReaction=e;lastMajor=now}
 if(type==='complete'||type==='failed'){hostReaction=e;lastMajor=now}
}
bridge.on(e=>{
 if(e.type==='load'||e.type==='reset'){events.length=0;dogReactions.clear();statuses.clear();feedback?.reset();lastLives=null;lastMajor=-10000;hostReaction=null;resultReaction=null;resultWasVisible=false;lastResultPose=null;return}
 if(e.type==='complete'||e.type==='failed')event(e.type);
});
function syncState(s){
 let observedLives=lastLives;
 for(const c of s.cells){const k=key(c.x,c.y),old=statuses.get(k);if(old!==undefined&&old!==c.status){
  if(c.selected)event('place',{x:c.x,y:c.y});
  else if(c.error){const before=observedLives??(s.lives+1),after=Math.max(s.lives,before-1);event('invalid',{x:c.x,y:c.y,livesBefore:before,livesAfter:after});observedLives=after;}
  else event(c.excluded?'mark':'unmark',{x:c.x,y:c.y});
 }statuses.set(k,c.status)}
 lastLives=s.lives;
}
function poseFor(now,reaction,id=0){
 const t=reaction?now-reaction.at:1e9;
 if(gentle)return reaction&&t<750?(reaction.type==='invalid'||reaction.type==='failed'?'concern':'content'):'rest';
 if(reaction){
  if(reaction.type==='invalid'||reaction.type==='failed'){if(t<1100)return'concern';if(t<1280)return'blink';if(t<1500)return'settle'}
  if(reaction.type==='complete'){if(t<120)return'anticipate';if(t<360)return'delight';if(t<880)return'wave';if(t<1160)return'settle';if(t<1800)return'content';}
  if(reaction.type==='place'){if(t<120)return'anticipate';if(t<530)return'delight';if(t<810)return'content';if(t<1070)return'settle';}
 }
 const period=5.9+(id%7)*.47,phase=(ambient+id*1.713)%period;
 return phase>.9&&phase<1.03?'blink':phase>1.18&&phase<1.26?'blink':phase>3.7&&phase<4.05&&id%3===1?'settle':'rest';
}
function drawDog(rect,pose,visibleHeight,base,pressure=1){
 if(!rect||!imgs[pose])return;
 const size=visibleHeight*512/394,cx=rect.x,contact=base??(rect.bottom-2);
 // The same authored paw registration is used in every pose; no whole-sprite
 // rotation/translation or native pop scale is applied to the new performance.
 ctx.save();ctx.fillStyle='#423627';ctx.globalAlpha=.18+(pressure-1)*.18;ctx.beginPath();ctx.ellipse(cx,contact+.2,size*.175*pressure,size*.025,0,0,Math.PI*2);ctx.fill();ctx.restore();
 ctx.drawImage(imgs[pose],cx-size*.5,contact-size*460/512,size,size);
}
function draw(now){
 const dt=Math.min(.05,(now-last)/1000);last=now;if(!gentle&&!document.hidden)ambient+=dt;
 const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,2);if(art.width!==Math.round(w*dpr)||art.height!==Math.round(h*dpr)){art.width=Math.round(w*dpr);art.height=Math.round(h*dpr)}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 if(ready&&assetErrors.length===0){
  const s=bridge.snapshot({activeOnly:true});if(s){snapshot=s;syncState(s);
   if(s.resultVisible)window.WoofNativeVisuals?.restore();else window.WoofNativeVisuals?.hideDogs();
   if(!s.resultVisible){
    lastResultPose=null;
    window.WoofEnvironment?.draw(ctx,bridge.uiRect('BackgroundLayer/BottomDecoration'),ambient,gentle);
    for(const c of s.cells){if(!c.selected||!c.rect||!c.dogRenderable)continue;
     const r=c.rect,reaction=dogReactions.get(key(c.x,c.y));
     if(reaction?.type==='place'&&reaction.revealAt===undefined){reaction.revealAt=now;feedback?.reveal(c.x,c.y,now);if(now-lastMajor>900)hostReaction={...reaction,at:now};}
     const performanceReaction=reaction?.revealAt?{...reaction,at:reaction.revealAt}:reaction;
     const base=c.dogBaseRect||r;
     const age=performanceReaction?now-performanceReaction.at:1e9,pressure=gentle||age>320?1:1+.28*Math.sin(Math.PI*Math.max(0,age)/320);
     drawDog(base,poseFor(now,performanceReaction,c.y*6+c.x+1),base.height*394/512*1.15,base.top+base.height*460/512,pressure);
    }
    const r=s.hudDogRect;if(r)drawDog(r,poseFor(now,hostReaction,0),r.height*394/512*1.15,r.top+r.height*460/512);
    feedback?.draw(ctx,s,now,gentle);
   }else{
    if(!resultWasVisible||!resultReaction){resultReaction={type:s.completed?'complete':'failed',at:now};feedback?.result(s.completed?'success':'failed',now);history.push({type:'result-art-reveal',at:now,result:s.result});}
    const r=s.resultIconRect,settled=now-resultReaction.at>1800;
    const pose=(gentle||settled||resultReaction.quiet)?(s.completed?'content':'concern'):poseFor(now,resultReaction,0);
    lastResultPose=r?pose:null;
    if(r)drawDog(r,pose,r.height*.60,r.top+r.height*.76);
    feedback?.draw(ctx,s,now,gentle);
   }
   resultWasVisible=s.resultVisible;
  }
 }
 while(events.length&&now-(events[0].revealAt??events[0].at)>2400)events.shift();frame++;requestAnimationFrame(draw);
}
Promise.all([bridge.ready,assetReady,window.WoofEnvironment?.load('assets/')]).then(()=>{
 if(window.WoofEnvironment?.diagnostics().errors.length)assetErrors.push(...window.WoofEnvironment.diagnostics().errors);
 if(assetErrors.length===0&&!window.WoofNativeSurfaces?.apply({background:imgs.background,footer:imgs.footer,resultBadge:imgs.resultBadge}))assetErrors.push('Native surface import: '+window.WoofNativeSurfaces?.diagnostics().error);
 ready=true;const s=bridge.snapshot();if(s){syncState(s);if(s.resultVisible){resultWasVisible=true;resultReaction={type:s.completed?'complete':'failed',at:performance.now(),quiet:true};}}
});
window.WoofPolish={version:'woofdoku-storybook-2.1.2',get ready(){return ready},get canvas(){return art},setGentle(value){setGentle(value)},diagnostics:()=>({ready,loaded,assetErrors,gentle,muted,ambient,frames:frame,events:history,sourceSnapshot:snapshot,surfaces:window.WoofNativeSurfaces?.diagnostics(),nativeMotion:window.WoofNativeMotion?.diagnostics(),combo:window.WoofNativeCombo?.diagnostics(),environment:window.WoofEnvironment?.diagnostics(),feedback:feedback?.diagnostics(),poses:poseFor(performance.now(),hostReaction),resultPose:lastResultPose})};
addEventListener('visibilitychange',()=>{if(document.hidden)feedback?.reset()});
requestAnimationFrame(draw);
})();
