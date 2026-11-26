/* Generated art is cropped and registered here at runtime. No pixels are
   repainted, thresholded or color-keyed; source alpha survives drawImage. */
const IMAGE_FILES={
  open:'cabinet-open-copper.webp', bronze:'cabinet-closed-bronze.webp',
  knot:'cabinet-walnut-knot.webp', surface:'cabinet-surface.webp',
  latch:'cabinet-latch-parts.webp', ui:'cabinet-ui-atlas.webp', play:'cabinet-play-button.webp',
};
// Rectangles use [left, top, right, bottom], with exclusive right/bottom.
// Ring target bounds are the source contract, multiplied by exactly two.
const PARTS={
  open:{image:'open',crop:[51,36,1193,1166],size:[448,448],target:[6,10,442,428],sourceCanvas:[224,224],sourceAlpha:[3,5,221,214]},
  bronze:{image:'bronze',crop:[26,24,1224,1218],size:[448,448],target:[0,0,448,448],sourceCanvas:[224,224],sourceAlpha:[0,0,224,224]},
  knot:{image:'knot',crop:[33,21,1206,1161],size:[520,516],target:[0,0,520,506],sourceCanvas:[260,258],sourceAlpha:[0,0,260,253]},
  surface:{image:'surface',full:true},
  play:{image:'play',crop:[17,11,2094,713],size:[1024,352]},
  header:{image:'ui',crop:[17,33,1007,445],size:[1024,429]},
  footer:{image:'ui',crop:[25,557,999,704],size:[1024,158]},
  button:{image:'ui',crop:[121,825,902,1057],size:[512,155]},
  icon:{image:'ui',crop:[362,1175,661,1475],size:[256,256]},
  socket:{image:'latch',crop:[103,168,364,993],size:[128,416]},
  jaw:{image:'latch',crop:[513,323,1229,848],size:[384,352]},
};
const GUTTER=2;

function canvas(width,height){
  const element=document.createElement('canvas');element.width=width;element.height=height;
  const context=element.getContext('2d',{alpha:true});
  if(!context)throw new Error('Transparent 2D canvas is unavailable');
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  return {element,context};
}
function loadImage(key,file){
  return new Promise((resolve,reject)=>{
    const image=new Image();let settled=false;
    const finish=(error)=>{
      if(settled)return;settled=true;clearTimeout(timer);image.onload=null;image.onerror=null;
      if(error)reject(new Error(`${file}: ${error}`));
      else if(!(image.naturalWidth>0&&image.naturalHeight>0))reject(new Error(`${file}: empty image`));
      else resolve([key,image]);
    };
    const timer=setTimeout(()=>finish('image load timed out after 30 seconds'),30000);
    image.decoding='async';image.onload=()=>finish();image.onerror=()=>finish('image load failed');
    image.src=new URL(`assets/${file}`,import.meta.url).href;
  });
}
function fittedTarget(size,crop){
  const width=crop[2]-crop[0],height=crop[3]-crop[1];
  const scale=Math.min((size[0]-GUTTER*2)/width,(size[1]-GUTTER*2)/height);
  const w=width*scale,h=height*scale,x=(size[0]-w)/2,y=(size[1]-h)/2;
  return [x,y,x+w,y+h];
}
function aggregate(errors,stage){
  return new AggregateError(errors,`Cabinet ${stage} failed: ${errors.map(error=>error.message).join('; ')}`);
}

export async function loadCabinetAssets(api){
  const Texture=api.CanvasTexture||api.Texture;
  if(typeof Texture!=='function')throw new Error('Cabinet assets require api.CanvasTexture or api.Texture');
  // Start all independent files before inspecting failures. A failure is
  // reported with every affected file instead of masking later image errors.
  const results=await Promise.allSettled(Object.entries(IMAGE_FILES).map(([key,file])=>loadImage(key,file)));
  const imageErrors=results.filter(row=>row.status==='rejected').map(row=>row.reason);
  if(imageErrors.length)throw aggregate(imageErrors,'image loading');
  const images=Object.fromEntries(results.map(row=>row.value));
  const textures={},owned=[],mappings={},textureErrors=[];let disposed=false;
  function dispose(){
    if(disposed)return;disposed=true;
    for(const texture of owned)texture.dispose();
  }
  for(const [name,spec] of Object.entries(PARTS)){
    try{
      const image=images[spec.image],imageSize=[image.naturalWidth,image.naturalHeight];
      const crop=spec.full?[0,0,...imageSize]:spec.crop;
      const size=spec.full?imageSize:spec.size;
      if(crop[0]<0||crop[1]<0||crop[2]>imageSize[0]||crop[3]>imageSize[1]||crop[2]<=crop[0]||crop[3]<=crop[1]){
        throw new Error(`crop ${crop.join(',')} exceeds image ${imageSize.join('×')}`);
      }
      const target=spec.full?[0,0,...size]:(spec.target||fittedTarget(size,crop));
      const output=canvas(...size),sw=crop[2]-crop[0],sh=crop[3]-crop[1];
      const dw=target[2]-target[0],dh=target[3]-target[1];
      if(spec.full){
        output.context.drawImage(image,0,0);
      }else{
        // A temporary transparent gutter isolates an exact atlas rectangle
        // before filtering. It never samples a neighboring part or fills alpha.
        const isolated=canvas(sw+GUTTER*2,sh+GUTTER*2);
        isolated.context.drawImage(image,crop[0],crop[1],sw,sh,GUTTER,GUTTER,sw,sh);
        const px=GUTTER*dw/sw,py=GUTTER*dh/sh;
        output.context.drawImage(isolated.element,0,0,sw+GUTTER*2,sh+GUTTER*2,
          target[0]-px,target[1]-py,dw+px*2,dh+py*2);
      }
      const texture=new Texture(output.element);owned.push(texture);
      texture.name=`cabinet-${name}`;
      if(api.NoColorSpace!==undefined)texture.colorSpace=api.NoColorSpace;
      if(api.LinearFilter!==undefined){texture.minFilter=api.LinearFilter;texture.magFilter=api.LinearFilter;}
      texture.generateMipmaps=true;if(api.LinearMipmapLinearFilter!==undefined)texture.minFilter=api.LinearMipmapLinearFilter;texture.needsUpdate=true;
      texture.offset?.set(0,0);texture.repeat?.set(1,1);texture.center?.set(0,0);texture.rotation=0;
      texture.userData=texture.userData||{};
      texture.userData.w=size[0];texture.userData.h=size[1];texture.userData.cabinetAsset=name;
      textures[name]=texture;
      mappings[name]={file:IMAGE_FILES[spec.image],sourceImagePx:imageSize,sourceCropPx:[...crop],
        targetCanvasPx:[...size],targetContentPx:[...target],uv:[0,0,1,1],pivotNormalized:[.5,.5],
        sourceCanvasPx:spec.sourceCanvas?[...spec.sourceCanvas]:null,
        originalAlphaBBoxPx:spec.sourceAlpha?[...spec.sourceAlpha]:null,
        sourceGutterPx:spec.full?0:GUTTER,targetMinPaddingPx:spec.full||spec.target?0:GUTTER,
        registration:spec.sourceCanvas?'Exact original full-canvas alpha-bounds registration at 2× resolution':
          spec.full?'Full generated surface, unchanged dimensions':'Aspect-preserving fit with at least 2px transparent target padding'};
    }catch(error){textureErrors.push(new Error(`${name}: ${error.message}`));}
  }
  if(textureErrors.length){dispose();throw aggregate(textureErrors,'texture creation');}
  const metadata={version:'cabinet-assets-v2',imageCount:Object.keys(images).length,textureCount:owned.length,
    alphaTreatment:'Canvas drawImage only; no threshold, repaint, opaque fill or custom pixel processing.',
    cropConvention:'Explicit supplied rectangles; generated files may contain faint nonzero alpha outside them.',
    ringRegistration:'Original centered source canvases and alpha bounds preserved. Edge-touching original art is not inset for padding.',
    mappings};
  return {textures,metadata,dispose};
}
