(function(){
  const normalize = value => String(value ?? '').replace(/\s+/g,' ').trim();
  function validateQuestion(q){
    const reasons=[];
    const choices=Array.isArray(q.choices)?q.choices.map(normalize):[];
    if(!q.question_id) reasons.push('question_idなし');
    if(!normalize(q.question_text) || normalize(q.question_text).length<20) reasons.push('問題文不足');
    if(!/^第[1-5]章$/.test(normalize(q.chapter))) reasons.push('章が不正');
    if(choices.length!==5) reasons.push(`選択肢${choices.length}件`);
    if(choices.some(x=>x.length<4)) reasons.push('短すぎる選択肢');
    if(new Set(choices.map(x=>x.replace(/[\s,、()（）]/g,''))).size!==choices.length) reasons.push('選択肢重複');
    if(!['1','2','3','4','5'].includes(String(q.answer))) reasons.push('正答不正');
    if(!q.year) reasons.push('年度なし');
    return {ok:reasons.length===0,reasons,choices};
  }
  function validateDatabase(db){
    const list=Array.isArray(db)?db:(Array.isArray(db?.questions)?db.questions:[]);
    const seen=new Set(), valid=[], invalid=[], duplicateIds=[];
    const chapterCounts={}, yearCounts={};
    for(const q of list){
      if(seen.has(q.question_id)){duplicateIds.push(q.question_id);invalid.push({id:q.question_id,reasons:['ID重複']});continue;}
      seen.add(q.question_id);
      const r=validateQuestion(q);
      if(r.ok){
        valid.push({...q,choices:r.choices});
        chapterCounts[q.chapter]=(chapterCounts[q.chapter]||0)+1;
        yearCounts[q.year]=(yearCounts[q.year]||0)+1;
      }else invalid.push({id:q.question_id||'(なし)',year:q.year,no:q.question_no,reasons:r.reasons});
    }
    return {total:list.length,valid,invalid,validCount:valid.length,invalidCount:invalid.length,duplicateIds,chapterCounts,yearCounts};
  }
  window.TouhanValidator={validateQuestion,validateDatabase};
})();
