(function(){
  let rawDb=null, report=null, generated=null;
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function setStatus(text,type=''){const e=$('generatorStatus');e.textContent=text;e.className='status-box '+type}
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function modeSlug(){const m=$('genMode').value;return m==='one_by_one'?'onebyone':m==='practice60'?'practice60':'exam120'}
  function syncMeta(){const n=Math.max(1,Number($('genRound').value)||1),d=$('genDate').value||today(),kind=$('genKind').value;$('genDayId').value=`study-${d.replaceAll('-','')}-${modeSlug()}-${kind}-${String(n).padStart(2,'0')}`;$('genTitle').value=TouhanGenerator.generatedTitle(d,kind,n);const m=$('genMode').value;$('generateDailyBtn').textContent=m==='one_by_one'?'一問一答を生成':m==='practice60'?'総合演習を生成':'本番問題を生成';$('downloadSetsBtn').textContent=m==='one_by_one'?'4セット個別保存':'前半・後半を個別保存'}
  async function loadBundled(){setStatus('DBを読み込んでいます…');const r=await fetch('./data/tokyo_master.json',{cache:'no-store'});if(!r.ok)throw new Error(`DB読込失敗: ${r.status}`);rawDb=await r.json();setStatus(`DB読込完了：${rawDb.questions?.length||0}問`,'ok');return rawDb}
  async function ensureDb(){if(rawDb)return rawDb;return loadBundled()}
  function renderValidation(r){
    $('validationSummary').innerHTML=[['総数',r.total],['使用可能',r.validCount],['除外',r.invalidCount],['ID重複',r.duplicateIds.length]].map(([k,v])=>`<div class="summary-item">${esc(k)}<b>${esc(v)}</b></div>`).join('');
    $('validationDetails').textContent=r.invalid.slice(0,200).map(x=>`${x.id} (${x.year||'-'} 問${x.no||'-'}): ${x.reasons.join(' / ')}`).join('\n')||'除外なし';
  }
  async function validate(){await ensureDb();report=TouhanValidator.validateDatabase(rawDb);renderValidation(report);setStatus(`品質検査完了：${report.validCount}/${report.total}問を使用可能`,'ok');return report}
  function renderGenerated(data){
    const qs=data.sets.flatMap(s=>s.questions), chapters={};qs.forEach(q=>chapters[q.chapter]=(chapters[q.chapter]||0)+1);
    $('generationSummary').innerHTML=[['セット',data.sets.length],['問題数',qs.length],...Object.entries(chapters)].map(([k,v])=>`<div class="summary-item">${esc(k)}<b>${esc(v)}</b></div>`).join('');
    $('generatedJson').value=JSON.stringify(data,null,2);
  }
  function answerPackage(data){return {type:"touhan_answer_key",schemaVersion:"1.1",examId:data.id,title:data.title,date:data.date,category:data.category,generatedAt:new Date().toISOString(),sets:data.sets.map(s=>({id:s.id,title:s.title,questions:s.questions.map(q=>({no:q.no,chapter:q.chapter,knowledgeId:q.knowledge_id||"",source:q.source||"",text:q.text,choices:q.choices||[],correctAnswer:String(q.answer),explanation:q.explanation||""}))}))}}
  function download(name,obj){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u)}
  document.addEventListener('DOMContentLoaded',()=>{
    $('genDate').value=today();syncMeta();$('genDate').addEventListener('change',syncMeta);$('genRound').addEventListener('input',syncMeta);$('genMode').addEventListener('change',syncMeta);$('genKind').addEventListener('change',syncMeta);
    document.querySelectorAll('.mode-tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode-tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.mode-panel').forEach(x=>x.classList.add('hidden'));b.classList.add('active');$(b.dataset.panel).classList.remove('hidden')}));
    $('loadDbBtn').onclick=()=>loadBundled().catch(e=>setStatus(e.message,'err'));
    $('validateDbBtn').onclick=()=>validate().catch(e=>setStatus(e.message,'err'));
    $('masterFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;rawDb=JSON.parse(await f.text());report=null;setStatus(`ローカルDB読込完了：${rawDb.questions?.length||0}問`,'ok')}catch(err){setStatus(`読込失敗：${err.message}`,'err')}};
    $('generateDailyBtn').onclick=async()=>{try{if(!report)await validate();const mode=$('genMode').value;generated=TouhanGenerator.generate({questions:report.valid,date:$('genDate').value,dayId:$('genDayId').value.trim(),title:$('genTitle').value.trim(),mode,kind:$('genKind').value,sequence:Number($('genRound').value)||1});renderGenerated(generated);setStatus(`${mode==='one_by_one'?'一問一答':mode==='practice60'?'総合演習':'本番問題'}を生成しました。統合JSONを学習アプリへ取り込めます。`,'ok')}catch(e){setStatus(`生成失敗：${e.message}`,'err')}};
    $('downloadDailyBtn').onclick=()=>generated?download(`${generated.id}_all_sets.json`,generated):setStatus('先に問題を生成してください','err');$('downloadAnswerBtn').onclick=()=>generated?download(`${generated.id}_answer_key.json`,answerPackage(generated)):setStatus('先に問題を生成してください','err');
    $('downloadSetsBtn').onclick=()=>{if(!generated)return setStatus('先に問題を生成してください','err');generated.sets.forEach(set=>download(`${set.id}.json`,{...generated,sets:[set]}))};
    loadBundled().then(validate).catch(e=>setStatus(`自動読込できません。ローカルDBを選択してください：${e.message}`,'err'));
  });
})();
