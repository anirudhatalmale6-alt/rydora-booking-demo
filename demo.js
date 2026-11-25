/* Rydora booking demo: live fare calculator + booking-to-payment flow.
   SAMPLE RATES below are placeholders until Rydora confirms its own. */
(function(){
const CONFIG={
  baseFee:5.00,          // SAMPLE - per one-way ride
  perMile:2.00,          // SAMPLE - per mile, per rider
  minimum:16.00,         // from Rydora site: $16 total per one-way trip after discount
  weekendPct:15,         // SAMPLE - Saturday/Sunday adjustment
  stopFee:5.00,          // SAMPLE - per additional stop (plus the extra miles)
  seatFee:35.00,         // from Rydora site
  airportOne:110.00,     // from Rydora site
  airportGroup:210.00,   // from Rydora site
  groupDiscount:{1:0,2:0.05,3:0.10}, // from Rydora site
  maxMiles:60,           // SAMPLE - longer trips go to a manual quote
  minLeadHours:24        // from Rydora site
};
const BNA={label:'Nashville International Airport (BNA), 1 Terminal Dr, Nashville, TN',lon:-86.6782,lat:36.1263};
const CLARKSVILLE={lat:36.5298,lon:-87.3595};
const $=s=>document.querySelector(s);
const money=n=>'$'+n.toFixed(2);
const pickup=$('#pickup'),dest=$('#destination'),stops=$('#ridestops'),when=$('#when'),pkg=$('#package'),riders=$('#ridercount'),seats=$('#seatcount');
const panel=$('#farepanel');

/* ---- address search (demo uses free OpenStreetMap data; live site uses Google Maps) ---- */
function fmt(p){const pr=p.properties;const street=[pr.housenumber,pr.street].filter(Boolean).join(' ');
  return [pr.name&&pr.name!==street?pr.name:null,street||null,pr.city||pr.county,pr.state].filter(Boolean).join(', ');}
async function geocode(q){const u='https://photon.komoot.io/api/?limit=5&lat='+CLARKSVILLE.lat+'&lon='+CLARKSVILLE.lon+'&q='+encodeURIComponent(q);
  const r=await fetch(u);const j=await r.json();return j.features.filter(f=>f.properties.countrycode==='US').map(f=>({label:fmt(f),lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]}));}
function attachSearch(input){
  const box=document.createElement('div');box.className='ac-list';box.hidden=true;input.insertAdjacentElement('afterend',box);
  let t;input.addEventListener('input',()=>{delete input.dataset.lat;delete input.dataset.lon;clearTimeout(t);const q=input.value.trim();
    if(q.length<3){box.hidden=true;return}
    t=setTimeout(async()=>{try{const res=await geocode(q);box.innerHTML='';res.forEach(r=>{const b=document.createElement('button');b.type='button';b.textContent=r.label;
      b.onclick=()=>{input.value=r.label;input.dataset.lat=r.lat;input.dataset.lon=r.lon;box.hidden=true;calc()};box.appendChild(b)});box.hidden=!res.length}catch(e){box.hidden=true}},300)});
  input.addEventListener('blur',()=>setTimeout(()=>box.hidden=true,200));
}
attachSearch(pickup);attachSearch(dest);
async function point(input){if(input.dataset.lat)return{lat:+input.dataset.lat,lon:+input.dataset.lon,label:input.value};
  if(!input.value.trim())return null;const r=await geocode(input.value);if(!r.length)return null;
  input.dataset.lat=r[0].lat;input.dataset.lon=r[0].lon;return r[0];}

/* ---- route ---- */
async function route(pts){const coords=pts.map(p=>p.lon+','+p.lat).join(';');
  const r=await fetch('https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=false');const j=await r.json();
  if(j.code!=='Ok')throw Error('route');return{miles:j.routes[0].distance/1609.344,minutes:j.routes[0].duration/60};}

/* ---- time helpers (Central Time) ---- */
function centralDate(value){const p=value.split(/[-T:]/).map(Number);const target=Date.UTC(p[0],p[1]-1,p[2],p[3],p[4]);let t=target;
  for(let i=0;i<3;i++){const f=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
  t+=target-Date.UTC(+f.year,+f.month-1,+f.day,+f.hour,+f.minute)}return new Date(t)}
const blockedDates=new Set([]); // dates the driver closes, managed from the driver dashboard
function isWeekend(value){if(!value)return false;const d=new Date(value.slice(0,10)+'T12:00:00Z').getUTCDay();return d===0||d===6}

/* ---- fare ---- */
let quote=null,seq=0;
async function calc(){
  const my=++seq;const isAirport=pkg.value==='Clarksville to Nashville Airport (BNA)';
  if(isAirport&&!dest.value.trim()){dest.value=BNA.label;dest.dataset.lat=BNA.lat;dest.dataset.lon=BNA.lon;}
  if(!pickup.value.trim()||!dest.value.trim()){panel.innerHTML='<p class="fp-hint">Enter a pickup and destination to see your fare.</p>';quote=null;return}
  panel.innerHTML='<p class="fp-hint">Calculating your fare…</p>';
  try{
    const a=await point(pickup),b=await point(dest);if(my!==seq)return;
    if(!a||!b){panel.innerHTML='<p class="fp-warn">We could not find one of these addresses. Pick a suggestion from the list.</p>';quote=null;return}
    const stopLines=stops.value.split('\n').map(s=>s.trim()).filter(Boolean);const stopPts=[];
    for(const s of stopLines){const r=await geocode(s);if(r.length)stopPts.push(r[0]);}
    const rt=await route([a,...stopPts,b]);if(my!==seq)return;
    const n=Number(riders.value),seatN=Number(seats.value),lines=[];let oneWay;
    if(rt.miles>CONFIG.maxMiles){panel.innerHTML='<p class="fp-warn">This route is '+rt.miles.toFixed(1)+' miles, outside the automatic booking area. Please call (844) 931-7433 for a quote.</p>';quote=null;return}
    if(isAirport){oneWay=n===1?CONFIG.airportOne:CONFIG.airportGroup;lines.push([n===1?'Airport fare, 1 rider':'Airport group fare, '+n+' riders',oneWay]);}
    else{
      const perRider=CONFIG.baseFee+CONFIG.perMile*rt.miles+CONFIG.stopFee*stopPts.length;
      lines.push(['Base fare',CONFIG.baseFee]);lines.push([rt.miles.toFixed(1)+' miles × '+money(CONFIG.perMile),CONFIG.perMile*rt.miles]);
      if(stopPts.length)lines.push([stopPts.length+' additional stop'+(stopPts.length>1?'s':''),CONFIG.stopFee*stopPts.length]);
      let group=perRider*n;if(n>1){lines.push(['× '+n+' riders',perRider*(n-1)]);const disc=group*CONFIG.groupDiscount[n];lines.push(['Group discount ('+Math.round(CONFIG.groupDiscount[n]*100)+'% each)',-disc]);group-=disc;}
      oneWay=group;if(oneWay<CONFIG.minimum){lines.push(['Minimum fare adjustment',CONFIG.minimum-oneWay]);oneWay=CONFIG.minimum;}
      if(isWeekend(when.value)){const w=oneWay*CONFIG.weekendPct/100;lines.push(['Weekend adjustment ('+CONFIG.weekendPct+'%)',w]);oneWay+=w;}
    }
    let legs=1,label='One-way fare';if(pkg.value==='Round trip'){legs=2;label='Round trip (2 legs)';lines.push(['Return leg',oneWay]);}
    let total=oneWay*legs;if(seatN){lines.push([seatN+' RYDORA car seat'+(seatN>1?'s':'')+' × '+money(CONFIG.seatFee),CONFIG.seatFee*seatN]);total+=CONFIG.seatFee*seatN;}
    quote={total,miles:rt.miles,minutes:rt.minutes,lines,legs,recurring:pkg.value==='Recurring commute',a,b,stops:stopPts};
    panel.innerHTML='<div class="fp-top"><span>'+rt.miles.toFixed(1)+' miles · about '+Math.round(rt.minutes)+' min</span><span class="fp-total">'+money(total)+'</span></div>'+
      '<table>'+lines.map(l=>'<tr><td>'+l[0]+'</td><td>'+(l[1]<0?'−'+money(-l[1]):money(l[1]))+'</td></tr>').join('')+'<tr class="fp-sum"><td>'+(quote.recurring?'Price per one-way ride':'Total to pay now')+'</td><td>'+money(total)+'</td></tr></table>'+
      (quote.recurring?'<p class="fp-hint">Recurring commute: each ride is listed with its date and price before you pay.</p>':'')+
      '<p class="fp-hint">Your price is locked once you pay. No hidden fees.</p>';
  }catch(e){if(my===seq){panel.innerHTML='<p class="fp-warn">The fare could not be calculated right now. Please try again.</p>';quote=null}}
}
let ct;[pickup,dest,stops].forEach(el=>el.addEventListener('change',()=>{clearTimeout(ct);ct=setTimeout(calc,250)}));
[pkg,riders,seats,when].forEach(el=>el.addEventListener('change',calc));

/* ---- submit -> review -> pay ---- */
const pm=$('#paymodal');
$('#book').onsubmit=async e=>{e.preventDefault();
  const v=when.value;const t=v?centralDate(v):null;
  if(!t||!Number.isFinite(t.getTime())||!/:(00|30)$/.test(v)||blockedDates.has(v.slice(0,10))){when.setCustomValidity('Choose a pickup on the hour or half hour, on an available date.');when.reportValidity();when.setCustomValidity('');return}
  if(t-new Date()<CONFIG.minLeadHours*3600e3){when.setCustomValidity('Rides must be booked at least 24 hours ahead.');when.reportValidity();when.setCustomValidity('');return}
  if(!quote)await calc();if(!quote){panel.scrollIntoView({behavior:'smooth',block:'center'});return}
  const when12=t.toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  $('#pm-summary').innerHTML='<dl><dt>Rider</dt><dd>'+esc($('#ridername').value)+' · '+esc($('#rideremail').value)+'</dd><dt>Pickup</dt><dd>'+esc(pickup.value)+'</dd>'+
    (quote.stops.length?'<dt>Stops</dt><dd>'+quote.stops.map(s=>esc(s.label)).join('<br>')+'</dd>':'')+'<dt>Destination</dt><dd>'+esc(dest.value)+'</dd><dt>When</dt><dd>'+when12+' (Central)</dd><dt>Ride</dt><dd>'+esc(pkg.value)+' · '+riders.value+' rider(s)</dd></dl>'+
    '<p class="pm-total">'+(quote.recurring?'Per ride: ':'Total: ')+money(quote.total)+'</p>';
  $('#pm-step1').hidden=false;$('#pm-step2').hidden=true;pm.showModal();};
$('#pm-pay').onclick=()=>{const ref='RYD-'+Math.random().toString(36).slice(2,7).toUpperCase();$('#pm-ref').textContent=ref;$('#pm-amt').textContent=money(quote.total);
  $('#pm-step1').hidden=true;$('#pm-step2').hidden=false;};
$('#pm-close').onclick=()=>pm.close();$('#pm-close2').onclick=()=>pm.close();
function esc(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
calc();
})();
