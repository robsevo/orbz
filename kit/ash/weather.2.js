// WMO weather codes -> label + icon kind
const WMO={0:['Clear','sun'],1:['Mainly clear','sun'],2:['Partly cloudy','part'],3:['Overcast','cloud'],
45:['Fog','fog'],48:['Rime fog','fog'],51:['Light drizzle','rain'],53:['Drizzle','rain'],55:['Heavy drizzle','rain'],
61:['Light rain','rain'],63:['Rain','rain'],65:['Heavy rain','rain'],66:['Freezing rain','snow'],67:['Freezing rain','snow'],
71:['Light snow','snow'],73:['Snow','snow'],75:['Heavy snow','snow'],77:['Snow grains','snow'],
80:['Showers','rain'],81:['Showers','rain'],82:['Violent showers','storm'],85:['Snow showers','snow'],86:['Snow showers','snow'],
95:['Thunderstorm','storm'],96:['Storm + hail','storm'],99:['Storm + hail','storm']};
const wmo=c=>WMO[c]||['—','cloud'];
const DOW=['SUN','MON','TUE','WED','THU','FRI','SAT'];
const $=i=>document.getElementById(i);
const R=v=>Math.round(Number(v));                         // every number from the API, coerced
const deg=v=>Number.isFinite(Number(v)) ? R(v)+'°' : '--';

// F.3 (2026-09-23): the icons are drawn, not typed. The old glyphs (☀ ⛅ ☔) came from whatever
// emoji font the machine had, in its colours; these are line icons in his colour and the orb's
// greys, built with createElementNS - no markup string is ever parsed.
const NS='http://www.w3.org/2000/svg';
function el(tag, attrs, parent){
  const e=document.createElementNS(NS, tag);
  for(const k in attrs) e.setAttribute(k, attrs[k]);
  if(parent) parent.appendChild(e);
  return e;
}
const CLOUD='M7 19.5h10.2a4.1 4.1 0 0 0 .5-8.17A5.6 5.6 0 0 0 6.9 12.6 3.45 3.45 0 0 0 7 19.5z';
function icon(kind, night){
  const s=el('svg',{viewBox:'0 0 24 24',class:'ico','aria-hidden':'true'});
  const acc='var(--acc)', lit='var(--lit)';
  const sun=(cx,cy,r,ray)=>{
    const g=el('g',{stroke:acc,'stroke-width':1.6,'stroke-linecap':'round',fill:'none'},s);
    el('circle',{cx,cy,r,fill:acc,'fill-opacity':.28},g);
    for(let i=0;i<8;i++){ const a=i*Math.PI/4, r1=r+1.8, r2=r+1.8+ray;
      el('line',{x1:cx+Math.cos(a)*r1,y1:cy+Math.sin(a)*r1,x2:cx+Math.cos(a)*r2,y2:cy+Math.sin(a)*r2},g); }
  };
  const cloud=(dy)=>el('path',{d:CLOUD,transform:`translate(0 ${dy||0})`,fill:'rgba(194,194,196,.14)',stroke:lit,
                               'stroke-width':1.5,'stroke-linejoin':'round'},s);
  // a clear night is a moon, when the feed says it is night (Open-Meteo `is_day`, if requested)
  const moon=(cx,cy,r)=>el('path',{d:`M${cx+r*.35} ${cy-r}a${r} ${r} 0 1 0 ${r*.65} ${r*1.55}A${r*.8} ${r*.8} 0 0 1 ${cx+r*.35} ${cy-r}z`,
                                   fill:acc,'fill-opacity':.28,stroke:acc,'stroke-width':1.6,'stroke-linejoin':'round'},s);
  if(kind==='sun'){ if(night) moon(12,12,6.5); else sun(12,12,4.4,2.6); return s; }
  if(kind==='part'){ if(night) moon(8.6,8.4,4.2); else sun(8.6,8.4,3.1,1.7); cloud(1); return s; }
  if(kind==='fog'){
    const g=el('g',{stroke:lit,'stroke-width':1.6,'stroke-linecap':'round'},s);
    [[4,8,20],[6,12,18],[3,16,17],[8,20,21]].forEach(([a,y,b])=>el('line',{x1:a,y1:y,x2:b,y2:y},g));
    return s;
  }
  cloud(kind==='cloud'?0:-3.5);
  if(kind==='rain'){
    const g=el('g',{stroke:acc,'stroke-width':1.6,'stroke-linecap':'round'},s);
    [[9,19],[12.5,19],[16,19]].forEach(([x,y])=>el('line',{x1:x,y1:y,x2:x-1.4,y2:y+3},g));
  } else if(kind==='snow'){
    const g=el('g',{fill:acc},s);
    [[8.5,19.5],[12.5,21.5],[16.5,19.5]].forEach(([x,y])=>el('circle',{cx:x,cy:y,r:1.2},g));
  } else if(kind==='storm'){
    el('path',{d:'M13 15.5l-3 4.2h3l-1.6 3.8 4.4-5.4h-3l1.4-2.6z',fill:acc},s);
  }
  return s;
}
function node(cls, text, tag){
  const e=document.createElement(tag||'span'); e.className=cls;
  if(text!=null) e.textContent=text;
  return e;
}

let MODE='7-DAY', LAST=null;
window.setVariant=v=>{ MODE=v; if(LAST) render(LAST); else paintMode(); };
function paintMode(){
  const P=$('wx');
  P.classList.toggle('mode-now', MODE==='NOW');
  P.classList.toggle('mode-hourly', MODE==='HOURLY');
}

// F.3-std: five columns - DAY, icon, high, the day's range as a vertical bar against the week's,
// low. The chance of rain rides in the column's title (a medium widget has one strip, not two).
function week(d){
  const days=$('days'), dd=d.daily||{};
  days.replaceChildren();
  const n=Math.min(5,(dd.time||[]).length);
  if(!n) return;
  const lo=[], hi=[];
  for(let i=0;i<n;i++){ lo.push(Number(dd.temperature_2m_min[i])); hi.push(Number(dd.temperature_2m_max[i])); }
  const wmin=Math.min(...lo), wmax=Math.max(...hi), span=Math.max(1,wmax-wmin);
  for(let i=0;i<n;i++){
    const [lab,kind]=wmo(dd.weather_code[i]);
    const dt=new Date(dd.time[i]+'T12:00:00');
    const pp=R(dd.precipitation_probability_max?.[i]);
    const row=node('day'+(i===0?' today':''),null,'div');
    row.title=(i===0?'Today':DOW[dt.getDay()])+': '+lab+(Number.isFinite(pp)?', '+pp+'% rain':'');
    row.appendChild(node('n', DOW[dt.getDay()]));
    row.appendChild(icon(kind));
    row.appendChild(node('h', deg(hi[i])));
    const rng=node('rng',null,'span'), bar=document.createElement('i');
    bar.style.bottom=((lo[i]-wmin)/span*100).toFixed(1)+'%';
    bar.style.top=((wmax-hi[i])/span*100).toFixed(1)+'%';
    rng.appendChild(bar); row.appendChild(rng);
    row.appendChild(node('l', deg(lo[i])));
    days.appendChild(row);
  }
}
function hours(d){
  const box=$('hours'), h=d.hourly||{};
  box.replaceChildren();
  if(!h.time) return;
  const i0=h.time.findIndex(t=>new Date(t)>=new Date(Date.now()-3600e3));
  const s=Math.max(0,i0);
  for(let i=s;i<Math.min(s+5,h.time.length);i++){      // five: the strip's columns
    const dt=new Date(h.time[i]);
    const [lab,kind]=wmo(h.weather_code[i]);
    const col=node('hr'+(i===s?' first':''),null,'div'); col.title=lab;
    col.appendChild(node('n', i===s ? 'NOW' : String(dt.getHours()).padStart(2,'0')));
    col.appendChild(icon(kind, h.is_day?.[i]===0));
    col.appendChild(node('h', deg(h.temperature_2m[i])));
    const pp=R(h.precipitation_probability?.[i])||0;
    col.appendChild(node('p'+(pp>=20?' wet':''), pp+'%'));
    box.appendChild(col);
  }
}
function today(d){
  const box=$('today'), dd=d.daily||{};
  box.replaceChildren();
  const stat=(v,k)=>{ const r=node('row',null,'div'); r.appendChild(node('k',k)); r.appendChild(node('v',v)); box.appendChild(r); };
  stat(deg(dd.temperature_2m_max?.[0]),'HIGH');
  stat(deg(dd.temperature_2m_min?.[0]),'LOW');
  const pp=R(dd.precipitation_probability_max?.[0]);
  stat(Number.isFinite(pp)?pp+'%':'--','RAIN');
  const w=R(d.current?.wind_speed_10m);
  stat(Number.isFinite(w)?w+' km/h':'--','WIND');
}
function render(d){
  paintMode();
  if(MODE==='NOW') today(d);
  else if(MODE==='HOURLY') hours(d);
  else week(d);
}

let LAST_OK='';          // when a reading last actually arrived, for the unavailable state

window.orb?.onWeather(d=>{
  const err=$('err'), P=$('wx');
  if(d.error){
    // FRESHNESS, not just failure (PLAN 13.2). The handler returns here, so `upd` keeps
    // whatever time it last showed — a panel reading "NO DATA" above a clock from twenty
    // minutes ago invites exactly the wrong conclusion, which is that the number beside it is
    // current. Say how old the last good reading is, or say there has not been one.
    err.hidden=false;
    err.textContent='NO DATA: '+d.error
      + (LAST_OK ? ' · last good '+LAST_OK : ' · nothing yet this session');
    err.title=err.textContent;
    $('upd').textContent=LAST_OK||'--:--';
    // with a last good reading the hero stays, dimmed, and the reason replaces the forecast;
    // with none, the whole panel says the weather is unavailable and why
    P.classList.toggle('stale', !!LAST);
    P.classList.toggle('none', !LAST);
    if(!LAST){ $('waitt').textContent='Weather is unavailable'; $('why').textContent=err.textContent; }
    return;
  }
  err.hidden=true;
  P.classList.remove('stale','none');
  $('city').textContent=String(d.loc?.city||'WEATHER').toUpperCase();
  const c=d.current||{}, [lab,kind]=wmo(c.weather_code);
  $('temp').textContent=Number.isFinite(Number(c.temperature_2m)) ? R(c.temperature_2m) : '--';
  $('cond').textContent=lab;
  $('icon').replaceChildren(icon(kind, c.is_day===0));
  const meta=$('meta'); meta.replaceChildren();
  const line=(k,v)=>{ const s=node('',null); s.appendChild(node('',k,'b')); s.appendChild(document.createTextNode(v)); meta.appendChild(s); };
  line('FEELS', deg(c.apparent_temperature));
  line('HUM', (R(c.relative_humidity_2m)||0)+'%');
  // two lines fit under the condition; wind is in the title, and on the NOW face
  meta.title='feels like '+deg(c.apparent_temperature)+', humidity '+(R(c.relative_humidity_2m)||0)+'%, wind '+R(c.wind_speed_10m)+' km/h';
  LAST_OK=new Date().toTimeString().slice(0,5);
  $('upd').textContent=LAST_OK;

  LAST=d; render(d);
});
