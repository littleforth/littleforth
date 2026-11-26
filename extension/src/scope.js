// scope.js - plot values from the board over time: a register, a VARIABLE, a
// register's bit field (REG.FIELD), or any Forth phrase that leaves one number.
// The board is read as fast as the link allows (about 20 times a second) while it
// is idle; the page keeps the last minute and draws it.
'use strict';
const PD = require('./periphdata');
const { esc, nonce } = require('./views');

const COLORS = ['#f5c542', '#4fc1ff', '#ff6b8b', '#7bd88f', '#c792ea', '#ff9e64'];

// What to read for a name: {phrase, label, mask, shift} or {error}
function resolve(text, ix, board) {
  const t = text.trim();
  const c = ix.classify(t);
  if (c.kind === 'register') {
    const d = PD.load(board), p = d && d.byName.get(c.periph.name), r = p && p.regs.find(x => x.name === c.reg.name);
    if (r && r.changesOnRead) return { error: `${t} changes when it is read: plotting it would disturb the program` };
    return { phrase: `${t} @`, label: t.toUpperCase() };
  }
  // REG.FIELD: PERIPH.REG.FIELD
  const m = /^([A-Za-z0-9_]+\.[A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(t);
  if (m) {
    const cr = ix.classify(m[1]);
    const d = PD.load(board);
    const p = cr.kind === 'register' && d && d.byName.get(cr.periph.name);
    const r = p && p.regs.find(x => x.name === cr.reg.name);
    const f = r && r.fields.find(x => x.name.toUpperCase() === m[2].toUpperCase());
    if (f) {
      if (r.changesOnRead) return { error: `${m[1]} changes when it is read` };
      return { phrase: `${m[1]} @`, label: t.toUpperCase(), shift: f.lsb, mask: f.width >= 32 ? 0xFFFFFFFF : (1 << f.width) - 1 };
    }
  }
  if (c.kind === 'word' && /VARIABLE/.test(c.def.stack)) return { phrase: `${t} @`, label: t.toUpperCase() };
  return { phrase: t, label: t };
}

function pageHtml() {
  const n = nonce();
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
html,body{height:100%;margin:0}body{display:flex;flex-direction:column;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
.bar{display:flex;gap:8px;align-items:center;padding:8px 12px;flex-wrap:wrap;border-bottom:1px solid var(--vscode-widget-border,transparent)}
input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:3px 6px;font-family:var(--vscode-editor-font-family);width:18em}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;padding:4px 10px;cursor:pointer;border-radius:2px}
.tr{display:flex;align-items:center;gap:6px;font-family:var(--vscode-editor-font-family);font-size:12px;padding:2px 8px;border-radius:10px;background:var(--vscode-textCodeBlock-background)}
.tr i{width:10px;height:3px;display:inline-block}.tr b{font-weight:normal;cursor:pointer;opacity:.6}.tr .v{min-width:5em;text-align:right;font-variant-numeric:tabular-nums}
#err{color:var(--vscode-errorForeground)}.meta{color:var(--vscode-descriptionForeground);font-size:12px}
canvas{flex:1;width:100%;min-height:200px}
</style></head><body>
<div class="bar"><input id="add" placeholder="register, VARIABLE, REG.FIELD or a Forth phrase"><button id="go">Plot</button>
<button id="pause">Pause</button><span class="meta" id="rate"></span><span id="err"></span></div>
<div class="bar" id="traces"></div>
<canvas id="c"></canvas>
<script nonce="${n}">
const vs=acquireVsCodeApi(),C=${JSON.stringify(COLORS)};
let traces=[],data=[],paused=false,span=20000,count=0,t0=Date.now();
const $=id=>document.getElementById(id);
$('go').onclick=()=>{const v=$('add').value.trim();if(v){vs.postMessage({add:v});$('add').value='';}};
$('add').onkeydown=e=>{if(e.key==='Enter')$('go').click();};
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Run':'Pause';vs.postMessage({paused});};
function chips(){$('traces').innerHTML=traces.map((t,i)=>'<span class="tr"><i style="background:'+C[i%C.length]+'"></i>'+t.label.replace(/[&<]/g,'')+' <span class="v" id="v'+i+'"></span> <b data-i="'+i+'" title="Remove">✕</b></span>').join('');
 document.querySelectorAll('.tr b').forEach(b=>b.onclick=()=>vs.postMessage({remove:+b.dataset.i}));}
window.addEventListener('message',e=>{const m=e.data;
 if(m.traces){traces=m.traces;data=[];chips();}
 if(m.err!==undefined)$('err').textContent=m.err;
 if(m.s&&!paused){data.push(m.s);count++;const cut=m.s.t-60000;while(data.length&&data[0].t<cut)data.shift();
  m.s.v.forEach((v,i)=>{const e=$('v'+i);if(e)e.textContent=v===null?'?':v;});}});
setInterval(()=>{const s=(Date.now()-t0)/1000;if(s>1){$('rate').textContent=(count/s).toFixed(0)+' samples/s';count=0;t0=Date.now();}},1000);
const cv=$('c'),g=cv.getContext('2d');
function draw(){const w=cv.clientWidth,h=cv.clientHeight,dpr=devicePixelRatio||1;
 if(cv.width!==w*dpr||cv.height!==h*dpr){cv.width=w*dpr;cv.height=h*dpr;}g.setTransform(dpr,0,0,dpr,0,0);
 const st=getComputedStyle(document.body),fg=st.color;g.clearRect(0,0,w,h);
 const L=56,R=12,T=12,Bm=24,pw=w-L-R,ph=h-T-Bm;
 if(!data.length||!traces.length){g.fillStyle=fg;g.globalAlpha=.5;g.font='13px sans-serif';g.fillText(traces.length?'waiting for the board…':'Add something to plot above.',L,T+20);g.globalAlpha=1;requestAnimationFrame(draw);return;}
 const tEnd=data[data.length-1].t,tStart=tEnd-span;
 let lo=Infinity,hi=-Infinity;for(const s of data)if(s.t>=tStart)for(const v of s.v)if(v!==null){if(v<lo)lo=v;if(v>hi)hi=v;}
 if(lo===Infinity){lo=0;hi=1;}if(lo===hi){lo-=1;hi+=1;}const pad=(hi-lo)*.08;lo-=pad;hi+=pad;
 const X=t=>L+(t-tStart)/span*pw,Y=v=>T+(1-(v-lo)/(hi-lo))*ph;
 g.strokeStyle=fg;g.globalAlpha=.12;g.lineWidth=1;g.font='11px monospace';g.fillStyle=fg;
 for(let k=0;k<=4;k++){const v=lo+(hi-lo)*k/4,y=Y(v);g.beginPath();g.moveTo(L,y);g.lineTo(w-R,y);g.stroke();g.globalAlpha=.7;g.fillText(String(Math.round(v)),4,y+4);g.globalAlpha=.12;}
 for(let s=0;s<=span/1000;s+=5){const x=X(tEnd-s*1000);g.beginPath();g.moveTo(x,T);g.lineTo(x,T+ph);g.stroke();g.globalAlpha=.7;g.fillText(s?'-'+s+'s':'now',x-12,h-6);g.globalAlpha=.12;}
 g.globalAlpha=1;g.lineWidth=1.6;
 traces.forEach((tr,i)=>{g.strokeStyle=C[i%C.length];g.beginPath();let on=false;
  for(const s of data){if(s.t<tStart)continue;const v=s.v[i];if(v===null){on=false;continue;}const x=X(s.t),y=Y(v);
   if(!on){g.moveTo(x,y);on=true;}else{g.lineTo(x,Y(prev(s,i)));g.lineTo(x,y);}}g.stroke();});
 requestAnimationFrame(draw);}
let last=[];function prev(s,i){const k=data.indexOf(s);for(let j=k-1;j>=0;j--)if(data[j].v[i]!==null)return data[j].v[i];return s.v[i];}
requestAnimationFrame(draw);
vs.postMessage({ready:true});
</script></body></html>`;
}

class Scope {
  constructor(vscode, forth, lang) {
    this.vscode = vscode; this.forth = forth; this.lang = lang;
    this.panel = null; this.traces = []; this.paused = false; this.running = false;
  }
  open(name) {
    const vscode = this.vscode;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('forth.scope', 'Scope', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = null; this.running = false; });
      this.panel.webview.onDidReceiveMessage(m => this.message(m));
      this.panel.webview.html = pageHtml();
    } else this.panel.reveal();
    if (name) this.add(name);
  }
  post(m) { if (this.panel) this.panel.webview.postMessage(m); }
  add(text) {
    const r = resolve(text, this.lang.index(), this.forth.board);
    if (r.error) { this.post({ err: r.error }); return; }
    if (this.traces.some(t => t.label === r.label)) return;
    this.traces.push(r);
    this.post({ traces: this.traces, err: '' });
    this.start();
  }
  message(m) {
    if (m.ready) { this.post({ traces: this.traces }); this.start(); }
    if (m.add) this.add(m.add);
    if (m.remove !== undefined) { this.traces.splice(m.remove, 1); this.post({ traces: this.traces }); }
    if (m.paused !== undefined) this.paused = m.paused;
  }
  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running || !this.panel) { this.running = false; return; }
      await this.sample();
      setTimeout(loop, this.traces.length ? 30 : 300);
    };
    loop();
  }
  // one line reads every trace: HEX a U. b U. #10 BASE !
  async sample() {
    const f = this.forth;
    if (this.paused || !this.traces.length || f.state !== 'ready' || !f.link || !f.link.interpreting) return;
    const tr = this.traces.slice();
    try {
      // the base is put back from what the board last said, so nothing of ours is on
      // the stack while the phrases run (DEPTH reads true)
      const r = await f.link.exchange(`HEX ${tr.map(t => `${t.phrase} U.`).join(' ')} #${f.stack.base || 10} BASE !`, 2000);
      if (r.error !== null) { this.post({ err: `${tr.map(t => t.label).join(', ')}: ${r.text.trim()}` }); return; }
      const t = r.text.trim().split(/\s+/).slice(-tr.length);
      const v = tr.map((x, i) => {
        let n = parseInt(t[i], 16);
        if (Number.isNaN(n)) return null;
        if (x.mask !== undefined) n = (n >>> x.shift) & x.mask;
        return n | 0;
      });
      this.post({ s: { t: Date.now(), v } });
    } catch { /* busy or gone */ }
  }
}

module.exports = { Scope, resolve, pageHtml };
