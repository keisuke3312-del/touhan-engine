(function(){
  const DISTRIBUTIONS={
    one_by_one:{'第1章':5,'第2章':5,'第3章':5,'第4章':10,'第5章':5},
    practice60:{'第1章':10,'第2章':10,'第3章':20,'第4章':10,'第5章':10},
    exam_am:{'第1章':20,'第2章':20,'第4章':20},
    exam_pm:{'第3章':40,'第5章':20}
  };
  const HISTORY_KEY='touhan.engine.generator.history.v083';

  function hashSeed(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
  function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  function shuffle(list,random){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function history(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{return[]}}
  function recentIds(category,days=4){return new Set(history().filter(x=>x.category===category).slice(-days).flatMap(x=>x.questionIds||[]))}
  function pick(pool,count,random,blocked,selected){const years={};for(const q of pool)(years[q.year]??=[]).push(q);Object.keys(years).forEach(y=>years[y]=shuffle(years[y],random));const ys=shuffle(Object.keys(years),random),out=[];let c=0,g=0;while(out.length<count&&ys.length&&g++<10000){const y=ys[c++%ys.length];let q;while(years[y].length&&!q){const x=years[y].shift();if(!selected.has(x.question_id)&&!blocked.has(x.question_id))q=x}if(q){out.push(q);selected.add(q.question_id)}if(ys.every(k=>years[k].length===0))break}return out}

  function removeRubyLines(value){
    const lines=String(value??'').replace(/\r/g,'').split('\n').map(x=>x.trim());
    return lines.filter((line,i)=>{
      if(!/^[ぁ-んァ-ヶー]{1,8}$/.test(line))return true;
      const prev=lines[i-1]||'', next=lines[i+1]||'';
      return !(/[一-龯々〆ヵヶ]$/.test(prev)&&next.length>0);
    }).join('\n');
  }
  function stripSourceQuestionNumber(value){
    return String(value??'')
      .replace(/^\s*[【［(（]?\s*(?:第\s*)?問\s*[０-９0-9]+\s*[】］)）.:：、-]*\s*/u,'')
      .replace(/^\s*[【［(（]?\s*第\s*[０-９0-9]+\s*問\s*[】］)）.:：、-]*\s*/u,'');
  }
  const TEXT_FIXES=[
    [/蕁\s*じん\s*麻疹\s*しん/g,'蕁麻疹'],[/痒\s*かゆ\s*み/g,'痒み'],[/罹\s*り\s*患/g,'罹患'],
    [/咀\s*嚼/g,'咀嚼'],[/酸\s*そ\s*しゃく\s*性/g,'酸性'],[/口腔\s*くう/g,'口腔'],
    [/排泄\s*せつ/g,'排泄'],[/咳\s*せき/g,'咳'],[/痰\s*たん/g,'痰'],[/喘\s*ぜん\s*息/g,'喘息'],
    [/嘔\s*おう\s*吐/g,'嘔吐'],[/倦\s*けん\s*怠/g,'倦怠'],[/嚥\s*えん\s*下/g,'嚥下'],
    [/収斂\s*れん/g,'収斂'],[/止瀉\s*しゃ/g,'止瀉'],[/鎮咳\s*がい/g,'鎮咳'],[/去痰\s*たん/g,'去痰'],
    [/含嗽\s*そう/g,'含嗽'],[/鎮暈\s*うん/g,'鎮暈'],[/疳\s*かん/g,'疳'],[/亢\s*こう\s*進/g,'亢進'],
    [/弛\s*し\s*緩/g,'弛緩'],[/鱗\s*りん\s*茎/g,'鱗茎'],[/膨\s*ぼう\s*潤/g,'膨潤'],
    [/頻\s*ひん\s*脈/g,'頻脈'],[/浮腫\s*しゅ/g,'浮腫'],[/腫脹\s*ちょう/g,'腫脹']
  ];
  function cleanText(value,{stripQuestionNo=false}={}){
    let text=removeRubyLines(value)
      .replace(/([一-龯々〆ヵヶ])\|[ぁ-んァ-ヶー]{1,8}\|/g,'$1')
      .replace(/\|/g,'')
      .replace(/[ \t　]+/g,' ')
      .replace(/\s*\n\s*/g,'')
      .replace(/\s+([、。！？）】])/g,'$1')
      .replace(/([（【])\s+/g,'$1')
      .replace(/，/g,'、')
      .replace(/\s*－\s*/g,'－')
      .trim();
    for(const [pattern,replacement] of TEXT_FIXES)text=text.replace(pattern,replacement);
    text=text
      .replace(/([一-龯々]{2,})[ぁ-ん]{3,}(?:とう|さん|がん|えき)(?=[はをが、])/g,'$1')
      .replace(/([一-龯々ぁ-んァ-ヶー])\s+([一-龯々ぁ-んァ-ヶー])/g,'$1$2');
    if(stripQuestionNo)text=stripSourceQuestionNumber(text);
    return text;
  }

  function examPrompt(q){
    const raw=String(q.question_text??'').replace(/\r/g,'');
    const firstStatement=raw.search(/(?:^|\n)\s*[ａ-ｄa-d]\s+/m);
    const promptSource=firstStatement>=0?raw.slice(0,firstStatement):raw;
    let prompt=cleanText(promptSource,{stripQuestionNo:true});
    const complete=prompt.match(/^[\s\S]*?(?:どれか。|組合せはどれか。|正しいか。|誤っているか。)/);
    if(complete)prompt=complete[0].trim();
    return prompt;
  }

  function formatExamQuestionText(q){
    const prompt=examPrompt(q);
    const statements=extractLetterStatements(q);
    const blocks=Object.entries(statements)
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([label,text])=>`【${label}】 ${cleanText(text)}`);
    return blocks.length?[prompt,...blocks].filter(Boolean).join('\n\n'):prompt;
  }

  function toExamQuestion(q,no){
    return {
      no,
      chapter:q.chapter,
      theme:`東京都${q.year}年度`,
      knowledge_id:q.question_id,
      source:`過去問（東京都${q.year}年度 問${q.question_no}）`,
      question_type:'single_best',
      text:formatExamQuestionText(q),
      choices:q.choices.map((text,i)=>({id:String(i+1),text:cleanText(text)})),
      answer:String(q.answer),
      explanation:`正答は${q.answer}です。東京都${q.year}年度の公式過去問です。`
    };
  }

  function extractLetterStatements(q){
    const text=String(q.question_text??'').replace(/\r/g,'');
    const matches=[...text.matchAll(/(?:^|\n)\s*([ａ-ｄa-d])\s+([\s\S]*?)(?=(?:\n\s*[ａ-ｄa-d]\s+)|(?:\n\s*[１-５1-5]\s*[（(])|(?:\n\s*[１-５1-5]\s+(?:正|誤))|$)/g)];
    const out={};
    for(const m of matches){
      const key=m[1].normalize('NFKC').toLowerCase();
      const body=cleanText(m[2]).replace(/(?:１|1)[（(].*$/,'').trim();
      if(body.length>=12)out[key]=body;
    }
    return out;
  }

  function selectedOptionFromText(q){
    const text=String(q.question_text??'').replace(/\r/g,'');
    const answer=String(q.answer).normalize('NFKC');
    const pairRows=[...text.matchAll(/(?:^|\s)([１-５1-5])\s*[（(]\s*([^）)]+?)\s*[）)]/g)];
    for(const m of pairRows){if(m[1].normalize('NFKC')===answer)return cleanText(m[2]);}
    const truthRows=[...text.matchAll(/(?:^|\n)\s*([１-５1-5])\s+((?:(?:正|誤)\s*){3,4})(?=\n|$)/g)];
    for(const m of truthRows){if(m[1].normalize('NFKC')===answer)return (m[2].match(/[正誤]/g)||[]).join(' ');}
    return cleanText(q.choices?.[Number(q.answer)-1]??'');
  }

  function truthFromPattern(q,statements){
    const selected=selectedOptionFromText(q);
    const letters=Object.keys(statements);
    if(!letters.length||!selected)return null;
    const marks=selected.match(/[正誤]/g)||[];
    if(marks.length>=letters.length){const map={};letters.forEach((k,i)=>map[k]=marks[i]==='正');return map;}
    const pair=(selected.match(/[a-dａ-ｄ]/gi)||[]).map(x=>x.normalize('NFKC').toLowerCase());
    if(pair.length>=2){
      const isIncorrectPair=/誤っているものの組合せ/.test(cleanText(q.question_text));
      const map={};letters.forEach(k=>map[k]=isIncorrectPair?!pair.includes(k):pair.includes(k));return map;
    }
    return null;
  }

  function deriveOneByOne(q){
    const out=[];
    const statements=extractLetterStatements(q);
    const truth=truthFromPattern(q,statements);
    if(truth){
      for(const key of Object.keys(statements)){
        const statement=statements[key];
        if(typeof truth[key]!=='boolean')continue;
        out.push({question_id:`${q.question_id}_${key}`,year:q.year,question_no:q.question_no,chapter:q.chapter,statement,truth:truth[key],source_question_id:q.question_id,label:key});
      }
      return out;
    }
    const prompt=cleanText(q.question_text,{stripQuestionNo:true}).split(/(?:１|1)[（(]?/)[0]||'';
    const choices=(q.choices||[]).map(cleanText);
    const answerIndex=Number(q.answer)-1;
    const uniqueChoices=new Set(choices);
    if(choices.length===5&&uniqueChoices.size===5&&answerIndex>=0&&answerIndex<5){
      if(/誤っているものはどれか/.test(prompt))choices.forEach((text,i)=>{if(text.length>=12)out.push({question_id:`${q.question_id}_choice_${i+1}`,year:q.year,question_no:q.question_no,chapter:q.chapter,statement:text,truth:i!==answerIndex,source_question_id:q.question_id,label:String(i+1)});});
      else if(/正しいものはどれか/.test(prompt)&&!/組合せ/.test(prompt))choices.forEach((text,i)=>{if(text.length>=12)out.push({question_id:`${q.question_id}_choice_${i+1}`,year:q.year,question_no:q.question_no,chapter:q.chapter,statement:text,truth:i===answerIndex,source_question_id:q.question_id,label:String(i+1)});});
    }
    return out;
  }

  function isNaturalStatement(text){
    const t=cleanText(text);
    if(t.length<18||t.length>260)return false;
    if(!/[。！？]$/.test(t))return false;
    if(/[�□■◆◇]|\*RRG|(?:[A-Z][a-z]?){5,}|[0-9A-Za-z]{10,}/.test(t))return false;
    if(/(?:問|正しい組合せ|誤っているものはどれか|正しいものはどれか)$/.test(t))return false;
    if(/^[ぁ-んァ-ヶー\s]+$/.test(t))return false;
    if(/^[^。！？]{0,12}[、：]$/.test(t))return false;
    return true;
  }
  function buildOneByOnePool(questions){return questions.flatMap(deriveOneByOne).filter(x=>isNaturalStatement(x.statement))}
  function toOneByOneQuestion(q,no){return {no,chapter:q.chapter,theme:`東京都${q.year}年度`,knowledge_id:q.question_id,source:`過去問（東京都${q.year}年度 問${q.question_no}）`,answer:q.truth?'○':'×',text:cleanText(q.statement),explanation:`東京都${q.year}年度の公式過去問に基づく記述です。正解は「${q.truth?'○':'×'}」です。`,category:'one_by_one',category_label:'一問一答'}}

  function pickByDistribution(pool,distribution,random,blocked,selected){const picked=[];for(const [chapter,count] of Object.entries(distribution))picked.push(...pick(pool.filter(q=>q.chapter===chapter),count,random,blocked,selected));return picked}
  function makeSet({pool,distribution,count,id,title,note,random,blocked,selected,mapper}){let picked=pickByDistribution(pool,distribution,random,blocked,selected);if(picked.length<count){for(const q of shuffle(pool,random)){if(picked.length>=count)break;if(!selected.has(q.question_id)&&!blocked.has(q.question_id)){picked.push(q);selected.add(q.question_id)}}}if(picked.length<count)throw new Error(`${title}を${count}問確保できませんでした`);return {id,title,note,questions:shuffle(picked,random).map((q,i)=>mapper(q,i+1))}}
  const KIND_LABELS={normal:'通常',practice:'練習',development:'開発'};
  function generatedTitle(date,kind,sequence=1){const d=date.replace(/-/g,'/'),n=Math.max(1,Number(sequence)||1);if(kind==='practice')return `${d}（練習${n===1?'':n}）`;if(kind==='development')return `${d}（開発${n===1?'':n}）`;return n===1?d:`${d}（${n}）`}
  function saveHistory(result,mode,kind){const ids=result.sets.flatMap(s=>s.questions.map(q=>q.knowledge_id));const rows=history();rows.push({dayId:result.id,date:result.date.replace(/\//g,'-'),resultTitle:result.title,category:result.category,mode,kind,questionIds:ids,createdAt:new Date().toISOString()});localStorage.setItem(HISTORY_KEY,JSON.stringify(rows.slice(-100)))}
  function generate({questions,date,dayId,title,mode='exam_style',kind='normal',sequence=1}){
    const actualTitle=title||generatedTitle(date,kind,sequence);
    const random=rng(hashSeed(`${date}|${dayId}|${mode}|${kind}|${questions.length}`)),blocked=recentIds(mode,3),selected=new Set();
    let result;
    if(mode==='one_by_one'){
      const pool=buildOneByOnePool(questions),sets=[];
      if(pool.length<120)throw new Error(`一問一答の使用可能問題が不足しています（${pool.length}問）`);
      for(let i=1;i<=4;i++)sets.push(makeSet({pool,distribution:DISTRIBUTIONS.one_by_one,count:30,id:`${dayId}-set-${i}`,title:`第${i}セット`,note:`全120問中 ${i}/4`,random,blocked,selected,mapper:toOneByOneQuestion}));
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'one_by_one',category_label:'一問一答',mode:'one_by_one',kind,sets};
    }else if(mode==='practice60'){
      const full=makeSet({pool:questions,distribution:DISTRIBUTIONS.practice60,count:60,id:`${dayId}-practice60`,title:'総合演習 60問',note:'全5章を本番比率で総合演習',random,blocked,selected,mapper:toExamQuestion});
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'practice60',category_label:'総合演習60問',mode:'practice60',kind,sets:[{id:`${dayId}-practice60-front`,title:'前半 30問',note:'総合演習60問の前半',questions:full.questions.slice(0,30)},{id:`${dayId}-practice60-back`,title:'後半 30問',note:'総合演習60問の後半',questions:full.questions.slice(30)}]};
    }else{
      const front=makeSet({pool:questions,distribution:DISTRIBUTIONS.exam_am,count:60,id:`${dayId}-front`,title:'前半 60問',note:'第1章20・第2章20・第4章20',random,blocked,selected,mapper:toExamQuestion});
      const back=makeSet({pool:questions,distribution:DISTRIBUTIONS.exam_pm,count:60,id:`${dayId}-back`,title:'後半 60問',note:'第3章40・第5章20',random,blocked,selected,mapper:toExamQuestion});
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'exam_style',category_label:'本番形式120問',mode:'exam_style',kind,sets:[front,back]};
    }
    result.generation_kind=kind;result.generation_kind_label=KIND_LABELS[kind]||kind;result.generation_sequence=Math.max(1,Number(sequence)||1);result.generated_at=new Date().toISOString();saveHistory(result,mode,kind);return result;
  }

  window.TouhanGenerator={generate,buildOneByOnePool,DISTRIBUTIONS,HISTORY_KEY,KIND_LABELS,generatedTitle,cleanText,stripSourceQuestionNumber,formatExamQuestionText};
})();
