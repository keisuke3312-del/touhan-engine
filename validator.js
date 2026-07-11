(function(){
  const normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
  const jp=/[一-龯ぁ-んァ-ヶ]/g;
  function ocrQualityReasons(q,choices){
    const reasons=[]; const text=String(q.question_text??''); const joined=[text,...choices].join(' ');
    const jpCount=(text.match(jp)||[]).length;
    const spaced=(text.match(/[一-龯ぁ-んァ-ヶ]\s+[一-龯ぁ-んァ-ヶ]/g)||[]).length;
    if(jpCount>0&&spaced/jpCount>0.28) reasons.push('文字間空白が多い');
    if(/(?:\b(?:IE|E|R|B|N|REKE|BREEAD|BREEED)\b|[#®&]|[A-Z]{4,})/.test(joined)) reasons.push('OCRノイズ記号');
    if(joined.includes('�')) reasons.push('文字化け');
    const combo=choices.filter(x=>/^[（(]?[a-dａ-ｄ][,、，]\s*[a-dａ-ｄ][)）]?$/i.test(x)).length;
    const hasStatements=/(?:^|\n)\s*[a-dａ-ｄ][\s　]+/im.test(text);
    if(combo>=4&&!hasStatements) reasons.push('組合せ対象の記述欠落');
    if(choices.some(x=>x.length>25&&/[にのをがでとやし]$/.test(x))) reasons.push('選択肢末尾欠落');
    return reasons;
  }
  function validateQuestion(q){
    const reasons=[]; const choices=Array.isArray(q.choices)?q.choices.map(normalize):[];
    if(!q.question_id) reasons.push('question_idなし');
    if(!normalize(q.question_text)||normalize(q.question_text).length<20) reasons.push('問題文不足');
    if(!/^第[1-5]章$/.test(normalize(q.chapter))) reasons.push('章が不正');
    if(choices.length!==5) reasons.push(`選択肢${choices.length}件`);
    if(choices.some(x=>x.length<4)) reasons.push('短すぎる選択肢');
    if(new Set(choices.map(x=>x.replace(/[\s,、()（）]/g,''))).size!==choices.length) reasons.push('選択肢重複');
    if(!['1','2','3','4','5'].includes(String(q.answer))) reasons.push('正答不正');
    if(!q.year) reasons.push('年度なし');
    reasons.push(...ocrQualityReasons(q,choices));
    return {ok:reasons.length===0,reasons,choices};
  }
  function validateDatabase(db){
    const list=Array.isArray(db)?db:(Array.isArray(db?.questions)?db.questions:[]); const seen=new Set(),valid=[],invalid=[],duplicateIds=[]; const chapterCounts={},yearCounts={};
    for(const q of list){if(seen.has(q.question_id)){duplicateIds.push(q.question_id);invalid.push({id:q.question_id,reasons:['ID重複']});continue;}seen.add(q.question_id);const r=validateQuestion(q);if(r.ok){valid.push({...q,choices:r.choices});chapterCounts[q.chapter]=(chapterCounts[q.chapter]||0)+1;yearCounts[q.year]=(yearCounts[q.year]||0)+1;}else invalid.push({id:q.question_id||'(なし)',year:q.year,no:q.question_no,reasons:r.reasons});}
    return {total:list.length,valid,invalid,validCount:valid.length,invalidCount:invalid.length,duplicateIds,chapterCounts,yearCounts};
  }
  window.TouhanValidator={validateQuestion,validateDatabase};
})();