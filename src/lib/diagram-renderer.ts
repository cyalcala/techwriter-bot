export function getDiagramRenderDoc(type: string, code: string): string {
  const htmlSafe = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsSafe = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  const base = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#faf7f2;padding:16px;overflow:auto;-webkit-overflow-scrolling:touch;font-family:system-ui,sans-serif;min-height:100dvh}.err{color:#b91c1c;background:#fef2f2;padding:16px;border-radius:10px;font-size:13px;margin:8px 0;text-align:center}.err b{display:block;font-size:32px;margin-bottom:8px}svg{height:auto;display:block;margin:16px auto;min-width:300px}</style>`;

  switch (type) {
    case 'mermaid':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script></head><body><div class="mermaid">${jsSafe}</div><script>
mermaid.initialize({startOnLoad:true,theme:'neutral',securityLevel:'loose',flowchart:{htmlLabels:true}});
setTimeout(function(){
  var s=document.querySelector('svg');
  if(!s){ document.body.innerHTML='<div class=err><b>💣</b>Could not render diagram.<br>The syntax might have an issue.<br><br><code style=font-size:11px;white-space:pre-wrap>'+${JSON.stringify(code.slice(0,500))}+'</code></div>'; }
  else{ s.style.width='auto';s.style.maxWidth='none'; }
},2000);
<\/script></body></html>`;

    case 'graphviz':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2/dist/graphviz.umd.min.js"><\/script></head><body><div id="gvout"></div><script>
(async function(){
  try{
    var dotSrc = ${JSON.stringify(code)};
    var hpccWasm = await window["@hpcc-js/wasm"];
    var gv = await hpccWasm.Graphviz.load();
    var svg = gv.dot(dotSrc);
    document.getElementById('gvout').innerHTML = svg;
    setTimeout(function(){ var s=document.querySelector('svg'); if(s){ s.style.width='auto';s.style.maxWidth='none'; } },500);
  }catch(e){
    document.getElementById('gvout').innerHTML='<div class=err><b>🔧</b>Graphviz could not render this.<br><br>'+e.message.replace(/</g,'&lt;')+'<br><br><code style=font-size:11px;white-space:pre-wrap>'+${JSON.stringify(code.slice(0,500))}+'</code></div>';
  }
})();
<\/script></body></html>`;

    case 'd2':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/@terrastruct/d2-js@0.6/dist/d2-js.umd.min.js"><\/script></head><body><div id="d2out"></div><script>
(async function(){
  try{
    var d2code = ${JSON.stringify(code)};
    var d2 = new D2();
    var svg = await d2.render(d2code);
    document.getElementById('d2out').innerHTML = svg;
    setTimeout(function(){ var s=document.querySelector('svg'); if(s){ s.style.width='auto';s.style.maxWidth='none'; } },500);
  }catch(e){
    document.getElementById('d2out').innerHTML='<div class=err><b>🔧</b>D2 could not render this.<br><br>'+e.message.replace(/</g,'&lt;')+'<br><br><code style=font-size:11px;white-space:pre-wrap>'+${JSON.stringify(code.slice(0,500))}+'</code></div>';
  }
})();
<\/script></body></html>`;

    case 'plantuml':
      return `${base}</head><body><img src="https://www.plantuml.com/plantuml/svg/~1${btoa(unescape(encodeURIComponent(code)))}" style="max-width:none;height:auto;display:block;margin:16px auto" onerror="this.parentElement.innerHTML='<div class=err><b>🌱</b>PlantUML could not render this diagram.</div>'" /></body></html>`;

    case 'flowchart':
      return getDiagramRenderDoc('mermaid', code);

    default:
      return `${base}</head><body><pre style="font-size:12px;white-space:pre-wrap;word-break:break-word;font-family:monospace;background:#f5f2ed;padding:12px;border-radius:8px;border:1px solid #e2ded5">${htmlSafe}</pre></body></html>`;
  }
}
