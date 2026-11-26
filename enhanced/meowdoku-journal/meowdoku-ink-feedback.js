/* Paper-and-ink responses. Presentation only: native cells, clocks and results own meaning. */
(() => {
  const A=window.MeowdokuNative;
  const state={active:0,peak:0,created:0,disposed:0,roots:0,emitted:0,suppressed:0,errors:[],events:[]};
  let root=null,low=false,serial=0,lastFly=null,flyGeneration=null;
  const cells=new Map(),owned=[];let count=null,fish=null,result=null,fly=null;
  const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x);};
  const durations={focus:.18,mark:.32,unmark:.28,remove:.42,place:.74,error:.76,progress:.88,loss:.62,result:1.55};
  const strong=new Set(['place','error','remove']);
  const F=window.MeowdokuInk={ready:Promise.resolve(),attach,emit,progress:()=>start(count,'progress'),loss,showResult,tick,reset,diagnostics};
  function report(error){const m=error?.message||String(error);if(!state.errors.includes(m))state.errors.push(m);}
  function guard(fn){try{return fn();}catch(e){report(e);return null;}}
  function make(parent,name,width,height,{stretch=false,before=null,canvas=[256,256],cell=null}={}){
    const n=new A.node({n:name,a:0,rt:stretch?[.5,.5,0,0,1,1,0,0,0,0,0,1,1]:[.5,.5,.5,.5,.5,.5,width,height,0,0,0,1,1],img:{s:null,t:0,fm:4,fa:1,fo:0,ppu:1,rc:0,c:[1,1,1,1],en:1}},parent);
    const index=before?parent.children.indexOf(before):-1;
    if(index>=0)parent.children.splice(index,0,n);else parent.children.push(n);
    const image=document.createElement('canvas');image.width=canvas[0];image.height=canvas[1];
    const ctx=image.getContext('2d'),mesh=n.img.ensureMesh(),material=mesh.material.clone(),texture=A.texture(image);
    material.map=texture;material.needsUpdate=true;const original=n.img.ensureMesh.bind(n.img);
    n.img.ensureMesh=()=>{const m=original();m.material=material;return m;};
    const item={node:n,parent,cell,image,ctx,material,texture,kind:'',at:-100,duration:0,active:false,layer:cell?'cell':'support',id:++serial};
    owned.push(item);state.created++;return item;
  }
  function reset(){
    for(const f of owned){guard(()=>{f.node.SetActive(false);f.texture.dispose?.();f.material.dispose?.();f.image.width=f.image.height=1;});state.disposed++;}
    owned.length=0;cells.clear();root=null;count=fish=result=fly=null;lastFly=null;flyGeneration=null;state.active=0;state.events.length=0;
  }
  function attach(){return guard(()=>{
    if(!A.Q.root||root===A.Q.root)return;reset();root=A.Q.root;state.roots++;
    for(const cell of A.Q.grid._cells.values())cells.set(cell,make(cell.node,'MeowdokuCellInk',160,160,{cell,before:cell.catImage.node}));
    const ui=A.Q.ui,cp=ui.catCountAnim.parent,hp=ui.heartImgs[0].parent;
    count=make(cp,'MeowdokuCounterInk',0,0,{stretch:true,before:cp.children[0],canvas:[512,128]});
    fish=make(hp,'MeowdokuFishInk',0,0,{stretch:true,before:hp.children[0],canvas:[512,128]});
    const actor=A.Q.byCid.get(420282);
    result=make(actor,'MeowdokuResultInk',432,768,{canvas:[432,768]});
    fly=make(ui.catFly,'MeowdokuFlightInk',240,240);
    A.layout();A.dirty();
  });}
  function clear(f){if(!f||!f.active)return;f.active=false;f.kind='';f.node.SetActive(false);f.ctx.clearRect(0,0,f.image.width,f.image.height);f.texture.needsUpdate=true;A.dirty();}
  function failVisible(){return !!A.Q.ui?.failPanel?.activeInHierarchy;}
  function start(f,kind,extra={}){return guard(()=>{
    if(!f)return false;
    if(f!==result&&failVisible()){state.suppressed++;return false;}
    if(kind==='focus'&&f.active&&strong.has(f.kind)&&A.Cl.time-f.at<f.duration){state.suppressed++;return false;}
    if(f.cell&&!f.active){const active=[...cells.values()].filter(x=>x.active);if(active.length>=12)clear(active.sort((a,b)=>a.at-b.at)[0]);}
    Object.assign(f,extra,{kind,at:A.Cl.time,duration:low?Math.min(.25,durations[kind]):durations[kind],active:true});
    f.node.SetActive(true);if(f.cell){const siblings=f.parent.children;const i=siblings.indexOf(f.node);if(i>=0)siblings.splice(i,1);const at=kind==='place'?siblings.indexOf(f.cell.catImage.node):-1;at>=0?siblings.splice(at,0,f.node):siblings.push(f.node);}state.emitted++;state.events.push({kind,at:f.at,row:f.cell?.Row,col:f.cell?.Col});if(state.events.length>120)state.events.shift();
    return true;
  });}
  function emit(cell,kind,options={}){if(options.automatic&&['mark','unmark'].includes(kind)){state.suppressed++;return false;}return start(cells.get(cell),kind);}
  function loss(remaining){return start(fish,'loss',{index:remaining});}
  function showResult(){return guard(()=>{for(const f of owned)if(f!==result)clear(f);lastFly=null;return start(result,'result');});}
  function stroke(c,points,width,ink,alpha=1){
    c.save();c.globalAlpha*=alpha;c.lineCap='round';c.lineJoin='round';c.strokeStyle=ink;c.lineWidth=width;c.beginPath();
    c.moveTo(...points[0]);for(let i=1;i<points.length;i++){const p=points[i];p.length===4?c.quadraticCurveTo(...p):c.lineTo(...p);}c.stroke();c.restore();
  }
  function inkStroke(c,points,width,ink,alpha=1){stroke(c,points,width+5,'#fff6de',alpha*.86);stroke(c,points,width,ink,alpha);}
  function bez(c,x,y,w,h,ink,alpha){c.save();c.globalAlpha*=alpha;c.fillStyle=ink;c.beginPath();c.ellipse(x,y,w,h,0,0,Math.PI*2);c.fill();c.restore();}
  function cellPaint(f,t){
    const c=f.ctx,p=clamp(t/f.duration),decay=1-ease((p-.32)/.68),ink='#70482d',cream='#fff5d9';
    if(f.kind==='place'){
      // Native appear2 reaches its first full silhouette at ~133ms. Ink contact peaks there.
      const hit=low?1:ease(t/.133),release=low?0:ease((t-.15)/.4),a=(low?1:hit)*decay;
      bez(c,128,208,54+release*25,10-release*4,ink,a*.23);
      for(const side of [-1,1]){
        const x=128+side*(80+release*18);
        inkStroke(c,[[x-side*14,216],[x+side*11,199,x+side*2,173]],8*(1-release)+3,ink,a);
        inkStroke(c,[[128+side*91,81],[128+side*(102+release*5),64,128+side*99,47]],5,'#bf8436',a*.85);
      }
      stroke(c,[[79,222],[128,233,177,222]],7,cream,a*.9);
    }else if(f.kind==='error'){
      const peak=low?1:ease(t/.14),a=peak*decay,tear=low?1:ease((t-.18)/.22);
      // The original heart and retained X stay unobstructed in the center.
      for(const side of [-1,1]){
        const x=128+side*(91+tear*5);
        inkStroke(c,[[x-side*16,33],[x,28,x+side*2,49],[x-side*2,80]],7,'#b9483b',a);
        inkStroke(c,[[x,177],[x+side*3,213,x-side*19,222]],7,'#b9483b',a);
      }
      stroke(c,[[82,228],[102,233,119,229]],5,cream,a);stroke(c,[[137,229],[156,234,176,228]],5,cream,a);
    }else if(f.kind==='mark'){
      const q=low?1:ease(t/.13),r=low?1:ease((t-.09)/.14),a=1-ease((p-.52)/.48);
      // Two finite brush strokes track the existing X rather than adding confetti.
      inkStroke(c,[[66,61],[66+129*q,61+129*q]],5,'#986539',a);
      inkStroke(c,[[191,63],[191-127*r,63+127*r]],5,'#986539',a);
      if(!low){stroke(c,[[195,195],[208,201,217,193]],4,'#fff9e9',a*r);}
    }else if(f.kind==='unmark'||f.kind==='remove'){
      const a=1-p,shift=low?0:ease(p)*18;
      for(const side of [-1,1])inkStroke(c,[[128+side*(47+shift),192],[128+side*(77+shift),189,128+side*(84+shift),169]],5,'#7f715a',a);
      if(f.kind==='remove')stroke(c,[[103,210],[128,216,153,210]],5,cream,a);
    }else{
      const a=(1-p)*.85;
      for(const sx of [-1,1])for(const sy of [-1,1])inkStroke(c,[[128+sx*75,128+sy*100],[128+sx*96,128+sy*99,128+sx*99,128+sy*78]],3,ink,a);
    }
  }
  function supportPaint(f,t){
    const c=f.ctx,p=clamp(t/f.duration),a=(low?1:ease(t/.06))*(1-ease((p-.3)/.7));
    if(f.kind==='progress'){
      const sweep=low?1:ease(t/.25);
      inkStroke(c,[[122,110],[198,122,122+306*sweep,109]],5,'#b17b2e',a);
      for(const side of [-1,1])inkStroke(c,[[256+side*215,27],[256+side*231,61,256+side*211,91]],4,'#835b31',a*.9);
    }else if(f.kind==='loss'){
      const x=256+(f.index-1)*137,spread=low?0:ease(t/.25)*11;
      for(const s of [-1,1]){
        inkStroke(c,[[x+s*(43+spread),27],[x+s*(57+spread),18]],4,'#b74c3e',a);
        inkStroke(c,[[x+s*(48+spread),88],[x+s*(61+spread),103]],4,'#b74c3e',a);
      }
      stroke(c,[[x-29,117],[x-6,121,x+13,117]],5,'#fff2d7',a);
    }else if(f.kind==='result'){
      const stage=low?1:ease((t-.12)/.22),settle=low?0:ease((t-.4)/.65),v=a*stage;
      // Attached to the original loss actor; ink echoes its held broken heart, never a reward burst.
      for(const s of [-1,1]){
        const x=229+s*(67+settle*9);
        inkStroke(c,[[x-s*12,303],[x+s*17,329,x+s*4,363],[x-s*11,391]],5,'#a9493e',v);
        inkStroke(c,[[229+s*94,223],[229+s*108,209,229+s*114,197]],4,'#725239',v*.65);
      }
      stroke(c,[[171,476],[229,488,289,476]],7,'#f6e5c4',v*.85);
    }
  }
  function paint(f,time){
    if(!f.active)return;if(time-f.at>f.duration){clear(f);return;}
    f.ctx.clearRect(0,0,f.image.width,f.image.height);f.ctx.save();
    f.cell?cellPaint(f,time-f.at):supportPaint(f,time-f.at);f.ctx.restore();f.texture.needsUpdate=true;A.dirty();
  }
  function flight(time){
    const generation=A.Q.ui._catFlyTween;if(generation!==flyGeneration){clear(fly);lastFly=null;flyGeneration=generation;}
    const n=A.Q.ui.catFly,visible=!low&&!failVisible()&&n.activeInHierarchy;
    if(!visible){clear(fly);lastFly=null;return;}
    const current=[n.world[4],n.world[5]],prev=lastFly;lastFly=current;
    if(!prev)return;
    const dx=current[0]-prev[0],dy=current[1]-prev[1];if(Math.hypot(dx,dy)<.01){clear(fly);return;}
    const m=n.world,det=m[0]*m[3]-m[1]*m[2];if(Math.abs(det)<1e-6)return;
    const lx=(m[3]*dx-m[2]*dy)/det,ly=(-m[1]*dx+m[0]*dy)/det,angle=Math.atan2(-ly,lx);
    fly.kind='flight';fly.active=true;fly.at=time;fly.duration=.1;fly.node.SetActive(true);
    const c=fly.ctx;c.clearRect(0,0,256,256);c.save();c.translate(128,128);c.rotate(angle);
    for(const s of [-1,1])inkStroke(c,[[-42,s*31],[-70,s*42,-102,s*32]],4,'#987044',.63);
    stroke(c,[[-65,0],[-91,2,-111,-1]],5,'#fff4d6',.85);c.restore();fly.texture.needsUpdate=true;A.dirty();
  }
  function tick(time,reduced){guard(()=>{
    low=!!reduced;if(root!==A.Q.root)attach();if(!root)return;
    if(failVisible()){for(const f of owned)if(f!==result)clear(f);lastFly=null;}
    for(const f of owned)if(f!==fly)paint(f,time);
    flight(time);state.active=owned.filter(f=>f.active).length;state.peak=Math.max(state.peak,state.active);
  });}
  function diagnostics(){const effects=owned.filter(f=>f.active).map(f=>({kind:f.kind,row:f.cell?.Row,col:f.cell?.Col,ageMs:(A.Cl.time-f.at)*1000,durationMs:f.duration*1000,attached:f.node.parent===f.parent&&f.parent.children.includes(f.node),layer:f.layer}));return {...state,active:effects.length,errors:state.errors.slice(),events:state.events.slice(),effects};}
})();
