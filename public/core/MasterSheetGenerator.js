import { renderStoryQR } from '../utils/QRGenerator.js';

const PRINT_DPI = 300;
const MIN_PRINT_SIDE = 2400;
const MAX_PRINT_SIDE = 5000;
const PDF_SOURCES = ['https://esm.sh/jspdf@2.5.2','https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'];

// Classic InkMotion is the safe/default output. Custom artwork layout is opt-in.
export const DEFAULT_LAYOUT = Object.freeze({version:2,qr:{placement:'outside',x:0.82,y:0.82,scale:0.135,background:'white'},frame:{preset:'classic',color:'#08080d',width:0.006,inset:0.018,autoColor:false},page:{mode:'legacy',bleed:0}});
const FRAME_PRESETS = new Set(['classic','none','minimal','editorial','technical','integrated']);
let pdfLibraryPromise;
const cloneLayout=(v=DEFAULT_LAYOUT)=>JSON.parse(JSON.stringify(v));

export function normalizeLayout(input){
  const base=cloneLayout(DEFAULT_LAYOUT);
  if(!input||typeof input!=='object')return base;
  const qr=input.qr||{},frame=input.frame||{},page=input.page||{};
  const clamp=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback;
  base.page.mode=page.mode==='artwork'?'artwork':'legacy';
  base.qr.placement=qr.placement==='inside'?'inside':'outside';
  base.qr.x=clamp(qr.x,0,.94,base.qr.x);
  base.qr.y=clamp(qr.y,0,.94,base.qr.y);
  base.qr.scale=clamp(qr.scale,.10,.22,base.qr.scale);
  base.qr.background=['white','soft','none'].includes(qr.background)?qr.background:'white';
  base.frame.preset=FRAME_PRESETS.has(frame.preset)?frame.preset:base.frame.preset;
  base.frame.color=/^#[0-9a-f]{6}$/i.test(frame.color||'')?frame.color:base.frame.color;
  // Decorative frames cannot become hairlines: print + tracking safety.
  base.frame.width=clamp(frame.width,.0045,.018,base.frame.width);
  base.frame.inset=clamp(frame.inset,.012,.055,base.frame.inset);
  base.frame.autoColor=Boolean(frame.autoColor);
  base.page.bleed=clamp(page.bleed,0,.05,0);
  return base;
}

async function loadPdfLibrary(){if(!pdfLibraryPromise){pdfLibraryPromise=(async()=>{let lastError;for(const source of PDF_SOURCES){try{const module=await import(source);const jsPDF=module.jsPDF||module.default?.jsPDF||module.default;if(typeof jsPDF!=='function')throw new Error('API PDF no disponible.');return jsPDF;}catch(error){lastError=error;}}throw new Error(`No se pudo cargar el generador PDF. ${lastError?.message||''}`.trim());})().catch(error=>{pdfLibraryPromise=null;throw error;});}return pdfLibraryPromise;}
function loadImage(source){return new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('No se pudo cargar la ilustración para crear la lámina.'));image.src=source;});}
function canvasToBlob(canvas,type,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo exportar la lámina.')),type,quality));}
function calculateOutputSize(width,height){const shortest=Math.min(width,height),longest=Math.max(width,height);const scale=Math.min(MAX_PRINT_SIDE/longest,Math.max(1,MIN_PRINT_SIDE/shortest));return{width:Math.round(width*scale),height:Math.round(height*scale)};}
function drawFiducialCorner(context,x,y,horizontal,vertical,frameWidth){const arm=frameWidth*4.2,thickness=Math.max(3,frameWidth*.8);context.fillRect(horizontal>0?x:x-arm,vertical>0?y:y-thickness,arm,thickness);context.fillRect(horizontal>0?x:x-thickness,vertical>0?y:y-arm,thickness,arm);}
function luminance(r,g,b){return .2126*r+.7152*g+.0722*b;}
function edgeAverageColor(context,rect){try{const points=[];for(let i=0;i<24;i++){const t=(i+.5)/24;points.push([rect.x+rect.width*t,rect.y+2],[rect.x+rect.width*t,rect.y+rect.height-3],[rect.x+2,rect.y+rect.height*t],[rect.x+rect.width-3,rect.y+rect.height*t]);}const sum=points.reduce((acc,[x,y])=>{const d=context.getImageData(Math.max(0,Math.round(x)),Math.max(0,Math.round(y)),1,1).data;acc[0]+=d[0];acc[1]+=d[1];acc[2]+=d[2];return acc;},[0,0,0]);const rgb=sum.map(v=>Math.round(v/points.length));const factor=luminance(...rgb)>125?.42:1.7;return `rgb(${rgb.map(v=>Math.max(0,Math.min(255,Math.round(v*factor)))).join(',')})`;}catch{return '#17171f';}}

function drawDecorativeFrame(context,content,shortest,frame){
  if(frame.preset==='none'||frame.preset==='classic')return;
  const fw=Math.max(5,Math.round(shortest*frame.width)),inset=Math.max(fw*1.8,Math.round(shortest*frame.inset)),x=content.x+inset,y=content.y+inset,width=content.width-inset*2,height=content.height-inset*2,color=frame.autoColor?edgeAverageColor(context,content):frame.color;
  context.save();context.strokeStyle=color;context.fillStyle=color;context.lineWidth=fw;
  if(frame.preset==='minimal')context.strokeRect(x,y,width,height);
  else if(frame.preset==='editorial'){context.strokeRect(x,y,width,height);const gap=fw*2.6;context.lineWidth=Math.max(2,fw*.55);context.strokeRect(x+gap,y+gap,width-gap*2,height-gap*2);}
  else if(frame.preset==='integrated'){context.setLineDash([fw*7,fw*3]);context.lineCap='round';context.strokeRect(x,y,width,height);}
  else if(frame.preset==='technical'){const arm=Math.max(shortest*.07,fw*6);[[x,y,1,1],[x+width,y,-1,1],[x,y+height,1,-1],[x+width,y+height,-1,-1]].forEach(([cx,cy,hx,vy])=>{context.beginPath();context.moveTo(cx,cy+vy*arm);context.lineTo(cx,cy);context.lineTo(cx+hx*arm,cy);context.stroke();});}
  context.restore();
}

// Decorative frames may vary, but these four compact high-contrast anchors stay stable.
// They preserve reliable edge structure for MindAR without forcing a heavy black box.
function drawTrackingSafetyCorners(context,content,shortest){
  const width=Math.max(5,Math.round(shortest*.0055));
  const inset=Math.max(width*2.5,Math.round(shortest*.014));
  const arm=Math.max(width*5.5,Math.round(shortest*.038));
  const x1=content.x+inset,y1=content.y+inset,x2=content.x+content.width-inset,y2=content.y+content.height-inset;
  context.save();
  context.fillStyle='#08080d';
  const corner=(x,y,h,v)=>{const hx=h>0?x:x-arm,hy=v>0?y:y-width,vx=h>0?x:x-width,vy=v>0?y:y-arm;context.fillRect(hx,hy,arm,width);context.fillRect(vx,vy,width,arm);};
  corner(x1,y1,1,1);corner(x2,y1,-1,1);corner(x1,y2,1,-1);corner(x2,y2,-1,-1);
  context.restore();
}

function resolveLayout(illustrationUrl,explicit){if(explicit)return normalizeLayout(explicit);const saved=window.__INKMOTION_LAYOUTS_BY_IMAGE?.[illustrationUrl];if(saved)return normalizeLayout(saved);const current=document.getElementById('author-preview')?.src;if(current&&current===illustrationUrl&&window.InkMotionLayoutConfig)return normalizeLayout(window.InkMotionLayoutConfig);return normalizeLayout(DEFAULT_LAYOUT);}

export default class MasterSheetGenerator{
async compose({illustrationUrl,publicUrl,title='InkMotion',layout}){const resolved=resolveLayout(illustrationUrl,layout);if(resolved.page.mode!=='artwork')return this.composeLegacy({illustrationUrl,publicUrl,title});return this.composeDesigned({illustrationUrl,publicUrl,title,layout:resolved});}

async composeDesigned({illustrationUrl,publicUrl,title,layout}){
  const illustration=await loadImage(illustrationUrl),output=calculateOutputSize(illustration.naturalWidth||illustration.width,illustration.naturalHeight||illustration.height),shortest=Math.min(output.width,output.height),qrSize=Math.round(shortest*layout.qr.scale),outside=layout.qr.placement==='outside',band=outside?Math.max(Math.round(shortest*.18),qrSize+Math.round(shortest*.035)):0,canvas=document.createElement('canvas');
  canvas.width=output.width;canvas.height=output.height+band;
  const context=canvas.getContext('2d',{alpha:false,willReadFrequently:layout.frame.autoColor});context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  const content={x:0,y:0,width:output.width,height:output.height};context.drawImage(illustration,0,0,output.width,output.height);
  drawDecorativeFrame(context,content,shortest,layout.frame);
  drawTrackingSafetyCorners(context,content,shortest);
  const qrCanvas=document.createElement('canvas');await renderStoryQR(qrCanvas,publicUrl,{width:qrSize,margin:3,errorCorrectionLevel:'H'});
  let qrX,qrY;
  if(outside){qrX=canvas.width-qrSize-Math.round(shortest*.035);qrY=output.height+Math.max(8,Math.round((band-qrSize)/2));context.fillStyle='#111118';context.font=`700 ${Math.max(18,Math.round(shortest*.018))}px Arial, sans-serif`;context.fillText('INKMOTION · EXPERIENCIA AR',Math.round(shortest*.035),output.height+Math.round(band*.44),canvas.width-qrSize-Math.round(shortest*.1));context.font=`500 ${Math.max(13,Math.round(shortest*.012))}px Arial, sans-serif`;context.fillStyle='#4b4b55';context.fillText(`${title}`.slice(0,72),Math.round(shortest*.035),output.height+Math.round(band*.64),canvas.width-qrSize-Math.round(shortest*.1));}
  else{qrX=Math.min(content.width-qrSize,Math.max(0,Math.round(layout.qr.x*content.width)));qrY=Math.min(content.height-qrSize,Math.max(0,Math.round(layout.qr.y*content.height)));if(layout.qr.background!=='none'){const pad=Math.max(6,Math.round(qrSize*.06));context.fillStyle=layout.qr.background==='soft'?'rgba(255,255,255,0.92)':'#fff';context.fillRect(qrX-pad,qrY-pad,qrSize+pad*2,qrSize+pad*2);}}
  context.drawImage(qrCanvas,qrX,qrY,qrSize,qrSize);
  const jpegDataUrl=canvas.toDataURL('image/jpeg',.96),imageBlob=await canvasToBlob(canvas,'image/jpeg',.96);
  return{canvas,imageBlob,imageUrl:URL.createObjectURL(imageBlob),jpegDataUrl,dpi:PRINT_DPI,layout,pageSizeMm:{width:canvas.width/PRINT_DPI*25.4,height:canvas.height/PRINT_DPI*25.4},contentRect:{x:0,y:0,width:content.width/canvas.width,height:content.height/canvas.height,targetAspect:canvas.height/canvas.width}};
}

async composeLegacy({illustrationUrl,publicUrl,title='InkMotion'}){const illustration=await loadImage(illustrationUrl),output=calculateOutputSize(illustration.naturalWidth||illustration.width,illustration.naturalHeight||illustration.height),shortest=Math.min(output.width,output.height),unit=shortest/80,sideMargin=Math.round(shortest*.06),topMargin=sideMargin,qrSize=Math.round(Math.min(420,Math.max(180,shortest*.135))),frameWidth=Math.max(5,Math.round(shortest*.006)),frameGap=Math.max(frameWidth*7,unit*.55),technicalBandHeight=Math.max(Math.round(shortest*.18),qrSize+Math.round(unit*3)),bottomMargin=Math.ceil(frameGap+technicalBandHeight),qrCanvas=document.createElement('canvas');await renderStoryQR(qrCanvas,publicUrl,{width:qrSize,margin:3,errorCorrectionLevel:'M'});const canvas=document.createElement('canvas');canvas.width=output.width+sideMargin*2;canvas.height=output.height+topMargin+bottomMargin;const context=canvas.getContext('2d',{alpha:false});context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.fillStyle='#f8f8f6';context.fillRect(0,0,canvas.width,canvas.height);const content={x:sideMargin,y:topMargin,width:output.width,height:output.height};context.fillStyle='#fff';context.fillRect(content.x,content.y,content.width,content.height);context.drawImage(illustration,content.x,content.y,content.width,content.height);const frame={x:content.x-frameGap,y:content.y-frameGap,width:content.width+frameGap*2,height:content.height+frameGap*2};context.strokeStyle='#08080d';context.lineWidth=frameWidth;context.strokeRect(frame.x,frame.y,frame.width,frame.height);context.fillStyle='#08080d';const fo=frameWidth*1.4,left=frame.x+frameWidth/2+fo,right=frame.x+frame.width-frameWidth/2-fo,top=frame.y+frameWidth/2+fo,bottom=frame.y+frame.height-frameWidth/2-fo;drawFiducialCorner(context,left,top,1,1,frameWidth);drawFiducialCorner(context,right,top,-1,1,frameWidth);drawFiducialCorner(context,left,bottom,1,-1,frameWidth);drawFiducialCorner(context,right,bottom,-1,-1,frameWidth);const footerTop=content.y+content.height+frameGap+frameWidth/2,brandY=footerTop+unit*1.05,textWidth=Math.max(unit*18,canvas.width-sideMargin*2-qrSize-unit*3);context.fillStyle='#08080d';context.font=`800 ${Math.max(26,Math.round(unit*1.35))}px Arial, sans-serif`;context.fillText('INKMOTION',sideMargin,brandY+unit*1.45,textWidth);context.fillStyle='#7657ed';context.font=`700 ${Math.max(15,Math.round(unit*.72))}px Arial, sans-serif`;context.fillText('LÁMINA MAESTRA · EXPERIENCIA AR',sideMargin,brandY+unit*2.8,textWidth);context.fillStyle='#34343d';context.font=`500 ${Math.max(17,Math.round(unit*.82))}px Arial, sans-serif`;context.fillText(`${title}`.slice(0,72),sideMargin,brandY+unit*4.35,textWidth);const qr={x:canvas.width-sideMargin-qrSize,y:footerTop+Math.max(unit,(technicalBandHeight-qrSize)/2),size:qrSize};context.fillStyle='#fff';context.fillRect(qr.x-unit*.55,qr.y-unit*.55,qr.size+unit*1.1,qr.size+unit*1.1);context.drawImage(qrCanvas,qr.x,qr.y,qr.size,qr.size);const jpegDataUrl=canvas.toDataURL('image/jpeg',.96),imageBlob=await canvasToBlob(canvas,'image/jpeg',.96);return{canvas,imageBlob,imageUrl:URL.createObjectURL(imageBlob),jpegDataUrl,dpi:PRINT_DPI,layout:normalizeLayout(DEFAULT_LAYOUT),pageSizeMm:{width:canvas.width/PRINT_DPI*25.4,height:canvas.height/PRINT_DPI*25.4},contentRect:{x:content.x/canvas.width,y:content.y/canvas.height,width:content.width/canvas.width,height:content.height/canvas.height,targetAspect:canvas.height/canvas.width}};}
async createPdf(jpegDataUrl,pageSizeMm){const jsPDF=await loadPdfLibrary(),orientation=pageSizeMm.width>pageSizeMm.height?'landscape':'portrait',pdf=new jsPDF({orientation,unit:'mm',format:[pageSizeMm.width,pageSizeMm.height],compress:true});pdf.addImage(jpegDataUrl,'JPEG',0,0,pageSizeMm.width,pageSizeMm.height,undefined,'FAST');return pdf.output('blob');}}
