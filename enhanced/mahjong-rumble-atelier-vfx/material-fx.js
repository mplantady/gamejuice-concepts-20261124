// Procedural material accents. All geometry is presentation-only and RNG-free.
const clamp = v => Math.max(0, Math.min(1, v));

function rim(c, inset = 0) {
  // Follow the painted face's scalloped bevel, leaving the jade depth visible.
  c.save(); c.translate(100,115); c.scale(1-inset/90,1-inset/108); c.translate(-100,-115);
  c.beginPath();
  c.moveTo(49,8); c.lineTo(151,8);
  c.bezierCurveTo(164,8,165,18,172,26);
  c.bezierCurveTo(178,33,189,34,189,49); c.lineTo(189,184);
  c.bezierCurveTo(189,197,179,198,172,207);
  c.bezierCurveTo(165,216,165,222,151,222); c.lineTo(49,222);
  c.bezierCurveTo(35,222,35,214,28,207);
  c.bezierCurveTo(21,199,12,197,12,184); c.lineTo(12,49);
  c.bezierCurveTo(12,35,23,32,29,26);
  c.bezierCurveTo(36,18,36,8,49,8); c.closePath(); c.restore();
}

export function paintTileFeedback(c, options) {
  let { selected=false, tap=0, commit=0, reject=0, contact=0, lowMotion=false } = options;
  if (lowMotion) tap=commit=contact=0;
  tap=clamp(tap); commit=clamp(commit); reject=clamp(reject); contact=clamp(contact);
  c.save(); c.lineJoin='round'; c.lineCap='round';
  if (selected && !reject) {
    rim(c); c.strokeStyle='#185f48'; c.lineWidth=8; c.stroke();
    rim(c,1); c.strokeStyle='#efd58d'; c.lineWidth=4.5; c.stroke();
    c.beginPath(); c.moveTo(40,16); c.quadraticCurveTo(43,10,52,10); c.lineTo(142,10);
    c.strokeStyle='#fff6d0'; c.lineWidth=2.5; c.stroke();
  }
  if (tap>0) {
    c.globalAlpha=tap*.9; rim(c,2);
    c.strokeStyle='#fff3c6'; c.lineWidth=3+tap*3.5; c.stroke();
    c.globalAlpha=tap*.7; c.beginPath(); c.moveTo(48,226); c.quadraticCurveTo(100,229,152,226);
    c.strokeStyle='#0d4b3c'; c.lineWidth=4; c.stroke();
  }
  if (commit>0) {
    c.globalAlpha=commit; rim(c,1); c.strokeStyle='#fff4ce'; c.lineWidth=7.5; c.stroke();
    c.globalAlpha=commit*.86; c.strokeStyle='#c49235'; c.lineWidth=3;
    for (const [x,y,sx,sy] of [[48,12,1,1],[152,12,-1,1],[48,218,1,-1],[152,218,-1,-1]]) {
      const d=8+commit*10;
      c.beginPath(); c.moveTo(x+sx*d,y); c.lineTo(x,y);
      c.quadraticCurveTo(x-sx*8,y,x-sx*12,y+sy*11); c.stroke();
    }
  }
  if (reject>0) {
    c.globalAlpha=reject; rim(c,1); c.strokeStyle='#b93530'; c.lineWidth=8; c.stroke();
    rim(c,5); c.strokeStyle='#f4b59a'; c.lineWidth=2; c.stroke();
    // A bottom-bevel rejection stamp remains legible without covering the glyph.
    c.beginPath(); c.moveTo(89,205); c.lineTo(111,227); c.moveTo(111,205); c.lineTo(89,227);
    c.strokeStyle='#682c26'; c.lineWidth=9; c.stroke();
    c.strokeStyle='#fff1ce'; c.lineWidth=4.5; c.stroke();
  }
  if (contact>0) {
    c.globalAlpha=contact*.75; c.beginPath(); c.ellipse(100,237,73,4,0,0,Math.PI*2);
    c.fillStyle='#103e30'; c.fill();
    c.globalAlpha=contact; c.beginPath(); c.moveTo(29,231); c.quadraticCurveTo(100,240,171,231);
    c.strokeStyle='#fff0b8'; c.lineWidth=5; c.stroke();
  }
  c.restore();
}

export function paintTrail(c, points, intensity=1) {
  if (points.length<2) return;
  c.save(); c.lineCap='round'; c.lineJoin='round';
  for (let i=1; i<points.length; i++) {
    const p=i/(points.length-1), a=points[i-1], b=points[i];
    c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(b.x,b.y);
    c.globalAlpha=p*.22*intensity; c.strokeStyle='#174f3d'; c.lineWidth=2+p*5; c.stroke();
    c.globalAlpha=p*.85*intensity; c.strokeStyle=i%2?'#efd697':'#bc8a35'; c.lineWidth=.5+p*3.3; c.stroke();
  }
  const head=points.at(-1); c.globalAlpha=.9*intensity;
  c.fillStyle='#fff2c3'; c.beginPath(); c.arc(head.x,head.y,1.7,0,Math.PI*2); c.fill();
  c.restore();
}

export function paintReceiver(c, rect, {kind,progress,alpha=1,lowMotion=false}) {
  if (lowMotion || progress<0 || progress>=1 || rect.width<=0 || rect.height<=0) return;
  const p=clamp(progress), envelope=Math.sin(Math.PI*p)**.7;
  const x=rect.left+3,y=rect.top+3,w=rect.width-6,h=rect.height-6;
  const radius=kind==='panel'?Math.min(25,h*.28):h/2;
  const perimeter=2*(w+h)-8*radius+2*Math.PI*radius;
  c.save(); c.globalAlpha=envelope*alpha;
  c.lineWidth=kind==='money'?2.8:4; c.strokeStyle='#8f682d';
  c.beginPath(); c.roundRect(x,y,w,h,radius); c.stroke();
  c.lineCap='round'; c.setLineDash([perimeter*(kind==='money'?.19:.23),perimeter]);
  c.lineDashOffset=-perimeter*p*.9; c.strokeStyle='#fff0b6';
  c.lineWidth=kind==='ranking'?4.5:3.5; c.stroke();
  c.setLineDash([]); c.globalAlpha=envelope*alpha*.65;
  const run=Math.min(w*.14,42), rise=Math.min(h*.13,17);
  for(const [cx,cy,sx,sy]of[[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]]) {
    c.beginPath(); c.moveTo(cx+sx*run,cy); c.lineTo(cx+sx*radius,cy);
    c.quadraticCurveTo(cx,cy,cx,cy+sy*radius); c.lineTo(cx,cy+sy*Math.max(radius,rise));
    c.strokeStyle='#e2bc68'; c.lineWidth=1.5; c.stroke();
  }
  c.restore();
}
