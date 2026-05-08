export function getDiagramRenderDoc(type: string, code: string): string {
  const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const base = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#faf7f2;padding:16px;overflow:auto;-webkit-overflow-scrolling:touch;font-family:system-ui,sans-serif}.error{color:#b91c1c;background:#fef2f2;padding:12px;border-radius:8px;font-size:13px;margin:8px 0}svg{max-width:100%;height:auto;display:block;margin:0 auto}</style>`;

  switch (type) {
    case 'mermaid':
      return `${base}<script>var c=document.getElementById('d');if(c){c.textContent=\`${escaped}\`}<\/script><script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script><script>mermaid.initialize({startOnLoad:true,theme:'neutral',securityLevel:'loose',flowchart:{useMaxWidth:true,htmlLabels:true}});<\/script></head><body><pre class="mermaid" id="d">${escaped}</pre><script>setTimeout(()=>{const s=document.querySelector('svg');if(!s){document.body.innerHTML+='<div class=error>Mermaid could not render this diagram. The syntax may have issues.</div>'}},3000)<\/script></body></html>`;

    case 'graphviz':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2/dist/graphviz.umd.min.js"><\/script></head><body><div id="out"></div><script>
(async()=>{
  try{
    const gv=await (new Graphviz()).layout(\`${escaped}\`,'svg','dot');
    document.getElementById('out').innerHTML=gv;
  }catch(e){
    document.getElementById('out').innerHTML='<div class=error>Graphviz render failed: '+e.message+'</div>';
  }
})();
<\/script></body></html>`;

    case 'd2':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/@terrastruct/d2-js@0.6/dist/d2-js.umd.min.js"><\/script></head><body><div id="out"></div><script>
(async()=>{
  try{
    const d2=new D2();
    const svg=await d2.render(\`${escaped}\`);
    document.getElementById('out').innerHTML=svg;
  }catch(e){
    document.getElementById('out').innerHTML='<div class=error>D2 render failed: '+e.message+'</div>';
  }
})();
<\/script></body></html>`;

    case 'plantuml':
      return `${base}</head><body><img src="https://www.plantuml.com/plantuml/svg/~1${btoa(unescape(encodeURIComponent(code)))}" style="max-width:100%;height:auto" onerror="this.parentElement.innerHTML='<div class=error>PlantUML render failed</div>'" /></body></html>`;

    default:
      return `${base}</head><body><pre style="font-size:12px;white-space:pre-wrap;word-break:break-word;font-family:monospace">${escaped}</pre></body></html>`;
  }
}
