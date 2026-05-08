export function getDiagramRenderDoc(type: string, code: string): string {
  const htmlSafe = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const base = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#faf7f2;padding:16px;font-family:system-ui,sans-serif;min-height:100dvh;display:flex;align-items:flex-start;justify-content:center}.err{color:#b91c1c;background:#fef2f2;padding:16px;border-radius:10px;font-size:13px;margin:8px auto;text-align:center;max-width:400px}.err b{display:block;font-size:28px;margin-bottom:8px}.code-block{background:#f5f2ed;border:1px solid #e2ded5;border-radius:10px;padding:16px;font-size:12px;line-height:1.6;font-family:'JetBrains Mono','Fira Code',monospace;white-space:pre-wrap;word-break:break-word;max-width:100%;overflow-x:auto}svg{width:100%;height:auto;display:block}</style>`;

  const codeBlock = `<pre class="code-block">${htmlSafe}</pre>`;

  switch (type) {
    case 'mermaid':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script></head><body><div id="md"></div><script>
var code = ${JSON.stringify(code)};
var el = document.getElementById('md');
el.textContent = code;
el.className = 'mermaid';
mermaid.initialize({startOnLoad:false,theme:'neutral',securityLevel:'loose',flowchart:{htmlLabels:true}});
mermaid.run({nodes:[el]}).then(function(){
  var s = document.querySelector('svg');
  if(!s){
    document.body.innerHTML = '<div class="err"><b>💣</b>Could not render diagram.</div>'+'${codeBlock.replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}';
  }
});
<\/script></body></html>`;

    case 'graphviz':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/@hpcc-js/wasm@2/dist/index.umd.min.js"><\/script></head><body><div id="out"></div><script>
(async function(){
  try{
    var dotSrc = ${JSON.stringify(code)};
    var gv = await window["@hpcc-js/wasm"].Graphviz.load();
    document.getElementById('out').innerHTML = gv.dot(dotSrc);
  }catch(e){
    document.getElementById('out').innerHTML = '<div class="err"><b>🔧</b>Graphviz render failed</div>'+'${codeBlock.replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}';
  }
})();
<\/script></body></html>`;

    case 'd2':
      return `${base}<script src="https://cdn.jsdelivr.net/npm/@terrastruct/d2-js@0.6/dist/d2-js.umd.min.js"><\/script></head><body><div id="out"></div><script>
(async function(){
  try{
    var d2code = ${JSON.stringify(code)};
    var d2inst = new D2();
    var svg = await d2inst.render(d2code);
    document.getElementById('out').innerHTML = svg;
  }catch(e){
    document.getElementById('out').innerHTML = '<div class="err"><b>🔧</b>D2 render failed</div>'+'${codeBlock.replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}';
  }
})();
<\/script></body></html>`;

    case 'plantuml':
      try {
        const encoded = btoa(unescape(encodeURIComponent(code)));
        return `${base}</head><body><img src="https://www.plantuml.com/plantuml/svg/~1${encoded}" style="max-width:100%;height:auto" onerror="this.outerHTML='<div class=err><b>🌱</b>PlantUML render failed</div>${codeBlock.replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}'" /></body></html>`;
      } catch {
        return `${base}</head><body><div class="err"><b>🌱</b>PlantUML encoding failed</div>${codeBlock}</body></html>`;
      }

    case 'flowchart':
      return getDiagramRenderDoc('mermaid', code);

    default:
      return `${base}</head><body>${codeBlock}</body></html>`;
  }
}
