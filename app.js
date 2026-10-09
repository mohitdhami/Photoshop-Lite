/* Photoshop Lite — vanilla JS engine
   Layers + tools + adjustments + history + file I/O, no dependencies. */
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- state ---------- */
const S = {
  w: 1280, h: 800,
  layers: [],          // {id,name,visible,opacity,blend,canvas}
  active: 0,
  tool: 'move',
  fg: '#ff3b30', bg: '#ffffff',
  brush: { size: 12, opacity: 100, hardness: 100 },
  fillTol: 32,
  font: { face: 'Arial', size: 48 },
  shape: { fill: true, stroke: 0 },
  zoom: 1,
  selection: null,     // {x,y,w,h}
  clipboard: null,     // canvas
  history: [], hIndex: -1,
  grid: false, rulers: true,
  drawing: false, startX: 0, startY: 0, lastX: 0, lastY: 0,
  moveBackup: null, selBackup: null, floatSel: null, floatOff: {x:0,y:0},
  preview: null,       // {type,x0,y0,x1,y1}
  cropRect: null,
  spaceDown: false,
  layerSeq: 1,
};
let uidc = 1;
const uid = () => 'L' + (uidc++) + '_' + Date.now().toString(36);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const toastEl = $('#toast');
let toastT=null;
function toast(msg){ toastEl.textContent=msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>toastEl.classList.remove('show'),1800); }

/* ---------- elements ---------- */
const main=$('#main'), overlay=$('#overlay');
const mctx=main.getContext('2d',{willReadFrequently:true});
const octx=overlay.getContext('2d');
const scrollArea=$('#scroll-area'), holder=$('#canvas-holder');
const rulerH=$('#rulerH'), rulerV=$('#rulerV');

/* ---------- document / layers ---------- */
function makeCanvas(w,h){ const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w)); c.height=Math.max(1,Math.round(h)); return c; }
function copyCanvas(c){ const n=makeCanvas(c.width,c.height); n.getContext('2d').drawImage(c,0,0); return n; }

function newDocument(w,h,bg,skipHistory){
  w=clamp(Math.round(w)||1280,1,8000); h=clamp(Math.round(h)||800,1,8000);
  S.w=w; S.h=h; S.layers=[]; S.active=0; S.selection=null; S.cropRect=null; S.preview=null;
  S.history=[]; S.hIndex=-1; S.layerSeq=1;
  const c=makeCanvas(w,h), x=c.getContext('2d');
  if(bg==='white'){ x.fillStyle='#fff'; x.fillRect(0,0,w,h); }
  else if(bg==='black'){ x.fillStyle='#000'; x.fillRect(0,0,w,h); }
  // transparent: leave empty
  S.layers.push({id:uid(),name:'Background',visible:true,opacity:100,blend:'source-over',canvas:c});
  S.active=0;
  main.style.filter=''; resetAdjSliders();
  syncCanvasSize(); fitZoomIfFirst(); render(); refreshLayersUI();
  if(!skipHistory) pushHistory('New document');
  updateStatus();
}
function activeLayer(){ return S.layers[S.active] || null; }
function layerThumb(layer,canvasEl){
  const t=canvasEl.getContext('2d'); t.clearRect(0,0,canvasEl.width,canvasEl.height);
  const s=Math.min(canvasEl.width/layer.canvas.width,canvasEl.height/layer.canvas.height);
  const dw=layer.canvas.width*s, dh=layer.canvas.height*s;
  t.drawImage(layer.canvas,(canvasEl.width-dw)/2,(canvasEl.height-dh)/2,dw,dh);
}
function addLayer(name,canvas,atTop=true){
  const c = canvas || makeCanvas(S.w,S.h);
  const L={id:uid(),name:name||('Layer '+S.layerSeq++),visible:true,opacity:100,blend:'source-over',canvas:c};
  if(atTop){ S.layers.push(L); S.active=S.layers.length-1; } else { S.layers.splice(0,0,L); S.active=0; }
  render(); refreshLayersUI(); return L;
}
function duplicateLayer(i){
  i=i??S.active; const src=S.layers[i]; if(!src) return;
  const L={id:uid(),name:src.name+' copy',visible:src.visible,opacity:src.opacity,blend:src.blend,canvas:copyCanvas(src.canvas)};
  S.layers.splice(i+1,0,L); S.active=i+1; pushHistory('Duplicate layer'); render(); refreshLayersUI();
}
function deleteLayer(i){
  i=i??S.active; if(S.layers.length<=1){ toast('Cannot delete the last layer'); return; }
  S.layers.splice(i,1); S.active=clamp(i,0,S.layers.length-1);
  pushHistory('Delete layer'); render(); refreshLayersUI();
}
function moveLayer(i,dir){ // dir +1 up, -1 down (array order; top = end)
  const j=i+dir; if(j<0||j>=S.layers.length) return;
  [S.layers[i],S.layers[j]]=[S.layers[j],S.layers[i]]; S.active=j;
  pushHistory('Reorder layers'); render(); refreshLayersUI();
}
function mergeDown(){
  const i=S.active; if(i<=0){ toast('Nothing below to merge'); return; }
  const top=S.layers[i], bot=S.layers[i-1];
  const c=makeCanvas(S.w,S.h), x=c.getContext('2d');
  x.globalAlpha=bot.opacity/100; x.globalCompositeOperation=bot.blend; x.drawImage(bot.canvas,0,0);
  x.globalAlpha=top.opacity/100; x.globalCompositeOperation=top.blend; x.drawImage(top.canvas,0,0);
  bot.canvas=c; bot.name=bot.name+' + '+top.name;
  S.layers.splice(i,1); S.active=i-1; pushHistory('Merge down'); render(); refreshLayersUI();
}
function flatten(){
  const c=makeCanvas(S.w,S.h), x=c.getContext('2d');
  x.fillStyle='#fff'; x.fillRect(0,0,S.w,S.h);
  for(const L of S.layers){ if(!L.visible) continue; x.globalAlpha=L.opacity/100; x.globalCompositeOperation=L.blend; x.drawImage(L.canvas,0,0); }
  x.globalAlpha=1; x.globalCompositeOperation='source-over';
  S.layers=[{id:uid(),name:'Background',visible:true,opacity:100,blend:'source-over',canvas:c}];
  S.active=0; pushHistory('Flatten image'); render(); refreshLayersUI();
}

/* ---------- render / zoom ---------- */
function syncCanvasSize(){
  main.width=S.w; main.height=S.h; overlay.width=S.w; overlay.height=S.h;
  applyZoom();
}
function applyZoom(){
  main.style.width=(S.w*S.zoom)+'px'; main.style.height=(S.h*S.zoom)+'px';
  overlay.style.width=main.style.width; overlay.style.height=main.style.height;
  $('#zoom-label').textContent=Math.round(S.zoom*100)+'%';
  drawRulers(); updateStatus();
}
function setZoom(z,center=true){
  z=clamp(z,0.02,8);
  if(center){
    const sx=scrollArea.scrollLeft+scrollArea.clientWidth/2, sy=scrollArea.scrollTop+scrollArea.clientHeight/2;
    const rx=sx/(S.w*S.zoom), ry=sy/(S.h*S.zoom);
    S.zoom=z; applyZoom();
    scrollArea.scrollLeft=rx*(S.w*S.zoom)-scrollArea.clientWidth/2;
    scrollArea.scrollTop=ry*(S.h*S.zoom)-scrollArea.clientHeight/2;
  } else { S.zoom=z; applyZoom(); }
}
let firstFit=true;
function fitZoomIfFirst(){ if(firstFit){ firstFit=false; zoomFit(); } }
function zoomFit(){
  const pad=90, aw=scrollArea.clientWidth-pad, ah=scrollArea.clientHeight-pad;
  setZoom(clamp(Math.min(aw/S.w,ah/S.h),0.02,4),false);
  // center
  requestAnimationFrame(()=>{ scrollArea.scrollLeft=Math.max(0,(holder.offsetWidth-scrollArea.clientWidth)/2); scrollArea.scrollTop=Math.max(0,(holder.offsetHeight-scrollArea.clientHeight)/2); });
}
function render(){
  mctx.setTransform(1,0,0,1,0,0);
  mctx.globalAlpha=1; mctx.globalCompositeOperation='source-over';
  mctx.clearRect(0,0,S.w,S.h);
  for(const L of S.layers){
    if(!L.visible) continue;
    mctx.globalAlpha=L.opacity/100;
    try{ mctx.globalCompositeOperation=L.blend; }catch{ mctx.globalCompositeOperation='source-over'; }
    mctx.drawImage(L.canvas,0,0);
  }
  mctx.globalAlpha=1; mctx.globalCompositeOperation='source-over';
  drawOverlay(); updateStatus();
}
function imgToScreen(x,y){ const r=main.getBoundingClientRect(), hr=holder.getBoundingClientRect(); return {x:r.left-hr.left+x*S.zoom, y:r.top-hr.top+y*S.zoom}; }

/* ---------- overlay (selection ants + grid + previews) ---------- */
let antOff=0;
(function ants(){ antOff=(antOff+1)%24; drawOverlay(); requestAnimationFrame(ants); })();
function drawOverlay(){
  if(!overlay.width) return;
  octx.setTransform(1,0,0,1,0,0);
  octx.clearRect(0,0,S.w,S.h);
  if(S.grid){
    octx.strokeStyle='rgba(49,168,255,.18)'; octx.lineWidth=1;
    const step=64; octx.beginPath();
    for(let x=0;x<=S.w;x+=step){ octx.moveTo(x+.5,0); octx.lineTo(x+.5,S.h); }
    for(let y=0;y<=S.h;y+=step){ octx.moveTo(0,y+.5); octx.lineTo(S.w,y+.5); }
    octx.stroke();
  }
  const p=S.preview;
  if(p){
    if(p.type==='select'||p.type==='crop'||p.type==='shape'||p.type==='gradient'||p.type==='text-anchor') drawMarch(p);
    if(p.type==='crop'){ octx.fillStyle='rgba(0,0,0,.55)'; const r=normRect(p);
      octx.fillRect(0,0,S.w,r.y); octx.fillRect(0,r.y+r.h,S.w,S.h-r.y-r.h);
      octx.fillRect(0,r.y,r.x,r.h); octx.fillRect(r.x+r.w,r.y,S.w-r.x-r.w,r.h); drawMarch(p);
    }
    if(p.type==='shape'){ drawShapePreview(p); }
    if(p.type==='gradient'){ const r=normRect(p); const g=octx.createLinearGradient(p.x0,p.y0,p.x1,p.y1);
      g.addColorStop(0,S.fg); g.addColorStop(1,S.bg); octx.fillStyle=g;
      if(S.selection){ const s=S.selection; octx.save(); octx.beginPath(); octx.rect(s.x,s.y,s.w,s.h); octx.clip(); octx.fillRect(0,0,S.w,S.h); octx.restore(); }
      else octx.fillRect(0,0,S.w,S.h); octx.globalAlpha=.55; octx.strokeStyle='#fff'; octx.strokeRect(r.x,r.y,r.w||1,r.h||1); octx.globalAlpha=1; }
  }
  if(S.selection && (!p || p.type!=='select')){
    const s=S.selection;
    octx.save(); octx.strokeStyle='#fff'; octx.lineWidth=1.5; octx.setLineDash([7,5]); octx.lineDashOffset=-antOff;
    octx.strokeRect(s.x,s.y,s.w,s.h);
    octx.strokeStyle='#000'; octx.lineDashOffset=-antOff+7; octx.strokeRect(s.x,s.y,s.w,s.h); octx.restore();
  }
}
function normRect(p){ return {x:Math.min(p.x0,p.x1),y:Math.min(p.y0,p.y1),w:Math.abs(p.x1-p.x0),h:Math.abs(p.y1-p.y0)}; }
function drawMarch(p){ const r=normRect(p);
  octx.save(); octx.strokeStyle='#fff'; octx.lineWidth=1.5; octx.setLineDash([7,5]); octx.lineDashOffset=-antOff;
  octx.strokeRect(r.x,r.y,Math.max(1,r.w),Math.max(1,r.h));
  octx.strokeStyle='#000'; octx.lineDashOffset=-antOff+7; octx.strokeRect(r.x,r.y,Math.max(1,r.w),Math.max(1,r.h)); octx.restore();
}
let shapeKind='rect';
function drawShapePreview(p){
  const r=normRect(p); octx.save();
  octx.fillStyle=S.fg; octx.strokeStyle=S.bg==='#ffffff'?'#000000':S.bg; octx.lineWidth=Math.max(1,S.shape.stroke);
  octx.beginPath();
  if(p.kind==='rect'){ if(S.shape.fill) octx.fillRect(r.x,r.y,r.w,r.h); if(S.shape.stroke>0) octx.strokeRect(r.x,r.y,r.w,r.h); }
  else if(p.kind==='ellipse'){ octx.ellipse(r.x+r.w/2,r.y+r.h/2,Math.max(1,r.w/2),Math.max(1,r.h/2),0,0,Math.PI*2); if(S.shape.fill) octx.fill(); if(S.shape.stroke>0) octx.stroke(); }
  else { octx.moveTo(p.x0,p.y0); octx.lineTo(p.x1,p.y1); octx.lineWidth=Math.max(2,S.brush.size); octx.strokeStyle=S.fg; octx.stroke(); }
  octx.restore();
}

/* ---------- rulers ---------- */
function drawRulers(){
  if(!S.rulers){ $('#ruler-top').style.display='none'; $('#ruler-left').style.display='none'; return; }
  $('#ruler-top').style.display=''; $('#ruler-left').style.display='';
  const hc=$('#ruler-top'), vc=$('#ruler-left');
  hc.style.width=(S.w*S.zoom+40)+'px'; vc.style.height=(S.h*S.zoom+40)+'px';
  rulerH.width=S.w*S.zoom+40; rulerV.height=S.h*S.zoom+40;
  const hx=rulerH.getContext('2d'), vx=rulerV.getContext('2d');
  hx.clearRect(0,0,rulerH.width,18); vx.clearRect(0,0,18,rulerV.height);
  hx.fillStyle=vx.fillStyle='#8a8a93'; hx.font=vx.font='9px sans-serif';
  const step=pickStep(S.zoom);
  hx.strokeStyle=vx.strokeStyle='#55555e';
  for(let x=0;x<=S.w;x+=step){ const sx=x*S.zoom; hx.beginPath(); hx.moveTo(sx+.5,8); hx.lineTo(sx+.5,18); hx.stroke(); if(step*S.zoom>40) hx.fillText(x,sx+3,10); }
  for(let y=0;y<=S.h;y+=step){ const sy=y*S.zoom; vx.beginPath(); vx.moveTo(8,sy+.5); vx.lineTo(18,sy+.5); vx.stroke(); if(step*S.zoom>34) vx.fillText(y,1,sy+10); }
}
function pickStep(z){ const target=80/z; const steps=[1,2,5,10,25,50,100,250,500,1000]; return steps.find(s=>s>=target)||2000; }

/* ---------- history ---------- */
function snapshot(){ return S.layers.map(L=>({id:L.id,name:L.name,visible:L.visible,opacity:L.opacity,blend:L.blend,url:L.canvas.toDataURL()})); }
function pushHistory(label){
  S.history=S.history.slice(0,S.hIndex+1);
  try{ S.history.push({label,snap:snapshot(),w:S.w,h:S.h}); }catch(e){ toast('History full — image too large'); return; }
  if(S.history.length>40) S.history.shift();
  S.hIndex=S.history.length-1; refreshHistoryUI();
}
function restoreSnapshot(h){
  S.w=h.w; S.h=h.h; syncCanvasSize();
  const loads=h.snap.map(s=>new Promise(res=>{ const img=new Image(); img.onload=()=>{ const c=makeCanvas(S.w,S.h); const x=c.getContext('2d');
    // draw scaled to current doc size (same normally)
    x.drawImage(img,0,0,S.w,S.h); res({id:s.id,name:s.name,visible:s.visible,opacity:s.opacity,blend:s.blend,canvas:c}); }; img.onerror=()=>{ res({id:s.id,name:s.name,visible:s.visible,opacity:s.opacity,blend:s.blend,canvas:makeCanvas(S.w,S.h)}); }; img.src=s.url; }));
  Promise.all(loads).then(layers=>{ S.layers=layers; S.active=clamp(S.active,0,S.layers.length-1); S.selection=null; main.style.filter=''; resetAdjSliders(); render(); refreshLayersUI(); refreshHistoryUI(); });
}
function undo(){ if(S.hIndex<=0){ toast('Nothing to undo'); return; } S.hIndex--; restoreSnapshot(S.history[S.hIndex]); }
function redo(){ if(S.hIndex>=S.history.length-1){ toast('Nothing to redo'); return; } S.hIndex++; restoreSnapshot(S.history[S.hIndex]); }
function refreshHistoryUI(){
  const el=$('#history'); el.innerHTML='';
  S.history.forEach((h,i)=>{ const b=document.createElement('button'); b.textContent=(i+1)+'. '+h.label; if(i===S.hIndex) b.classList.add('cur');
    b.onclick=()=>{ S.hIndex=i; restoreSnapshot(h); }; el.appendChild(b); });
  el.scrollTop=el.scrollHeight;
}

/* ---------- layers UI ---------- */
function refreshLayersUI(){
  const el=$('#layers'); el.innerHTML='';
  $('#layer-count').textContent='('+S.layers.length+')';
  for(let i=S.layers.length-1;i>=0;i--){
    const L=S.layers[i];
    const row=document.createElement('div'); row.className='layer'+(i===S.active?' active':''); row.draggable=true; row.dataset.i=i;
    const vis=document.createElement('button'); vis.className='vis'; vis.textContent=L.visible?'👁':'🚫'; vis.title='Toggle visibility';
    vis.onclick=(e)=>{ e.stopPropagation(); L.visible=!L.visible; render(); refreshLayersUI(); };
    const th=document.createElement('canvas'); th.width=88; th.height=60; layerThumb(L,th);
    const meta=document.createElement('div'); meta.className='meta';
    const b=document.createElement('b'); b.textContent=L.name; b.title='Double-click to rename';
    b.ondblclick=(e)=>{ e.stopPropagation(); const inp=document.createElement('input'); inp.className='rename'; inp.value=L.name;
      inp.onkeydown=(ev)=>{ if(ev.key==='Enter') inp.blur(); ev.stopPropagation(); };
      inp.onblur=()=>{ L.name=inp.value||L.name; refreshLayersUI(); }; meta.replaceChild(inp,b); inp.focus(); inp.select(); };
    const s=document.createElement('span'); s.textContent=`${L.blend} · ${L.opacity}%`;
    meta.appendChild(b); meta.appendChild(s);
    row.appendChild(vis); row.appendChild(th); row.appendChild(meta);
    row.onclick=()=>{ S.active=i; syncLayerControls(); render(); refreshLayersUI(); };
    row.ondragstart=(e)=>{ e.dataTransfer.setData('text/layer',i); };
    row.ondragover=(e)=>e.preventDefault();
    row.ondrop=(e)=>{ e.preventDefault(); const from=+e.dataTransfer.getData('text/layer'); const to=i;
      if(from===to) return; const [mv]=S.layers.splice(from,1); S.layers.splice(to,0,mv); S.active=to; pushHistory('Reorder layers'); render(); refreshLayersUI(); };
    el.appendChild(row);
  }
  syncLayerControls();
}
function syncLayerControls(){
  const L=activeLayer(); if(!L) return;
  $('#layer-opacity').value=L.opacity; $('#layer-blend').value=L.blend;
}

/* ---------- status ---------- */
function updateStatus(){
  $('#stat-doc').textContent = S.layers.length? `${S.w}×${S.h} · ${S.layers.length} layer${S.layers.length>1?'s':''} · ${activeLayer()?.name||''}` : 'No document';
  const s=S.selection;
  $('#stat-sel').textContent = s? `sel ${Math.round(s.w)}×${Math.round(s.h)} @ ${Math.round(s.x)},${Math.round(s.y)}` : '';
}

/* ---------- color / brush inputs ---------- */
function initSwatches(){
  const cols=['#000000','#ffffff','#ff3b30','#ff9500','#ffcc00','#34c759','#0a84ff','#bf5af2','#ff375f','#64d2ff','#30d158','#ffd60a','#ff9f0a','#ac8e68','#8e8e93','#48484a','#1c1c1e','#f5f5f7','#0a3d62','#7dcea0'];
  const el=$('#swatches'); el.innerHTML='';
  cols.forEach(c=>{ const d=document.createElement('div'); d.style.background=c; d.title=c;
    d.onclick=(e)=>{ if(e.shiftKey){ S.bg=c; syncColors(); } else { S.fg=c; syncColors(); } }; el.appendChild(d); });
}
function syncColors(){
  $('#fg-swatch').style.background=S.fg; $('#bg-swatch').style.background=S.bg;
  $('#fg-picker').value=toColorInput(S.fg); $('#bg-picker').value=toColorInput(S.bg);
  $('#hex-input').value=S.fg.toUpperCase();
}
function toColorInput(c){ if(/^#[0-9a-f]{6}$/i.test(c)) return c; const t=document.createElement('canvas').getContext('2d'); t.fillStyle=c; return t.fillStyle; }

/* ---------- adjustments (non-destructive preview via CSS filter, bake on Apply) ---------- */
function adjValues(){ return { b:+$('#adj-bright').value, c:+$('#adj-contrast').value, s:+$('#adj-sat').value, h:+$('#adj-hue').value, e:+$('#adj-exp').value, bl:+$('#adj-blur').value }; }
function adjFilterString(){
  const v=adjValues();
  return `brightness(${1+(v.b+v.e)/100}) contrast(${1+v.c/100}) saturate(${1+v.s/100}) hue-rotate(${v.h}deg) blur(${v.bl/2}px)`;
}
function updateAdjPreview(){
  const v=adjValues();
  $('#v-bright').textContent=v.b; $('#v-contrast').textContent=v.c; $('#v-sat').textContent=v.s;
  $('#v-hue').textContent=v.h; $('#v-exp').textContent=v.e; $('#v-blur').textContent=v.bl;
  if(v.b||v.c||v.s||v.h||v.e||v.bl) main.style.filter=adjFilterString(); else main.style.filter='';
}
function resetAdjSliders(){ ['adj-bright','adj-contrast','adj-sat','adj-hue','adj-exp','adj-blur'].forEach(id=>$('#'+id).value=id==='adj-hue'?0:(id==='adj-blur'?0:0)); updateAdjPreview(); }
function applyAdjBake(){
  const L=activeLayer(); if(!L) return;
  const v=adjValues();
  if(!v.b&&!v.c&&!v.s&&!v.h&&!v.e&&!v.bl){ toast('Nothing to apply'); return; }
  const f=adjFilterString();
  const lctx=L.canvas.getContext('2d');
  if(S.selection){
    const s=selRectOrFull();
    const sel=makeCanvas(s.w,s.h), sx=sel.getContext('2d');
    sx.filter=f; sx.drawImage(L.canvas,s.x,s.y,s.w,s.h,0,0,s.w,s.h);
    lctx.save(); lctx.filter='none'; lctx.clearRect(s.x,s.y,s.w,s.h); lctx.drawImage(sel,s.x,s.y); lctx.restore();
  } else {
    const t=makeCanvas(S.w,S.h), x=t.getContext('2d');
    x.filter=f; x.drawImage(L.canvas,0,0);
    L.canvas=t;
  }
  main.style.filter=''; resetAdjSliders(); pushHistory('Adjustments'); render(); refreshLayersUI(); toast('Adjustment applied');
}
function autoContrast(){
  const L=activeLayer(); if(!L) return;
  const r=selRectOrFull(); const img=L.canvas.getContext('2d').getImageData(r.x,r.y,r.w,r.h);
  let mn=255,mx=0; for(let i=0;i<img.data.length;i+=4){ const g=(img.data[i]+img.data[i+1]+img.data[i+2])/3; if(g<mn)mn=g; if(g>mx)mx=g; }
  if(mx<=mn){ toast('Already full contrast'); return; }
  const d=img.data; for(let i=0;i<d.length;i+=4){ for(let k=0;k<3;k++) d[i+k]=clamp((d[i+k]-mn)*255/(mx-mn),0,255); }
  L.canvas.getContext('2d').putImageData(img,r.x,r.y);
  pushHistory('Auto-contrast'); render(); refreshLayersUI();
}
function selRectOrFull(){ if(S.selection){ const s=S.selection; return {x:clamp(Math.round(s.x),0,S.w-1),y:clamp(Math.round(s.y),0,S.h-1),w:clamp(Math.round(s.w),1,S.w),h:clamp(Math.round(s.h),1,S.h)}; } return {x:0,y:0,w:S.w,h:S.h}; }

/* ---------- pixel filters ---------- */
function withPixels(fn,label){
  const L=activeLayer(); if(!L) return;
  const r=selRectOrFull();
  const ctx=L.canvas.getContext('2d');
  const img=ctx.getImageData(r.x,r.y,r.w,r.h);
  fn(img.data,r);
  ctx.putImageData(img,r.x,r.y);
  pushHistory(label||'Filter'); render(); refreshLayersUI();
}
function convFilter(kernel,label){
  const L=activeLayer(); if(!L) return;
  const r=selRectOrFull(); const ctx=L.canvas.getContext('2d');
  const src=ctx.getImageData(r.x,r.y,r.w,r.h), out=ctx.createImageData(r.w,r.h);
  const d=src.data,o=out.data,W=r.w,H=r.h;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let rr=0,gg=0,bb=0;
    for(let ky=-1;ky<=1;ky++)for(let kx=-1;kx<=1;kx++){
      const px=clamp(x+kx,0,W-1),py=clamp(y+ky,0,H-1);
      const w=kernel[(ky+1)*3+(kx+1)], idx=(py*W+px)*4;
      rr+=d[idx]*w; gg+=d[idx+1]*w; bb+=d[idx+2]*w;
    }
    const i=(y*W+x)*4; o[i]=clamp(rr,0,255); o[i+1]=clamp(gg,0,255); o[i+2]=clamp(bb,0,255); o[i+3]=d[i+3];
  }
  ctx.putImageData(out,r.x,r.y); pushHistory(label); render(); refreshLayersUI();
}
const Filters={
  gray(){ withPixels(d=>{ for(let i=0;i<d.length;i+=4){ const g=.299*d[i]+.587*d[i+1]+.114*d[i+2]; d[i]=d[i+1]=d[i+2]=g; } },'Grayscale'); },
  invert(){ withPixels(d=>{ for(let i=0;i<d.length;i+=4){ d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; } },'Invert'); },
  sepia(){ withPixels(d=>{ for(let i=0;i<d.length;i+=4){ const r=d[i],g=d[i+1],b=d[i+2];
    d[i]=clamp(.393*r+.769*g+.189*b,0,255); d[i+1]=clamp(.349*r+.686*g+.168*b,0,255); d[i+2]=clamp(.272*r+.534*g+.131*b,0,255); } },'Sepia'); },
  threshold(){ withPixels(d=>{ for(let i=0;i<d.length;i+=4){ const g=(d[i]+d[i+1]+d[i+2])/3>128?255:0; d[i]=d[i+1]=d[i+2]=g; } },'Threshold'); },
  blur(){ const L=activeLayer(); if(!L) return; const t=makeCanvas(S.w,S.h),x=t.getContext('2d'); x.filter='blur(3px)'; x.drawImage(L.canvas,0,0); L.canvas.getContext('2d').clearRect(0,0,S.w,S.h); L.canvas.getContext('2d').drawImage(t,0,0); pushHistory('Blur'); render(); refreshLayersUI(); },
  sharpen(){ convFilter([0,-1,0,-1,5,-1,0,-1,0],'Sharpen'); },
  emboss(){ convFilter([-2,-1,0,-1,1,1,0,1,2],'Emboss'); },
  vignette(){ const L=activeLayer(); if(!L) return; const x=L.canvas.getContext('2d');
    const g=x.createRadialGradient(S.w/2,S.h/2,Math.min(S.w,S.h)*.35,S.w/2,S.h/2,Math.max(S.w,S.h)*.75);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,.55)');
    x.save(); if(S.selection){ const s=S.selection; x.beginPath(); x.rect(s.x,s.y,s.w,s.h); x.clip(); }
    x.fillStyle=g; x.fillRect(0,0,S.w,S.h); x.restore(); pushHistory('Vignette'); render(); refreshLayersUI(); },
};

/* ---------- transforms ---------- */
function transformLayer(fn,label){
  const L=activeLayer(); if(!L) return;
  const t=copyCanvas(L.canvas), x=L.canvas.getContext('2d');
  x.save(); x.clearRect(0,0,S.w,S.h); fn(x); x.drawImage(t,0,0); x.restore();
  pushHistory(label); render(); refreshLayersUI();
}
function flipLayerH(){ transformLayer(x=>{ x.translate(S.w,0); x.scale(-1,1); },'Flip layer H'); }
function flipLayerV(){ transformLayer(x=>{ x.translate(0,S.h); x.scale(1,-1); },'Flip layer V'); }
function rotLayer90(){ const L=activeLayer(); if(!L) return; const t=copyCanvas(L.canvas); const x=L.canvas.getContext('2d');
  x.save(); x.clearRect(0,0,S.w,S.h); x.translate(S.w/2,S.h/2); x.rotate(Math.PI/2); x.drawImage(t,-S.w/2,-S.h/2); x.restore();
  pushHistory('Rotate layer 90'); render(); refreshLayersUI(); }
function rotLayer180(){ const L=activeLayer(); if(!L) return; const t=copyCanvas(L.canvas); const x=L.canvas.getContext('2d');
  x.save(); x.clearRect(0,0,S.w,S.h); x.translate(S.w,S.h); x.rotate(Math.PI); x.drawImage(t,0,0); x.restore();
  pushHistory('Rotate 180'); render(); refreshLayersUI(); }
function transformCanvas(mode){
  const oldW=S.w,oldH=S.h;
  let nw=oldW,nh=oldH;
  if(mode==='rot90'||mode==='rot90ccw'){ nw=oldH; nh=oldW; }
  const newLayers=S.layers.map(L=>{ const c=makeCanvas(nw,nh),x=c.getContext('2d');
    x.save();
    if(mode==='rot90'){ x.translate(nw/2,nh/2); x.rotate(Math.PI/2); x.drawImage(L.canvas,-oldW/2,-oldH/2); }
    else if(mode==='rot90ccw'){ x.translate(nw/2,nh/2); x.rotate(-Math.PI/2); x.drawImage(L.canvas,-oldW/2,-oldH/2); }
    else if(mode==='fliph'){ x.translate(nw,0); x.scale(-1,1); x.drawImage(L.canvas,0,0); }
    else if(mode==='flipv'){ x.translate(0,nh); x.scale(1,-1); x.drawImage(L.canvas,0,0); }
    x.restore(); return {...L,canvas:c}; });
  S.w=nw; S.h=nh; S.layers=newLayers; syncCanvasSize(); pushHistory('Transform canvas'); render(); refreshLayersUI();
}
function resizeCanvas(nw,nh,anchor){
  nw=clamp(Math.round(nw),1,8000); nh=clamp(Math.round(nh),1,8000);
  let ox=0,oy=0;
  if(anchor==='center'){ ox=(nw-S.w)/2; oy=(nh-S.h)/2; }
  else if(anchor==='top-right'){ ox=nw-S.w; }
  else if(anchor==='bottom-left'){ oy=nh-S.h; }
  else if(anchor==='bottom-right'){ ox=nw-S.w; oy=nh-S.h; }
  S.layers.forEach(L=>{ const c=makeCanvas(nw,nh); c.getContext('2d').drawImage(L.canvas,ox,oy); L.canvas=c; });
  S.w=nw; S.h=nh; syncCanvasSize(); pushHistory('Canvas size'); render(); refreshLayersUI();
}
function cropToRect(r){
  r={x:clamp(Math.round(r.x),0,S.w-1),y:clamp(Math.round(r.y),0,S.h-1),w:clamp(Math.round(r.w),1,S.w),h:clamp(Math.round(r.h),1,S.h)};
  if(r.x+r.w>S.w) r.w=S.w-r.x; if(r.y+r.h>S.h) r.h=S.h-r.y;
  if(r.w<2||r.h<2){ toast('Crop area too small'); return; }
  S.layers.forEach(L=>{ const c=makeCanvas(r.w,r.h); c.getContext('2d').drawImage(L.canvas,r.x,r.y,r.w,r.h,0,0,r.w,r.h); L.canvas=c; });
  S.w=r.w; S.h=r.h; S.selection=null; S.cropRect=null; S.preview=null;
  syncCanvasSize(); pushHistory('Crop'); render(); refreshLayersUI(); toast(`Cropped to ${r.w}×${r.h}`);
}

/* ---------- brush engine ---------- */
function hexToRgb(h){ const c=document.createElement('canvas').getContext('2d'); c.fillStyle=h; const m=c.fillStyle.match(/rgba?\(([^)]+)\)/);
  if(m){ const p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2]}; }
  const v=parseInt(c.fillStyle.slice(1),16); return {r:(v>>16)&255,g:(v>>8)&255,b:v&255}; }
function strokeSegment(ctx,x0,y0,x1,y1,color,size,opacity,hardness,erase){
  ctx.save();
  ctx.globalAlpha=opacity/100;
  ctx.lineCap='round'; ctx.lineJoin='round';
  if(erase) ctx.globalCompositeOperation='destination-out';
  if(hardness>=99){
    ctx.strokeStyle=color; ctx.lineWidth=size;
    ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
  } else {
    // soft stamp along segment
    const rgb=erase?{r:0,g:0,b:0}:hexToRgb(color);
    const dist=Math.hypot(x1-x0,y1-y0), step=Math.max(1,size/8);
    const n=Math.max(1,Math.ceil(dist/step));
    const soft=1-hardness/100;
    for(let i=0;i<=n;i++){
      const t=i/n, x=x0+(x1-x0)*t, y=y0+(y1-y0)*t;
      const rad=size/2;
      const g=ctx.createRadialGradient(x,y,0,x,y,rad);
      const inner=erase?`rgba(0,0,0,1)`:`rgba(${rgb.r},${rgb.g},${rgb.b},1)`;
      const mid=erase?`rgba(0,0,0,${.6*(1-soft*.5)})`:`rgba(${rgb.r},${rgb.g},${rgb.b},${.55*(1-soft*.4)})`;
      g.addColorStop(0,inner); g.addColorStop(1-hardness/100*.9,mid); g.addColorStop(1,erase?'rgba(0,0,0,0)':`rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,rad,0,Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}

/* ---------- flood fill ---------- */
function floodFill(cnvs,sx,sy,hex,tol){
  sx=Math.round(sx); sy=Math.round(sy);
  if(sx<0||sy<0||sx>=cnvs.width||sy>=cnvs.height) return;
  const ctx=cnvs.getContext('2d',{willReadFrequently:true});
  const img=ctx.getImageData(0,0,cnvs.width,cnvs.height), d=img.data;
  const si=(sy*cnvs.width+sx)*4, tr=d[si],tg=d[si+1],tb=d[si+2],ta=d[si+3];
  const {r:fr,g:fg,b:fb}=hexToRgb(hex);
  if(Math.abs(tr-fr)<=tol&&Math.abs(tg-fg)<=tol&&Math.abs(tb-fb)<=tol&&ta===255) return;
  const match=(i)=>Math.abs(d[i]-tr)<=tol&&Math.abs(d[i+1]-tg)<=tol&&Math.abs(d[i+2]-tb)<=tol&&Math.abs(d[i+3]-ta)<=tol;
  const stack=[[sx,sy]], seen=new Uint8Array(cnvs.width*cnvs.height);
  while(stack.length){
    const [x,y]=stack.pop(); if(x<0||y<0||x>=cnvs.width||y>=cnvs.height) continue;
    const idx=y*cnvs.width+x; if(seen[idx]) continue; seen[idx]=1;
    const i=idx*4; if(!match(i)) continue;
    d[i]=fr; d[i+1]=fg; d[i+2]=fb; d[i+3]=255;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    if(stack.length>900000) break;
  }
  ctx.putImageData(img,0,0);
}

/* ---------- selection clipboard ops ---------- */
function getSelectionCanvas(){
  const s=S.selection; const L=activeLayer(); if(!s||!L) return null;
  const c=makeCanvas(s.w,s.h); c.getContext('2d').drawImage(L.canvas,s.x,s.y,s.w,s.h,0,0,s.w,s.h); return c;
}
function clearSelection(){
  const L=activeLayer(); if(!L||!S.selection) return;
  L.canvas.getContext('2d').clearRect(S.selection.x,S.selection.y,S.selection.w,S.selection.h);
  pushHistory('Delete selection'); render();
}
function doCopy(cut){
  const c=getSelectionCanvas(); if(!c){ toast('Make a selection first (M)'); return; }
  S.clipboard=c;
  if(cut){ clearSelection(); S.selection=null; pushHistory('Cut'); render(); toast('Cut to clipboard'); }
  else toast('Copied');
}
function doPaste(){
  if(!S.clipboard){ toast('Clipboard empty'); return; }
  const c=copyCanvas(S.clipboard);
  const L=addLayer('Pasted',makeCanvas(S.w,S.h));
  const x=L.canvas.getContext('2d');
  x.drawImage(c,(S.w-c.width)/2,(S.h-c.height)/2);
  pushHistory('Paste'); render(); refreshLayersUI();
}

/* ---------- file I/O ---------- */
function loadImageFile(file,asLayer){
  if(!file||!file.type.startsWith('image/')){ toast('Not an image file'); return; }
  const url=URL.createObjectURL(file), img=new Image();
  img.onload=()=>{
    URL.revokeObjectURL(url);
    if(!asLayer){
      S.w=img.naturalWidth; S.h=img.naturalHeight;
      S.layers=[]; S.layerSeq=1;
      const c=makeCanvas(S.w,S.h); c.getContext('2d').drawImage(img,0,0);
      S.layers.push({id:uid(),name:file.name||'Image',visible:true,opacity:100,blend:'source-over',canvas:c});
      S.active=0; S.selection=null; syncCanvasSize(); zoomFit(); pushHistory('Open '+ (file.name||'image')); render(); refreshLayersUI();
    } else {
      const c=makeCanvas(S.w,S.h), x=c.getContext('2d');
      const s=Math.min(S.w/img.naturalWidth,S.h/img.naturalHeight,1);
      const dw=img.naturalWidth*s, dh=img.naturalHeight*s;
      x.drawImage(img,(S.w-dw)/2,(S.h-dh)/2,dw,dh);
      addLayer(file.name||'Placed',c); pushHistory('Place image'); render(); refreshLayersUI();
    }
    toast('Loaded '+img.naturalWidth+'×'+img.naturalHeight);
  };
  img.onerror=()=>toast('Could not read image'); img.src=url;
}
function exportImage(type){
  const c=makeCanvas(S.w,S.h), x=c.getContext('2d');
  if(type==='image/jpeg'){ x.fillStyle='#fff'; x.fillRect(0,0,S.w,S.h); }
  for(const L of S.layers){ if(!L.visible) continue; x.globalAlpha=L.opacity/100; x.globalCompositeOperation=L.blend; x.drawImage(L.canvas,0,0); }
  const a=document.createElement('a');
  a.download='photoshop-lite.'+(type==='image/png'?'png':type==='image/jpeg'?'jpg':'webp');
  a.href=c.toDataURL(type,.92); a.click(); toast('Exported '+a.download);
}
function saveProject(){
  const data={w:S.w,h:S.h,layers:S.layers.map(L=>({name:L.name,visible:L.visible,opacity:L.opacity,blend:L.blend,url:L.canvas.toDataURL()}))};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='photoshop-lite-project.json'; a.click();
}
function loadProjectFile(file){
  const r=new FileReader();
  r.onload=()=>{ try{
    const d=JSON.parse(r.result); S.w=d.w; S.h=d.h; syncCanvasSize();
    Promise.all(d.layers.map(l=>new Promise(res=>{ const img=new Image(); img.onload=()=>{ const c=makeCanvas(S.w,S.h); c.getContext('2d').drawImage(img,0,0,S.w,S.h); res({id:uid(),name:l.name,visible:l.visible,opacity:l.opacity,blend:l.blend,canvas:c}); }; img.src=l.url; })))
    .then(ls=>{ S.layers=ls; S.active=0; S.selection=null; pushHistory('Load project'); render(); refreshLayersUI(); zoomFit(); });
  }catch{ toast('Bad project file'); } };
  r.readAsText(file);
}

/* ---------- mouse / tools ---------- */
function evPos(e){ const r=main.getBoundingClientRect(); return { x:(e.clientX-r.left)/r.width*S.w, y:(e.clientY-r.top)/r.height*S.h }; }
function setTool(t){
  S.tool=t; S.preview=null; S.cropRect=null; hideTextEditor();
  $$('#toolbar .tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===t||(t.startsWith('shape')&&b.dataset.tool===t)));
  const names={move:'Move (drag layer / selection)',select:'Rect select — drag',brush:'Brush — drag to paint',eraser:'Eraser',fill:'Bucket — click to fill',gradient:'Gradient — drag',eyedropper:'Pick color — click',text:'Text — click to type', 'shape-rect':'Rectangle — drag (Shift=square)','shape-ellipse':'Ellipse — drag (Shift=circle)','shape-line':'Line — drag',crop:'Crop — drag then Enter',hand:'Hand — drag to pan',zoom:'Zoom — click in, Alt+click out'};
  $('#tool-name').textContent=t.replace('shape-','').replace(/^\w/,c=>c.toUpperCase());
  updateToolOptions(names[t]||t);
}
function updateToolOptions(hint){
  const el=$('#tool-options'); el.innerHTML='';
  const mk=(html)=>{ const s=document.createElement('span'); s.innerHTML=html; el.appendChild(s); return s; };
  mk(`<span style="color:#8f8f99">${hint}</span>`);
  if(S.tool==='crop'){ const b=document.createElement('button'); b.textContent='Apply crop ⏎'; b.onclick=()=>{ if(S.cropRect) cropToRect(S.cropRect); }; el.appendChild(b);
    const c=document.createElement('button'); c.textContent='Cancel'; c.onclick=()=>{ S.cropRect=null; S.preview=null; }; el.appendChild(c); }
  if(S.tool.startsWith('shape')){ const l=document.createElement('label'); l.innerHTML=`Stroke <input id="opt-stroke" type="number" value="${S.shape.stroke}" min="0" max="50" style="width:52px">`;
    l.querySelector('input').oninput=(e)=>S.shape.stroke=+e.target.value; el.appendChild(l); }
}
function hideTextEditor(){ $('#text-editor').classList.add('hidden'); }

let panStart=null;
main.addEventListener('mousedown',(e)=>{
  main.focus(); const p=evPos(e);
  if(S.spaceDown||S.tool==='hand'){ panStart={x:e.clientX,y:e.clientY,sl:scrollArea.scrollLeft,st:scrollArea.scrollTop}; return; }
  const L=activeLayer(); if(!L){ toast('Create a document first'); return; }
  S.drawing=true; S.startX=p.x; S.startY=p.y; S.lastX=p.x; S.lastY=p.y;
  const lc=L.canvas.getContext('2d');
  if(S.tool==='brush'||S.tool==='eraser'){
    lc.save();
    strokeSegment(lc,p.x,p.y,p.x,p.y,S.tool==='eraser'?'#000':S.fg,S.brush.size,S.brush.opacity,S.brush.hardness,S.tool==='eraser');
    lc.restore(); render();
  } else if(S.tool==='fill'){
    if(S.selection){ lc.save(); lc.fillStyle=S.fg; lc.fillRect(S.selection.x,S.selection.y,S.selection.w,S.selection.h); lc.restore(); }
    else floodFill(L.canvas,p.x,p.y,S.fg,S.fillTol);
    pushHistory('Paint bucket'); render(); refreshLayersUI(); S.drawing=false;
  } else if(S.tool==='eyedropper'){
    pickColor(p,e.altKey||e.shiftKey); S.drawing=false;
  } else if(S.tool==='text'){
    showTextEditor(p); S.drawing=false;
  } else if(S.tool==='select'||S.tool==='crop'||S.tool.startsWith('shape')||S.tool==='gradient'){
    S.preview={type:S.tool==='select'?'select':S.tool==='crop'?'crop':S.tool==='gradient'?'gradient':'shape',kind:S.tool==='shape-ellipse'?'ellipse':S.tool==='shape-line'?'line':'rect',x0:p.x,y0:p.y,x1:p.x,y1:p.y};
  } else if(S.tool==='move'){
    S.moveBackup=copyCanvas(L.canvas);
    if(S.selection && pointInSel(p)){
      S.selBackup=copyCanvas(L.canvas);
      S.floatSel=getSelectionCanvas();
      lc.clearRect(S.selection.x,S.selection.y,S.selection.w,S.selection.h);
      S.floatOff={x:S.selection.x,y:S.selection.y};
      render();
    } else { S.floatSel=null; }
  } else if(S.tool==='zoom'){
    setZoom(S.zoom*(e.altKey?1/1.25:1.25)); S.drawing=false;
  }
});
window.addEventListener('mousemove',(e)=>{
  const r=main.getBoundingClientRect();
  const inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
  if(inside){ const p=evPos(e); $('#stat-pos').textContent=`x: ${Math.round(p.x)} y: ${Math.round(p.y)}`; }
  if(panStart){ scrollArea.scrollLeft=panStart.sl-(e.clientX-panStart.x); scrollArea.scrollTop=panStart.st-(e.clientY-panStart.y); return; }
  if(!S.drawing) return;
  const p=inside?evPos(e):{x:clamp(S.lastX,0,S.w),y:clamp(S.lastY,0,S.h)};
  const L=activeLayer(); if(!L) return; const lc=L.canvas.getContext('2d');
  if(S.tool==='brush'||S.tool==='eraser'){
    strokeSegment(lc,S.lastX,S.lastY,p.x,p.y,S.tool==='eraser'?'#000':S.fg,S.brush.size,S.brush.opacity,S.brush.hardness,S.tool==='eraser');
    S.lastX=p.x; S.lastY=p.y; render();
  } else if(S.tool==='move'&&S.moveBackup){
    const dx=p.x-S.startX, dy=p.y-S.startY;
    if(S.floatSel&&S.selection){
      lc.clearRect(0,0,S.w,S.h); lc.drawImage(S.selBackup,0,0);
      lc.clearRect(S.selection.x,S.selection.y,S.selection.w,S.selection.h);
      const nx=S.floatOff.x+dx, ny=S.floatOff.y+dy;
      lc.drawImage(S.floatSel,nx,ny); render();
    } else {
      lc.clearRect(0,0,S.w,S.h); lc.drawImage(S.moveBackup,dx,dy); render();
    }
  } else if(S.preview){
    let x1=p.x,y1=p.y;
    if(e.shiftKey&&(S.tool.startsWith('shape')||S.tool==='select')){ const w=Math.min(Math.abs(x1-S.startX),Math.abs(y1-S.startY));
      x1=S.startX+Math.sign(x1-S.startX||1)*w; y1=S.startY+Math.sign(y1-S.startY||1)*(S.tool==='shape-line'?y1-S.startY:w); }
    S.preview.x1=x1; S.preview.y1=y1;
  }
});
window.addEventListener('mouseup',(e)=>{
  panStart=null;
  if(!S.drawing) return; S.drawing=false;
  const L=activeLayer();
  if(S.tool==='brush'){ pushHistory('Brush'); refreshLayersUI(); }
  else if(S.tool==='eraser'){ pushHistory('Eraser'); refreshLayersUI(); }
  else if(S.tool==='select'&&S.preview){
    const r=normRect(S.preview);
    S.selection=(r.w>3&&r.h>3)?{x:clamp(r.x,0,S.w),y:clamp(r.y,0,S.h),w:Math.min(r.w,S.w-r.x),h:Math.min(r.h,S.h-r.y)}:null;
    S.preview=null; updateStatus(); toast(S.selection?'Selected '+Math.round(S.selection.w)+'×'+Math.round(S.selection.h):'Selection cleared');
  }
  else if(S.tool==='crop'&&S.preview){
    const r=normRect(S.preview);
    if(r.w>5&&r.h>5){ S.cropRect={x:clamp(r.x,0,S.w),y:clamp(r.y,0,S.h),w:Math.min(r.w,S.w-r.x),h:Math.min(r.h,S.h-r.y)}; S.preview={type:'crop',...S.cropRect,x0:S.cropRect.x,y0:S.cropRect.y,x1:S.cropRect.x+S.cropRect.w,y1:S.cropRect.y+S.cropRect.h}; toast('Enter ⏎ to apply crop'); }
    else { S.cropRect=null; S.preview=null; }
  }
  else if(S.tool==='gradient'&&S.preview&&L){
    const p=S.preview, g=L.canvas.getContext('2d').createLinearGradient(p.x0,p.y0,p.x1,p.y1);
    g.addColorStop(0,S.fg); g.addColorStop(1,S.bg);
    const x=L.canvas.getContext('2d'); x.save(); x.fillStyle=g;
    if(S.selection){ x.beginPath(); x.rect(S.selection.x,S.selection.y,S.selection.w,S.selection.h); x.clip(); x.fillRect(S.selection.x,S.selection.y,S.selection.w,S.selection.h); }
    else x.fillRect(0,0,S.w,S.h);
    x.restore(); S.preview=null; pushHistory('Gradient'); render(); refreshLayersUI();
  }
  else if(S.tool.startsWith('shape')&&S.preview&&L){
    commitShape(L,S.preview); S.preview=null;
  }
  else if(S.tool==='move'&&S.moveBackup){
    if(S.floatSel&&S.selection){ const p=evPos(e);
      S.selection={x:clamp(S.floatOff.x+(p.x-S.startX),0,S.w-1),y:clamp(S.floatOff.y+(p.y-S.startY),0,S.h-1),w:S.selection.w,h:S.selection.h};
      S.floatSel=null; S.moveBackup=null; S.selBackup=null; pushHistory('Move selection');
    } else { S.moveBackup=null; pushHistory('Move layer'); }
    render(); refreshLayersUI();
  }
});
function pointInSel(p){ const s=S.selection; return s&&p.x>=s.x&&p.x<=s.x+s.w&&p.y>=s.y&&p.y<=s.y+s.h; }
function commitShape(L,p){
  const r=normRect(p), x=L.canvas.getContext('2d');
  x.save(); x.fillStyle=S.fg; x.strokeStyle=S.bg==='#ffffff'?'#000':S.bg; x.lineWidth=Math.max(1,S.shape.stroke);
  x.beginPath();
  if(p.kind==='rect'){ if(S.shape.fill) x.fillRect(r.x,r.y,r.w,r.h); if(S.shape.stroke>0) x.strokeRect(r.x,r.y,r.w,r.h); }
  else if(p.kind==='ellipse'){ x.ellipse(r.x+r.w/2,r.y+r.h/2,Math.max(1,r.w/2),Math.max(1,r.h/2),0,0,Math.PI*2); if(S.shape.fill) x.fill(); if(S.shape.stroke>0) x.stroke(); }
  else { x.moveTo(p.x0,p.y0); x.lineTo(p.x1,p.y1); x.lineWidth=Math.max(2,S.brush.size); x.strokeStyle=S.fg; x.stroke(); }
  x.restore(); pushHistory('Shape'); render(); refreshLayersUI();
}
function pickColor(p,toBg){
  const d=mctx.getImageData(clamp(Math.round(p.x),0,S.w-1),clamp(Math.round(p.y),0,S.h-1),1,1).data;
  const hex='#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(toBg){ S.bg=hex; } else { S.fg=hex; }
  syncColors(); toast((toBg?'Background ':'Foreground ')+hex);
}
/* text */
function showTextEditor(p){
  const ed=$('#text-editor'), inp=$('#text-input');
  const s=imgToScreen(p.x,p.y);
  ed.style.left=s.x+'px'; ed.style.top=s.y+'px';
  ed.classList.remove('hidden'); inp.value=''; inp.style.fontFamily=S.font.face; inp.style.fontSize=Math.max(10,S.font.size*S.zoom)+'px'; inp.style.color=S.fg;
  inp.focus(); ed.dataset.x=p.x; ed.dataset.y=p.y;
  inp.onkeydown=(ev)=>{ ev.stopPropagation();
    if(ev.key==='Enter'&&!ev.shiftKey){ ev.preventDefault(); commitText(); }
    if(ev.key==='Escape') hideTextEditor(); };
  inp.onblur=()=>{ if(!ed.classList.contains('hidden')&&inp.value.trim()) commitText(); };
}
function commitText(){
  const ed=$('#text-editor'), inp=$('#text-input');
  const txt=inp.value; if(!txt.trim()){ hideTextEditor(); return; }
  const L=activeLayer(); const x=L.canvas.getContext('2d');
  x.save(); x.fillStyle=S.fg; x.font=`${S.font.size}px "${S.font.face}", sans-serif`; x.textBaseline='top';
  const lines=txt.split('\n'); const bx=+ed.dataset.x, by=+ed.dataset.y;
  lines.forEach((ln,i)=>x.fillText(ln,bx,by+i*S.font.size*1.2));
  x.restore(); hideTextEditor(); pushHistory('Text'); render(); refreshLayersUI();
}

/* ---------- menus / actions ---------- */
function doAction(act){
  const m={ 'new':()=>$('#modal-new').classList.remove('hidden'),
    'open':()=>$('#file-open').click(), 'place':()=>{ const i=document.createElement('input'); i.type='file'; i.accept='image/*'; i.onchange=()=>loadImageFile(i.files[0],true); i.click(); },
    'export-png':()=>exportImage('image/png'), 'export-jpg':()=>exportImage('image/jpeg'), 'export-webp':()=>exportImage('image/webp'),
    'download-project':saveProject, 'load-project':()=>$('#file-project').click(),
    'undo':undo,'redo':redo,
    'cut':()=>doCopy(true),'copy':()=>doCopy(false),'paste':doPaste,
    'deselect':()=>{S.selection=null;S.preview=null;updateStatus();}, 'select-all':()=>{S.selection={x:0,y:0,w:S.w,h:S.h};updateStatus();},
    'fill-fg':()=>{ const L=activeLayer(); if(!L)return; const x=L.canvas.getContext('2d'); x.fillStyle=S.fg; if(S.selection) x.fillRect(S.selection.x,S.selection.y,S.selection.w,S.selection.h); else x.fillRect(0,0,S.w,S.h); pushHistory('Fill'); render(); refreshLayersUI(); },
    'clear':()=>{ const L=activeLayer(); if(!L)return; if(S.selection) clearSelection(); else { L.canvas.getContext('2d').clearRect(0,0,S.w,S.h); pushHistory('Clear'); render(); refreshLayersUI(); } },
    'resize-canvas':()=>{ $('#resize-w').value=S.w; $('#resize-h').value=S.h; $('#modal-resize').classList.remove('hidden'); },
    'fit-image':()=>{ const L=activeLayer(); if(!L)return; const t=copyCanvas(L.canvas); // scale layer content to fill canvas
      const x=L.canvas.getContext('2d'); x.clearRect(0,0,S.w,S.h); x.drawImage(t,0,0,S.w,S.h); pushHistory('Fit image'); render(); },
    'rotate-90':()=>transformCanvas('rot90'),'rotate-90-ccw':()=>transformCanvas('rot90ccw'),
    'flip-h-canvas':()=>transformCanvas('fliph'),'flip-v-canvas':()=>transformCanvas('flipv'),
    'layer-new':()=>{ addLayer(); pushHistory('New layer'); render(); refreshLayersUI(); },
    'layer-dup':()=>duplicateLayer(),'layer-delete':()=>deleteLayer(),
    'layer-merge':mergeDown,'layer-flatten':flatten,
    'layer-up':()=>moveLayer(S.active,1),'layer-down':()=>moveLayer(S.active,-1),
    'layer-flip-h':flipLayerH,'layer-flip-v':flipLayerV,
    'layer-rot-90':rotLayer90,'layer-rot-180':rotLayer180,
    'f-gray':Filters.gray,'f-invert':Filters.invert,'f-sepia':Filters.sepia,'f-threshold':Filters.threshold,
    'f-blur':Filters.blur,'f-sharpen':Filters.sharpen,'f-emboss':Filters.emboss,'f-vignette':Filters.vignette,
    'zoom-in':()=>setZoom(S.zoom*1.25),'zoom-out':()=>setZoom(S.zoom/1.25),
    'zoom-100':()=>setZoom(1,false),'zoom-fit':zoomFit,
    'toggle-grid':()=>{S.grid=!S.grid;toast('Grid '+(S.grid?'on':'off'));},
    'toggle-rulers':()=>{S.rulers=!S.rulers;drawRulers();},
    'adj-apply':applyAdjBake,'adj-reset':()=>{resetAdjSliders();main.style.filter='';},'adj-auto':autoContrast,
  };
  if(m[act]) m[act](); else toast('Unknown: '+act);
}

/* ---------- wiring ---------- */
function init(){
  initSwatches(); syncColors();
  newDocument(1280,800,'white',true);
  pushHistory('Open');
  setTool('move');

  // menus
  $$('#menubar .menu').forEach(m=>{
    m.querySelector('span').onclick=(e)=>{ e.stopPropagation(); const was=m.classList.contains('open'); $$('#menubar .menu').forEach(x=>x.classList.remove('open')); if(!was) m.classList.add('open'); };
    m.querySelectorAll('[data-act]').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); $$('#menubar .menu').forEach(x=>x.classList.remove('open')); doAction(b.dataset.act); });
  });
  document.addEventListener('click',()=>$$('#menubar .menu').forEach(x=>x.classList.remove('open')));
  $$('#quickbar [data-act], #sidebar [data-act], #panel-adjust [data-act]').forEach(b=>b.onclick=()=>doAction(b.dataset.act));
  $$('#toolbar .tool').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));

  // colors
  $('#fg-swatch').onclick=()=>$('#fg-picker').click(); $('#bg-swatch').onclick=()=>$('#bg-picker').click();
  $('#fg-picker').oninput=(e)=>{S.fg=e.target.value;syncColors();}; $('#bg-picker').oninput=(e)=>{S.bg=e.target.value;syncColors();};
  $('#swap-colors').onclick=()=>{ [S.fg,S.bg]=[S.bg,S.fg]; syncColors(); };
  $('#hex-input').onchange=(e)=>{ let v=e.target.value.trim(); if(!v.startsWith('#'))v='#'+v; if(/^#[0-9a-f]{6}$/i.test(v)){S.fg=v;syncColors();} else toast('Bad hex'); };

  // brush
  $('#brush-size').oninput=(e)=>{S.brush.size=+e.target.value;$('#brush-size-val').textContent=e.target.value;};
  $('#brush-opacity').oninput=(e)=>{S.brush.opacity=+e.target.value;$('#brush-op-val').textContent=e.target.value;};
  $('#brush-hardness').oninput=(e)=>{S.brush.hardness=+e.target.value;$('#brush-hard-val').textContent=e.target.value;};
  $('#fill-tolerance').oninput=(e)=>{S.fillTol=+e.target.value;$('#fill-tol-val').textContent=e.target.value;};
  $('#font-face').onchange=(e)=>S.font.face=e.target.value;
  $('#font-size').onchange=(e)=>S.font.size=clamp(+e.target.value||48,6,500);
  $('#shape-fill').onchange=(e)=>S.shape.fill=e.target.checked;
  $('#shape-stroke').onchange=(e)=>S.shape.stroke=+e.target.value||0;

  // layers controls
  $('#layer-opacity').oninput=(e)=>{ const L=activeLayer(); if(!L)return; L.opacity=+e.target.value; render(); refreshLayersUI(); };
  $('#layer-opacity').onchange=()=>pushHistory('Layer opacity');
  $('#layer-blend').onchange=(e)=>{ const L=activeLayer(); if(!L)return; L.blend=e.target.value; pushHistory('Blend mode'); render(); refreshLayersUI(); };

  // adjustments
  ['adj-bright','adj-contrast','adj-sat','adj-hue','adj-exp','adj-blur'].forEach(id=>$('#'+id).addEventListener('input',updateAdjPreview));

  // modals
  $$('#modal-new [data-preset]').forEach(b=>b.onclick=()=>{ const [w,h]=b.dataset.preset.split(',').map(Number); $('#new-w').value=w; $('#new-h').value=h; });
  $('#new-create').onclick=()=>{ newDocument(+$('#new-w').value,+$('#new-h').value,$('#new-bg').value); $('#modal-new').classList.add('hidden'); zoomFit(); };
  $('#new-cancel').onclick=()=>$('#modal-new').classList.add('hidden');
  $('#resize-apply').onclick=()=>{ resizeCanvas(+$('#resize-w').value,+$('#resize-h').value,$('#resize-anchor').value); $('#modal-resize').classList.add('hidden'); };
  $('#resize-cancel').onclick=()=>$('#modal-resize').classList.add('hidden');

  // files
  $('#file-open').onchange=(e)=>{ if(e.target.files[0]) loadImageFile(e.target.files[0],false); e.target.value=''; };
  $('#file-project').onchange=(e)=>{ if(e.target.files[0]) loadProjectFile(e.target.files[0]); e.target.value=''; };
  window.addEventListener('dragover',(e)=>e.preventDefault());
  window.addEventListener('drop',(e)=>{ e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f){ if(f.type==='application/json') loadProjectFile(f); else loadImageFile(f,e.shiftKey); } });

  // zoom wheel + pan
  scrollArea.addEventListener('wheel',(e)=>{ if(e.ctrlKey||e.metaKey){ e.preventDefault(); setZoom(S.zoom*(e.deltaY<0?1.1:1/1.1)); } },{passive:false});

  // keyboard
  window.addEventListener('keydown',(e)=>{
    const tag=(e.target.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea'||tag==='select'){ if(e.key==='Escape') e.target.blur(); return; }
    const mod=e.ctrlKey||e.metaKey;
    if(e.key===' ') { S.spaceDown=true; e.preventDefault(); return; }
    if(mod&&e.key.toLowerCase()==='n'&&e.shiftKey){ e.preventDefault(); doAction('layer-new'); return; }
    if(mod&&e.key.toLowerCase()==='n'){ e.preventDefault(); doAction('new'); return; }
    if(mod&&e.key.toLowerCase()==='o'){ e.preventDefault(); doAction('open'); return; }
    if(mod&&e.key.toLowerCase()==='s'){ e.preventDefault(); doAction('export-png'); return; }
    if(mod&&e.key.toLowerCase()==='z'&&!e.shiftKey){ e.preventDefault(); undo(); return; }
    if((mod&&e.key.toLowerCase()==='y')||(mod&&e.shiftKey&&e.key.toLowerCase()==='z')){ e.preventDefault(); redo(); return; }
    if(mod&&e.key.toLowerCase()==='e'){ e.preventDefault(); mergeDown(); return; }
    if(mod&&e.key.toLowerCase()==='a'){ e.preventDefault(); doAction('select-all'); return; }
    if(mod&&e.key.toLowerCase()==='d'){ e.preventDefault(); doAction('deselect'); return; }
    if(mod&&e.key.toLowerCase()==='x'){ e.preventDefault(); doCopy(true); return; }
    if(mod&&e.key.toLowerCase()==='c'&&!e.altKey){ e.preventDefault(); doCopy(false); return; }
    if(mod&&e.key.toLowerCase()==='v'){ e.preventDefault(); doPaste(); return; }
    if(mod&&(e.key==='+'||e.key==='=')){ e.preventDefault(); setZoom(S.zoom*1.2); return; }
    if(mod&&e.key==='-'){ e.preventDefault(); setZoom(S.zoom/1.2); return; }
    if(mod&&e.key==='0'){ e.preventDefault(); zoomFit(); return; }
    if(mod&&e.key==='1'){ e.preventDefault(); setZoom(1,false); return; }
    if(e.key==='Delete'||e.key==='Backspace'){ if(S.tool!=='text'){ doAction('clear'); } return; }
    if(e.key==='Enter'&&S.tool==='crop'&&S.cropRect){ cropToRect(S.cropRect); return; }
    if(e.key==='Escape'){ S.selection=null; S.preview=null; S.cropRect=null; hideTextEditor(); return; }
    if(e.key==="'"){ doAction('toggle-grid'); return; }
    if(e.key==='['){ S.brush.size=clamp(S.brush.size-2,1,200); $('#brush-size').value=S.brush.size; $('#brush-size-val').textContent=S.brush.size; return; }
    if(e.key===']'){ S.brush.size=clamp(S.brush.size+2,1,200); $('#brush-size').value=S.brush.size; $('#brush-size-val').textContent=S.brush.size; return; }
    if(e.key.toLowerCase()==='x'&&!mod){ [S.fg,S.bg]=[S.bg,S.fg]; syncColors(); return; }
    const keys={v:'move',m:'select',b:'brush',e:'eraser',g:'fill',i:'eyedropper',t:'text',u:'shape-rect',c:'crop',h:'hand',z:'zoom'};
    const k=e.key.toLowerCase();
    if(!mod&&keys[k]){ if(k==='g'&&e.shiftKey){ setTool('gradient'); } else setTool(keys[k]); }
    if(!mod&&k==='u'&&e.shiftKey) setTool('shape-ellipse');
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='ArrowUp'||e.key==='ArrowDown'){
      const L=activeLayer(); if(!L) return; const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0, dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
      const st=e.shiftKey?10:1, x=L.canvas.getContext('2d'), t=copyCanvas(L.canvas);
      x.clearRect(0,0,S.w,S.h); x.drawImage(t,dx*st,dy*st); render(); e.preventDefault();
    }
  });
  window.addEventListener('keyup',(e)=>{ if(e.key===' ') S.spaceDown=false; });
  window.addEventListener('resize',()=>drawRulers());
}
document.addEventListener('DOMContentLoaded',init);
