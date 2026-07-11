(function(){
  const DISTRIBUTION={'第1章':5,'第2章':5,'第3章':5,'第4章':10,'第5章':5};
  const HISTORY_KEY='touhan.engine.generator.history.v040';
  function hashSeed(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
  function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  function shuffle(list,random){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function history(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{return[]}}
  function recentIds(days=4){const rows=history().slice(-days);return new Set(rows.flatMap(x=>x.questionIds||[]))}
  function yearBalancedPick(candidates,count,random,blocked,selectedIds){
    const groups={}; for(const q of candidates){(groups[q.year]??=[]).push(q)}
    Object.keys(groups).forEach(y=>groups[y]=shuffle(groups[y],random));
    const years=shuffle(Object.keys(groups),random), out=[];
    let cursor=0, guard=0;
    while(out.length<count && guard<10000){guard++;if(!years.length)break;const y=years[cursor%years.length];const pool=groups[y];let q;
      while(pool.length && !q){const x=pool.shift();if(!selectedIds.has(x.question_id) && !blocked.has(x.question_id))q=x}
      if(q){out.push(q);selectedIds.add(q.question_id)} cursor++;
      if(years.every(k=>groups[k].length===0))break;
    }
    if(out.length<count){
      for(const q of shuffle(candidates,random)){
        if(out.length>=count)break;if(selectedIds.has(q.question_id))continue;out.push(q);selectedIds.add(q.question_id);
      }
    }
    return out;
  }
  function toAppQuestion(q,no){
    return {no,chapter:q.chapter,theme:`東京都${q.year}年度 問${q.question_no}`,knowledge_id:q.question_id,source:`過去問（東京都${q.year}年度 問${q.question_no}）`,question_type:'single_best',text:String(q.question_text).trim(),choices:q.choices.map((text,i)=>({id:String(i+1),text})),answer:String(q.answer),explanation:`正答は${q.answer}です。東京都${q.year}年度の公式過去問です。`};
  }
  function generate({questions,date,dayId,title}){
    if(!Array.isArray(questions)||questions.length<120)throw new Error(`使用可能問題が不足しています（${questions?.length||0}問）`);
    const random=rng(hashSeed(`${date}|${dayId}|${questions.length}`));
    const blocked=recentIds(3), selectedIds=new Set(), sets=[];
    for(let setNo=1;setNo<=4;setNo++){
      const picked=[];
      for(const [chapter,count] of Object.entries(DISTRIBUTION)){
        const pool=questions.filter(q=>q.chapter===chapter);
        picked.push(...yearBalancedPick(pool,count,random,blocked,selectedIds));
      }
      const ordered=shuffle(picked,random);
      sets.push({id:`${dayId}-set-${setNo}`,title:`第${setNo}セット`,note:`全120問中 ${setNo}/4`,questions:ordered.map((q,i)=>toAppQuestion(q,i+1))});
    }
    const result={id:dayId,title,date:date.replace(/-/g,'/'),category:'exam_style',category_label:'本番形式',sets};
    const ids=sets.flatMap(s=>s.questions.map(q=>q.knowledge_id));
    const rows=history().filter(x=>x.dayId!==dayId);rows.push({dayId,date,resultTitle:title,questionIds:ids,createdAt:new Date().toISOString()});
    localStorage.setItem(HISTORY_KEY,JSON.stringify(rows.slice(-30)));
    return result;
  }
  window.TouhanGenerator={generate,DISTRIBUTION,HISTORY_KEY};
})();
