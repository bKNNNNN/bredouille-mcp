/**
 * Optional card for hosts that render MCP Apps / ChatGPT Apps widgets. It only
 * draws the tool's structuredContent; it fetches nothing and holds no state.
 * Clients without widgets (Claude today, most others) read the full text answer.
 */
export const WIDGET_URI = 'ui://bredouille/carte-v1.html';
export const WIDGET_MIME = 'text/html;profile=mcp-app';

export const WIDGET_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bredouille</title>
<style>
:root{--humus:#15120e;--bone:#eee6d8;--pale:#f7dc7c;--orange:#e89242;--brick:#a84e32;--bg:var(--bone);--fg:var(--humus);--muted:rgba(21,18,14,.62);--line:rgba(21,18,14,.18)}
@media (prefers-color-scheme:dark){:root{--bg:var(--humus);--fg:var(--bone);--muted:rgba(238,230,216,.66);--line:rgba(238,230,216,.22)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{padding:14px 16px 12px}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:650}
.meta{color:var(--muted);font-size:12px}
.row{margin-top:10px}
.name{font-size:13px;font-weight:600;margin-bottom:4px;display:flex;gap:6px;align-items:baseline}
.tag{font-size:11px;font-weight:500;color:var(--muted)}
.strip{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:3px}
.cell{border-radius:6px;padding:5px 2px 4px;text-align:center;min-height:42px;border:1px solid transparent}
.cell .d{font-size:11px;font-variant-numeric:tabular-nums}
.cell.hl{outline:2px solid var(--fg);outline-offset:1px}
.below{background:var(--pale);color:var(--humus)}
.usual{background:var(--orange);color:var(--humus)}
.better{background:var(--brick);color:var(--bone)}
.best{background:var(--humus);color:var(--bone);border-color:var(--bone)}
.none,.off_season,.no_data{background:transparent;border:1px dashed var(--line);color:var(--muted)}
.fc{opacity:.86}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:10px;font-size:11px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:5px}
.legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
.safe{font-size:11px;color:var(--muted);max-width:34em}
a.open{font-size:13px;font-weight:600;color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.empty{color:var(--muted);padding:16px}
</style>
</head>
<body>
<div id="root" class="empty">Chargement de l’indice…</div>
<script>
(function(){
  var LABELS={below:"Moins bon que d’habitude",usual:"Habituel",better:"Meilleur que d’habitude",best:"Parmi les meilleurs jours"};
  var root=document.getElementById("root");
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c];});}
  function fmt(iso){var m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(iso||""));return m?m[3]+"/"+m[2]+"/"+m[1]:"";}
  function safeLink(u){return /^https:\\/\\/bredouille\\.app\\//.test(String(u||""))?String(u):"https://bredouille.app/";}
  function openLink(href){
    if(window.openai&&typeof window.openai.openExternal==="function"){window.openai.openExternal({href:href});return;}
    if(window.parent&&window.parent!==window){window.parent.postMessage({jsonrpc:"2.0",id:Date.now(),method:"ui/open-link",params:{url:href}},"*");return;}
    window.open(href,"_blank","noopener");
  }
  function render(data){
    if(!data||!data.rows||!data.rows.length){return;}
    var link=safeLink(data.link);
    var title=data.kind==="meilleurs_jours"?"Meilleurs jours":"Conditions";
    var place=data.place?"près de "+esc(data.place):"cellule de 1 km";
    var h='<div class="card"><div class="head"><h1>'+title+" "+place+'</h1><span class="meta">carte du '+esc(fmt(data.runDate))+"</span></div>";
    data.rows.forEach(function(r){
      h+='<div class="row"><div class="name">'+esc(r.name)+(r.confidence==="to_confirm"?'<span class="tag">indice à confirmer</span>':"")+'</div><div class="strip" role="list">';
      (r.days||[]).forEach(function(d){
        var cls=String(d.classId||"no_data").replace(/[^a-z_]/g,"");
        h+='<div role="listitem" class="cell '+cls+(d.forecast?" fc":"")+(data.highlight===d.day?" hl":"")+'" title="'+esc(d.label)+'"><div class="d">'+esc(d.short)+"</div></div>";
      });
      h+="</div></div>";
    });
    h+='<div class="legend">';
    ["below","usual","better","best"].forEach(function(k){h+='<span><i class="'+k+'"></i>'+LABELS[k]+"</span>";});
    h+='</div><div class="foot"><span class="safe">Bredouille indique des conditions, pas des champignons. Faites contrôler toute cueillette.</span><a class="open" href="'+esc(link)+'" target="_blank" rel="noopener">Ouvrir sur bredouille.app</a></div></div>';
    root.className="";
    root.innerHTML=h;
    var a=root.querySelector("a.open");
    if(a){a.addEventListener("click",function(e){e.preventDefault();openLink(link);});}
  }
  function fromOpenAI(){if(window.openai&&window.openai.toolOutput){render(window.openai.toolOutput);}}
  window.addEventListener("openai:set_globals",fromOpenAI,{passive:true});
  window.addEventListener("message",function(e){
    var m=e.data;
    if(!m||m.jsonrpc!=="2.0"){return;}
    if(m.method==="ui/notifications/tool-result"&&m.params){render(m.params.structuredContent);}
    if(m.id===1&&m.result){window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");}
  });
  fromOpenAI();
  if(!window.openai&&window.parent&&window.parent!==window){
    window.parent.postMessage({jsonrpc:"2.0",id:1,method:"ui/initialize",params:{protocolVersion:"2026-01-26",appInfo:{name:"bredouille-card",version:"1.0.0"},clientInfo:{name:"bredouille-card",version:"1.0.0"},appCapabilities:{}}},"*");
  }
})();
</script>
</body>
</html>`;
