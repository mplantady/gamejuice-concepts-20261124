/* Illustrated journal skins. Native geometry, hierarchy, text and rules remain authoritative. */
(() => {
  const A=window.MeowdokuNative;
  const state={ready:false,errors:[],roots:0,bindings:0,fingerAngle:0,uploads:0};
  const images={},registered=new Map(),bindings=new WeakSet();
  let root=null,manifest=null,nextSprite=9900000,glove=null,background=null;
  const fail=e=>{const message=e?.message||String(e);if(!state.errors.includes(message))state.errors.push(message);};
  const S=window.MeowdokuSurfaces={ready:null,attach,tick,diagnostics:()=>({...state,errors:state.errors.slice(),backgroundStationary:true})};
  // Build emits this module in dist root, so asset paths are relative to the module itself.
  const publicURL=file=>new URL('assets/surfaces/'+file,import.meta.url).href;
  S.ready=fetch(publicURL('manifest.json')).then(r=>{if(!r.ok)throw Error('Missing journal surface manifest');return r.json();}).then(async m=>{
    manifest=m;
    await Promise.all(Object.entries(m.assets).map(([name,entry])=>new Promise((resolve,reject)=>{
      const im=new Image();im.onload=()=>{images[name]=im;resolve();};im.onerror=()=>reject(Error('Missing journal surface '+name));im.src=publicURL(entry.file);
    })));
    await A.ready;state.ready=true;
  }).catch(e=>{fail(e);throw e;});

  function register(name,borders=[0,0,0,0]){
    const key=name+'|'+borders.join(',');if(registered.has(key))return registered.get(key);
    while(A.sprites[nextSprite])nextSprite++;
    const id=nextSprite++,file='meowdoku-journal/'+key,im=images[name];
    A.images[file]=im;A.sprites[id]={f:file,w:im.width,h:im.height,b:borders,ppu:100};
    const result={id,file};registered.set(key,result);return result;
  }
  function skin(img,name,{type=0,borders=[0,0,0,0],ppu=1}={}){
    if(!img||bindings.has(img))return;bindings.add(img);
    const entry=register(name,borders),original=img.ensureMesh.bind(img);
    img.sprite=entry.id;img.type=type;img.ppuMul=ppu;
    // Original ensureMesh creates the shared native material. Pick it after any older skin wrapper.
    img.ensureMesh=function(){const mesh=original();const material=A.materials.get(entry.file);if(material)mesh.material=material;return mesh;};
    img._k=null;state.bindings++;A.dirty();
  }
  const panel=img=>skin(img,'panel',{type:1,borders:[28,28,28,28],ppu:1.25});
  const support=img=>skin(img,'support-card',{type:1,borders:[28,28,28,28],ppu:1.1});
  const button=img=>skin(img,'button',{type:1,borders:[70,60,70,60],ppu:.8});
  const unique=id=>A.Q.byCid.get(id);
  function attach(){
    if(!state.ready||!A.Q.root||root===A.Q.root)return false;
    root=A.Q.root;state.roots++;glove=null;
    const {Q}=A;
    background=new A.node({n:'MeowdokuJournalPage',a:1,rt:[.5,.5,0,0,1,1,0,0,0,0,0,1,1],img:{s:null,t:0,fm:4,fa:1,fo:0,ppu:1,rc:0,c:[1,1,1,1],en:1}},root);
    root.children.unshift(background);
    skin(background.img,'paper',{type:1,borders:[32,40,32,40],ppu:1.25});
    support(Q.grid.gridContainer.img);
    for(const cell of Q.grid._cells.values()){
      skin(cell.backgroundImage,'tile-neutral',{type:1,borders:[24,24,24,24],ppu:2});
      skin(cell.excludedImage,'white-plus',{type:3});
      skin(cell.breakImage,'tile-neutral',{type:1,borders:[24,24,24,24],ppu:2});
      const broken=cell.breakImage.node;
      skin(broken.find('Image_Cross')?.img,'error-ink-neutral',{type:3});
      skin(broken.find('Image_Heart0')?.img,'heart-registered');
      skin(broken.find('Image_Heart1')?.img,'heart-left');
      skin(broken.find('Image_Heart2')?.img,'heart-right');
    }
    [420310,420454,420402,419938,420492,420500,420252,420228,420194,420436].forEach(id=>panel(unique(id)?.img));
    // Child cards keep their ink edges; the two enclosing rule groups add no nested frame.
    [420202,420526].forEach(id=>{const img=unique(id)?.img;if(img)img.color.a=0;});
    skin(Q.ui.catCountProgress.img,'tile-neutral',{type:1,borders:[24,24,24,24],ppu:2});
    [420260,420184,420392].forEach(id=>button(unique(id)?.img));
    [420372,420362,420342,420012,420274,420302].forEach(id=>skin(unique(id)?.img,'fish-registered'));
    skin(unique(419912)?.img,'logo');
    makeGlove(Q.tut.handGuide.find('GuideHand')?.img);
    // Real SDF glyphs, localized wording and native measurements stay intact.
    root.walk(node=>{if(node.txt&&[419974,420142,419964,419892,420124,420292,419982,420028,420088].includes(node.def.id)){
      node.txt.color.r=.29;node.txt.color.g=.19;node.txt.color.b=.12;node.txt._k=null;
    }});
    A.layout();A.dirty();return true;
  }
  function makeGlove(img){
    if(!img)return;
    skin(img,'glove-registered');
    const canvas=document.createElement('canvas');canvas.width=272;canvas.height=277;
    const ctx=canvas.getContext('2d'),mesh=img.ensureMesh(),material=mesh.material.clone(),texture=A.texture(canvas);
    material.map=texture;material.needsUpdate=true;
    const original=img.ensureMesh.bind(img);
    img.ensureMesh=function(){const m=original();m.material=glove?.dynamic&&glove.img===img?material:A.materials.get(A.sprites[img.sprite].f);return m;};
    glove={img,canvas,ctx,material,texture,angle:NaN,dynamic:false};
  }
  function drawGlove(angle){
    const g=glove;if(!g||Math.abs(g.angle-angle)<.001)return;
    g.angle=angle;state.fingerAngle=angle;
    g.dynamic=Math.abs(angle)>.001;
    if(!g.dynamic){A.dirty();return;}
    const c=g.ctx,{finger_pivot:p,registration_contact:tip}=manifest.glove_rig;
    c.clearRect(0,0,272,277);
    // Joint rotation is compensated so the pointing tip keeps the original target contact.
    const dx=tip[0]-p[0],dy=tip[1]-p[1],tx=dx-(dx*Math.cos(angle)-dy*Math.sin(angle)),ty=dy-(dx*Math.sin(angle)+dy*Math.cos(angle));
    c.save();c.translate(p[0]+tx,p[1]+ty);c.rotate(angle);c.translate(-p[0],-p[1]);c.drawImage(images['glove-finger'],0,0);c.restore();
    c.drawImage(images['glove-palm'],0,0);
    g.texture.needsUpdate=true;state.uploads++;A.dirty();
  }
  function tick(time,ambient,lowMotion){
    try{
      if(!state.ready)return;if(root!==A.Q.root)attach();
      if(!glove||!glove.img.node.activeInHierarchy)return;
      const animator=A.Q.tut.handGuide.animator;
      const controller=animator?.ctrl,st=controller?.states?.[animator.state||controller.default];
      const t=animator?.time||0,name=st?.name;
      let bend=0;
      const pulse=(x,d)=>x>=0&&x<d?Math.sin(Math.PI*x/d):0;
      if(!lowMotion){
        if(name==='doubleClick')bend=.075*(pulse(t%2,.27)+pulse(t%2-.27,.27));
        else if(name==='OneClick')bend=.065*pulse(t%1-.1,.32);
        else if(name==='LongPress')bend=.05*pulse(t,.5);
      }
      drawGlove(bend);
    }catch(e){fail(e);}
  }
})();
