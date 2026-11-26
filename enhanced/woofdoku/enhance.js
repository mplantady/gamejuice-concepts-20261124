/* Presentation only. Every board transition and outcome comes from original Luna. */
(() => {
'use strict';
const bridge=window.WoofdokuBridge;
const art=document.createElement('canvas');art.id='woof-art';document.body.append(art);
const ctx=art.getContext('2d',{willReadFrequently:true}),imgs={},events=[],history=[],loaded=[],assetErrors=[];
let ready=false,snapshot=null,last=performance.now(),ambient=0,revision=-1,frame=0;
let gentle=matchMedia('(prefers-reduced-motion: reduce)').matches;
try{gentle=localStorage.getItem('woofdoku-gentle')==='true'||gentle}catch{}
window.WoofNativeMotion?.setGentle(gentle);
let muted=false,lastMajor=-10000,hostReaction=null;
const poses=['rest','anticipate','delight','content','concern','blink'];
const statuses=new Map(),dogReactions=new Map();
const key=(x,y)=>x+','+y;
const assets=[...poses.map(p=>[p,'assets/dog-'+p+'.png']),['background','assets/blue-wash.jpg'],['footer','assets/toy-footer.png']];
const assetReady=Promise.all(assets.map(([name,path])=>new Promise(resolve=>{const im=new Image();im.onload=()=>{imgs[name]=im;loaded.push(name);resolve()};im.onerror=()=>{assetErrors.push(path);resolve()};im.src=path})));
const preferences=document.createElement('nav');preferences.id='woof-preferences';preferences.setAttribute('aria-label','Playback preferences');
const sound=document.createElement('button'),motion=document.createElement('button');
function labels(){sound.textContent=muted?'Sound off':'Sound on';sound.setAttribute('aria-pressed',String(!muted));motion.textContent=gentle?'Gentle motion':'Full motion';motion.setAttribute('aria-pressed',String(gentle))}
sound.onclick=()=>{muted=!muted;window.WoofAudio?.setMuted(muted);window.dispatchEvent(new Event(muted?'luna:unsafe:mute':'luna:unsafe:unmute'));labels()};
motion.onclick=()=>{gentle=!gentle;window.WoofNativeMotion?.setGentle(gentle);try{localStorage.setItem('woofdoku-gentle',String(gentle))}catch{}labels()};
preferences.append(sound,motion);document.body.append(preferences);labels();
// Preferences cannot leak pointer inputs through to original Unity event handling.
for(const type of ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup'])preferences.addEventListener(type,e=>e.stopPropagation());
function event(type,data={}){
 const now=performance.now(),e={type,at:now,...data};events.push(e);history.push(e);if(history.length>300)history.shift();
 if(type==='place'){dogReactions.set(key(data.x,data.y),e);if(now-lastMajor>900)hostReaction=e}
 if(type==='invalid'){hostReaction=e;lastMajor=now}
 if(type==='complete'||type==='failed'){hostReaction=e;lastMajor=now;for(const k of dogReactions.keys())dogReactions.set(k,e)}
 if(type!=='place')window.WoofAudio?.event(type==='failed'?'fail':type);
}
bridge.on(e=>{
 if(e.type==='ready'||e.type==='state')return;
 if(e.type==='load'||e.type==='reset'){events.length=0;dogReactions.clear();statuses.clear();hostReaction=null;return}
 // State diff emits cell cues once, after original models and visuals are updated.
 if(e.type==='complete'||e.type==='failed')event(e.type);
});
function syncState(s){
 for(const c of s.cells){const k=key(c.x,c.y),old=statuses.get(k);if(old!==undefined&&old!==c.status){
  if(c.selected)event('place',{x:c.x,y:c.y});
  else if(c.error)event('invalid',{x:c.x,y:c.y});
  else event(c.excluded?'mark':'unmark',{x:c.x,y:c.y});
 }statuses.set(k,c.status)}
}
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function poseFor(now,reaction,id=0){
 if(gentle)return reaction&&now-reaction.at<750?(reaction.type==='invalid'||reaction.type==='failed'?'concern':'delight'):'rest';
 if(reaction){const t=now-reaction.at;
  if(reaction.type==='invalid'||reaction.type==='failed'){if(t<1100)return'concern';if(t<1280)return'blink'}
  if(reaction.type==='place'||reaction.type==='complete'){
   if(t<120)return'anticipate';if(t<650)return'delight';if(t<870)return'content';if(t<1040)return'delight';if(t<1200)return'content';
  }
 }
 const phase=(ambient+id*1.713)%(5.7+id*.31);return phase>.9&&phase<1.04?'blink':phase>1.18&&phase<1.26?'blink':'rest';
}
function drawDog(rect,pose,now,reaction,scale=1){
 if(!rect||!imgs[pose])return;let r=rect.width*.5*scale,cx=rect.x,cy=rect.y;
 // Fixed chin registration while ears, eyes and muzzle articulate through authored poses.
 const t=reaction?now-reaction.at:1e5;
 const tilt=gentle?0:t<700&&reaction?.type==='place'?Math.sin(t/700*Math.PI*2)*.06:0;
 ctx.save();ctx.translate(cx,cy+r*.8);ctx.rotate(tilt);ctx.drawImage(imgs[pose],-r,-r*1.8,r*2,r*2);ctx.restore();
}
function effect(e,s,now){
 if(e.type==='place'&&e.revealAt===undefined)return;let age=(now-(e.revealAt??e.at))/1000;if(age>1.4)return;const c=s.cells.find(c=>c.x===e.x&&c.y===e.y),r=c?.rect||bridge.cellRect(e.x,e.y);if(!r)return;
 const p=Math.min(1,age/.6),fade=(1-p);
 if(e.type==='place'){
  ctx.save();ctx.strokeStyle='#fff6d5';ctx.globalAlpha=gentle?fade*.5:fade;ctx.lineWidth=2.5;rr(r.left-2,r.top-2,r.width+4,r.height+4,8);ctx.stroke();
  if(!gentle){for(let i=0;i<5;i++){let a=i*Math.PI*2/5-.7,dist=r.width*(.25+p*.48),x=r.x+Math.cos(a)*dist,y=r.y+Math.sin(a)*dist;ctx.globalAlpha=fade*.85;ctx.fillStyle=i%2?'#fff7d4':'#fff';ctx.beginPath();ctx.ellipse(x,y,2+fade*2,1+fade*1.5,a,0,Math.PI*2);ctx.fill()}}
  ctx.restore();
 }else if(e.type==='invalid'){
  ctx.save();ctx.globalAlpha=Math.max(0,1-age);ctx.strokeStyle='#923c49';ctx.lineWidth=3;rr(r.left+1,r.top+1,r.width-2,r.height-2,6);ctx.stroke();ctx.restore();
 }else if(e.type==='mark'||e.type==='unmark'){
  ctx.save();ctx.globalAlpha=fade*.5;ctx.strokeStyle='#fff';ctx.lineWidth=1.5;rr(r.left+3,r.top+3,r.width-6,r.height-6,5);ctx.stroke();ctx.restore();
 }
}
function draw(now){
 const dt=Math.min(.05,(now-last)/1000);last=now;if(!gentle&&!document.hidden)ambient+=dt;
 const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,2);if(art.width!==Math.round(w*dpr)||art.height!==Math.round(h*dpr)){art.width=Math.round(w*dpr);art.height=Math.round(h*dpr)}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 if(ready&&assetErrors.length===0){
  const s=bridge.snapshot({activeOnly:true});if(s){snapshot=s;syncState(s);if(assetErrors.length===0){if(s.resultVisible)window.WoofNativeVisuals?.restore();else window.WoofNativeVisuals?.hideDogs();}
   if(!s.resultVisible){
    // Native support surfaces preserve the original transforms and all sharp gameplay UI.
    for(const c of s.cells){if(!c.selected||!c.rect||!c.dogRenderable)continue;
     const r=c.rect,reaction=dogReactions.get(key(c.x,c.y));
     if(reaction?.type==='place'&&reaction.revealAt===undefined){reaction.revealAt=now;window.WoofAudio?.event('place');}
     const performanceReaction=reaction?.revealAt?{...reaction,at:reaction.revealAt}:reaction;
     // Native dog alpha is presentation-hidden; original cell and reveal timing remain untouched.

     drawDog(c.dogRect||r,poseFor(now,performanceReaction,c.y*6+c.x+1),now,performanceReaction,1.02);
    }
    const r=s.hudDogRect;if(r){drawDog(r,poseFor(now,hostReaction,0),now,hostReaction,1.08)}
    for(const e of events)effect(e,s,now);
   } else if(s.resultIconRect && s.resultInfoRect){
    // Continue the existing HUD mascot reaction in the result panel's unused gap.
    const top=s.resultIconRect.bottom+4,bottom=s.resultInfoRect.top-6;
    const size=Math.min(76,bottom-top);
    if(size>24){const r={x:s.resultIconRect.x,y:top+size*.5,width:size,height:size};
      const success=s.completed;const settled=!hostReaction||now-hostReaction.at>1400;const pose=(gentle||settled)?(success?'content':'concern'):poseFor(now,hostReaction,0);
      drawDog(r,pose,now,hostReaction,1);
    }
   }
  }
 }
 while(events.length&&now-(events[0].revealAt??events[0].at)>2400)events.shift();frame++;requestAnimationFrame(draw);
}
Promise.all([bridge.ready,assetReady]).then(()=>{
 if(assetErrors.length===0&&!window.WoofNativeSurfaces?.apply({background:imgs.background,footer:imgs.footer}))assetErrors.push('Native surface import: '+window.WoofNativeSurfaces?.diagnostics().error);
 ready=true;const s=bridge.snapshot();if(s)syncState(s);
});
window.WoofPolish={version:'woofdoku-living-pups-1.1.0',get ready(){return ready},get canvas(){return art},setGentle(value){gentle=!!value;window.WoofNativeMotion?.setGentle(gentle);labels()},diagnostics:()=>({ready,loaded,assetErrors,gentle,muted,ambient,frames:frame,events:history,sourceSnapshot:snapshot,surfaces:window.WoofNativeSurfaces?.diagnostics(),nativeMotion:window.WoofNativeMotion?.diagnostics(),poses:poseFor(performance.now(),hostReaction)})};
requestAnimationFrame(draw);
})();
