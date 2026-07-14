(function(){
  const normalize=value=>String(value??'').replace(/\s+/g,' ').trim();
  const jp=/[一-龯ぁ-んァ-ヶ]/g;
  function structuredStatements(q){
    if(Array.isArray(q?.statements)){
      const out={};
      for(const row of q.statements){
        const label=String(row?.label??'').normalize('NFKC').toLowerCase().trim();
        const text=normalize(row?.text);
        if(/^[a-d]$/.test(label)&&text&&!out[label])out[label]=text;
      }
      if(Object.keys(out).length)return out;
    }
    const raw=String(q?.question_text??'').replace(/\r/g,'').normalize('NFKC');
    const matches=[...raw.matchAll(/(?:^|\n)\s*([a-d])\s+([\s\S]*?)(?=(?:\n\s*[a-d]\s+)|$)/g)];
    const out={};
    for(const m of matches){const text=normalize(m[2]);if(text&&!out[m[1]])out[m[1]]=text;}
    return out;
  }
  function ocrQualityReasons(q,choices){
    const reasons=[]; const text=String(q.question_text??''); const statements=Object.values(structuredStatements(q)); const joined=[text,...statements,...choices].join(' ');
    const jpCount=(text.match(jp)||[]).length;
    const spaced=(text.match(/[一-龯ぁ-んァ-ヶ]\s+[一-龯ぁ-んァ-ヶ]/g)||[]).length;
    if(jpCount>0&&spaced/jpCount>0.28) reasons.push('文字間空白が多い');
    if(/(?:\*RRG|&OLQLFDO|3UDFWLFH|\b(?:REKE|BREEAD|BREEED)\b|[#®])/.test(joined)) reasons.push('OCRノイズ記号');
    if(joined.includes('�')) reasons.push('文字化け');
    const combo=choices.filter(x=>/^[（(]?[a-dａ-ｄ][,、，]\s*[a-dａ-ｄ][)）]?$/i.test(x)).length;
    const hasStatements=Object.keys(structuredStatements(q)).length>0;
    if(combo>=4&&!hasStatements) reasons.push('組合せ対象の記述欠落');
    if(choices.some(x=>x.length>25&&/[にのをがでとやし]$/.test(x))) reasons.push('選択肢末尾欠落');
    return reasons;
  }

  function statementLabels(text){
    const raw=String(text??'').replace(/\r/g,'').normalize('NFKC');
    return [...new Set([...raw.matchAll(/(?:^|\n)\s*([a-d])\s+\S/g)].map(m=>m[1].toLowerCase()))];
  }
  function structuralReasons(q,choices){
    const reasons=[];
    const text=String(q.question_text??'');
    const direct=Array.isArray(q?.statements)?q.statements:[];
    const labels=[...new Set(direct.map(x=>String(x?.label??'').normalize('NFKC').toLowerCase()).filter(x=>/^[a-d]$/.test(x)))];
    const fallback=labels.length?labels:statementLabels(text);
    const marksPerChoice=choices.map(x=>(String(x).match(/[正誤]/g)||[]).length);
    const expectedTruth=Math.max(0,...marksPerChoice);
    const pairPattern=/^[（(]?\s*([a-dａ-ｄ])\s*[,、・]\s*([a-dａ-ｄ])\s*[）)]?$/i;
    const pairChoices=choices.map(x=>String(x).match(pairPattern)).filter(Boolean);
    const isTruthTable=choices.length===5&&expectedTruth>=3;
    const isPair=/組合せはどれか/.test(text)&&pairChoices.length>=4;
    const expected=isTruthTable?expectedTruth:(isPair?Math.max(...pairChoices.flatMap(m=>[m[1],m[2]]).map(x=>x.normalize('NFKC').toLowerCase().charCodeAt(0)-96),0):0);
    if((isTruthTable||isPair)&&fallback.length<expected)reasons.push(`組合せ対象の記述欠落（${fallback.join(',')||'なし'} / 必要${expected}件）`);
    return reasons;
  }

  function validateQuestion(q){
    const reasons=[];
    const cleanChoice=x=>normalize(x).replace(/(?:人体の働きと医薬品|薬事に関する法規と制度|主な医薬品とその作用|医薬品の適正使用と安全対策)$/,'').trim();
    const choices=Array.isArray(q.choices)?q.choices.map(cleanChoice):[];
    if(q?.quality?.status && q.quality.status!=='ok')reasons.push(`抽出品質:${q.quality.status}`);
    if(!q.question_id) reasons.push('question_idなし');
    if(!normalize(q.question_text)||normalize(q.question_text).length<20) reasons.push('問題文不足');
    if(!/^第[1-5]章$/.test(normalize(q.chapter))) reasons.push('章が不正');
    if(choices.length!==5) reasons.push(`選択肢${choices.length}件`);
    if(choices.some(x=>x.length<4)) reasons.push('短すぎる選択肢');
    if(new Set(choices.map(x=>x.replace(/[\s,、()（）]/g,''))).size!==choices.length) reasons.push('選択肢重複');
    if(!['1','2','3','4','5'].includes(String(q.answer))) reasons.push('正答不正');
    if(!q.year) reasons.push('年度なし');
    reasons.push(...ocrQualityReasons(q,choices));
    reasons.push(...structuralReasons(q,choices));
    return {ok:reasons.length===0,reasons,choices};
  }
  function validateDatabase(db){
    const list=Array.isArray(db)?db:(Array.isArray(db?.questions)?db.questions:[]); const seen=new Set(),valid=[],invalid=[],duplicateIds=[]; const chapterCounts={},yearCounts={};
    for(const q of list){if(seen.has(q.question_id)){duplicateIds.push(q.question_id);invalid.push({id:q.question_id,reasons:['ID重複']});continue;}seen.add(q.question_id);const r=validateQuestion(q);if(r.ok){valid.push({...q,choices:r.choices});chapterCounts[q.chapter]=(chapterCounts[q.chapter]||0)+1;yearCounts[q.year]=(yearCounts[q.year]||0)+1;}else invalid.push({id:q.question_id||'(なし)',year:q.year,no:q.question_no,reasons:r.reasons});}
    return {total:list.length,valid,invalid,validCount:valid.length,invalidCount:invalid.length,duplicateIds,chapterCounts,yearCounts};
  }
  window.TouhanValidator={validateQuestion,validateDatabase,structuredStatements};
})();
(function(){
  const DISTRIBUTIONS={
    one_by_one:{'第1章':5,'第2章':5,'第3章':5,'第4章':10,'第5章':5},
    practice60:{'第1章':10,'第2章':10,'第3章':20,'第4章':10,'第5章':10},
    exam_am:{'第1章':20,'第2章':20,'第4章':20},
    exam_pm:{'第3章':40,'第5章':20}
  };
  const HISTORY_KEY='touhan.engine.generator.history.v110';

  function hashSeed(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
  function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  function shuffle(list,random){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function history(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{return[]}}
  function recentIds(category,days=4){return new Set(history().filter(x=>x.category===category).slice(-days).flatMap(x=>x.questionIds||[]))}
  function pick(pool,count,random,blocked,selected,selectedQuestions=[],duplicateGuard=null){const years={};for(const q of pool)(years[q.year]??=[]).push(q);Object.keys(years).forEach(y=>years[y]=shuffle(years[y],random));const ys=shuffle(Object.keys(years),random),out=[];let c=0,g=0;while(out.length<count&&ys.length&&g++<20000){const y=ys[c++%ys.length];let q;while(years[y].length&&!q){const x=years[y].shift();if(selected.has(x.question_id)||blocked.has(x.question_id))continue;if(duplicateGuard&&duplicateGuard(x,selectedQuestions))continue;q=x}if(q){out.push(q);selected.add(q.question_id);selectedQuestions.push(q)}if(ys.every(k=>years[k].length===0))break}return out}

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
    [/頻\s*ひん\s*脈/g,'頻脈'],[/浮腫\s*しゅ/g,'浮腫'],[/腫脹\s*ちょう/g,'腫脹'],[/くう\s*くう(?=口腔)/g,''],[/い\s*たん\s*じ(?=を示し)/g,''],[/作用がを示し/g,'作用を示し']
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

  function normalizeExamRaw(value){
    return removeRubyLines(String(value??''))
      .replace(/\r/g,'')
      .replace(/（\s*([ａ-ｄa-d])\s*）/g,(_,x)=>`（${x.normalize('NFKC').toLowerCase()}）`)
      .replace(/\(\s*([ａ-ｄa-d])\s*\)/g,(_,x)=>`（${x.normalize('NFKC').toLowerCase()}）`)
      .replace(/^[ \t　]*[0-9０-９]{1,2}[ \t　]*$/gm,'')
      .replace(/\n[ \t　]*問[０-９0-9]+[\s\S]*$/u,'')
      .trim();
  }

  function cleanExamParagraph(value){
    return cleanText(String(value??'').replace(/\n+/g,' '));
  }
  function sourceStatements(q){
    const direct=TouhanValidator?.structuredStatements?.(q)||{};
    const out={};
    for(const [label,text] of Object.entries(direct)){
      const cleaned=cleanExamParagraph(text);
      if(cleaned)out[label]=cleaned;
    }
    return Object.keys(out).length?out:extractLetterStatements(q);
  }

  function questionSemanticText(q){
    const prompt=examPrompt(q);
    const statements=Object.entries(sourceStatements(q)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${v}`).join(' ');
    return `${prompt} ${statements}`.trim();
  }

  function examPrompt(q){
    const raw=normalizeExamRaw(q.question_text);
    const firstStatement=raw.search(/(?:^|\n)\s*[ａ-ｄa-d]\s+(?!）)/m);
    const promptSource=firstStatement>=0?raw.slice(0,firstStatement):raw;
    let prompt=cleanExamParagraph(promptSource);
    const complete=prompt.match(/^[\s\S]*?(?:どれか。|組合せはどれか。|正しいか。|誤っているか。)/);
    if(complete)prompt=complete[0].trim();
    return stripSourceQuestionNumber(prompt);
  }

  function placeholderLabels(q){
    const raw=normalizeExamRaw(q.question_text);
    return [...new Set((raw.match(/（([a-d])）/g)||[]).map(x=>x.slice(1,2)))];
  }

  function isFillBlankQuestion(q){
    const labels=placeholderLabels(q);
    return labels.length>0 && /中に入れるべき字句|字句の正しい組合せ/.test(cleanExamParagraph(q.question_text));
  }

  function formatFillBlankText(q){
    const raw=normalizeExamRaw(q.question_text);
    const prompt=examPrompt(q);
    const rawParas=raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
    let body='';
    if(rawParas.length>=2){
      body=rawParas.slice(1).join('\n\n');
    }else{
      const marker=raw.match(/(?:組合せはどれ[\s\n]*か。|どれ[\s\n]*か。)/);
      body=marker?raw.slice(marker.index+marker[0].length):'';
    }
    body=body
      .replace(/^\s*(?:なお、[^。]*。\s*)?/,'')
      .replace(/\n\s*[ａ-ｄa-d](?:\s+[ａ-ｄa-d]){1,3}\s*$/m,'')
      .trim();
    const paras=body.split(/\n\s*\n+/).map(cleanExamParagraph).filter(x=>x&&!/^[a-d](?:\s+[a-d]){1,3}$/i.test(x));
    return [prompt,...paras].filter(Boolean).join('\n\n');
  }

  function splitPairStatement(text){
    const t=cleanExamParagraph(text);
    const parts=t.split(/\s*[―—ー－]{3,}\s*/).map(x=>x.trim()).filter(Boolean);
    if(parts.length>=2)return `${parts[0]}\n→ ${parts.slice(1).join(' ')}`;
    return t;
  }

  function formatExamQuestionText(q){
    if(isFillBlankQuestion(q))return formatFillBlankText(q);
    const prompt=examPrompt(q);
    const statements=sourceStatements(q);
    const blocks=Object.entries(statements)
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([label,text])=>`【${label}】 ${splitPairStatement(text)}`);
    return blocks.length?[prompt,...blocks].filter(Boolean).join('\n\n'):prompt;
  }

  function splitChoiceCells(text,count){
    const raw=String(text??'').replace(/\r/g,'').trim();
    const cells=raw.split(/[ \t　]+/).map(cleanText).filter(Boolean);
    if(count>1 && cells.length===count)return cells;
    return null;
  }

  function formatExamChoiceText(q,text){
    const raw=String(text??'');
    const cleaned=cleanText(raw)
      .replace(/[（(]\s*([a-dａ-ｄ])\s*[,、]\s*([a-dａ-ｄ])\s*[）)]/gi,(_,a,b)=>`（${a.normalize('NFKC').toLowerCase()}・${b.normalize('NFKC').toLowerCase()}）`);
    const labels=placeholderLabels(q);
    if(labels.length){
      const cells=splitChoiceCells(raw,labels.length);
      if(cells)return cells.map((cell,i)=>`${labels[i]}：${cell}`).join('\n');
    }
    const marks=cleaned.match(/[正誤]/g)||[];
    if(marks.length>=3 && marks.length<=4){
      const ls=['a','b','c','d'].slice(0,marks.length);
      return ls.map((l,i)=>`${l}：${marks[i]}`).join('\n');
    }
    return cleaned;
  }

  function makeShortExplanation(answer){return `正答は「${answer}」です。`;}
  function makeDetailedExplanation(q,answer){const source=`東京都${q.year}年度 問${q.question_no}`;return `正答は「${answer}」です。${source}の公式過去問に基づきます。問題文と各選択肢を照合し、正しい組合せ・記述を確認してください。`;}
  function toExamQuestion(q,no){
    return {
      no,
      chapter:q.chapter,
      theme:`東京都${q.year}年度`,
      knowledge_id:q.question_id,
      source:`過去問（東京都${q.year}年度 問${q.question_no}）`,
      question_type:'single_best',
      text:formatExamQuestionText(q),
      choices:q.choices.map((text,i)=>({id:String(i+1),text:formatExamChoiceText(q,text)})),
      answer:String(q.answer),
      shortExplanation:makeShortExplanation(String(q.answer)),
      explanation:makeDetailedExplanation(q,String(q.answer))
    };
  }

  function isChoiceTableHeaderLine(line){
    const compact=String(line??'').normalize('NFKC').toLowerCase().replace(/[\s　,、.・:：|｜()（）\[\]【】]/g,'');
    return compact==='abcd';
  }

  function extractLetterStatements(q){
    // 正誤表の列見出し「a b c d」は本文記述ではないため、解析前に除去する。
    const rawLines=normalizeExamRaw(q.question_text).split('\n');
    const kept=[];
    for(let i=0;i<rawLines.length;i++){
      const line=rawLines[i];
      const compact=String(line??'').normalize('NFKC').toLowerCase().replace(/[\s　,、.・:：|｜()（）\[\]【】]/g,'');
      const nextCompact=String(rawLines[i+1]??'').normalize('NFKC').toLowerCase().replace(/[\s　,、.・:：|｜()（）\[\]【】]/g,'');
      if(isChoiceTableHeaderLine(line))continue;
      // PDFの列見出しが「a b」「c d」の2行に分断された場合も除外する。
      if(/^ab$/.test(compact)&&/^cd(?:[ぁ-んァ-ヶー]*)?$/.test(nextCompact)){i++;continue;}
      kept.push(line);
    }
    const text=kept.join('\n');
    const matches=[...text.matchAll(/(?:^|\n)\s*([ａ-ｄa-d])\s+([\s\S]*?)(?=(?:\n\s*[ａ-ｄa-d]\s+)|(?:\n\s*[１-５1-5]\s*[（(])|(?:\n\s*[１-５1-5]\s+(?:正|誤))|$)/g)];
    const out={};
    for(const m of matches){
      const key=m[1].normalize('NFKC').toLowerCase();
      const body=cleanExamParagraph(m[2]).replace(/(?:１|1)[（(].*$/,'').trim();
      const bodyLettersOnly=body.normalize('NFKC').toLowerCase().replace(/[\s　,、.・:：|｜()（）\[\]【】]/g,'');
      const bogusHeader=/^[a-d]{2,4}[ぁ-んァ-ヶー]*$/.test(bodyLettersOnly);
      if(body.length>=2&&!bogusHeader&&!out[key])out[key]=body;
    }
    return out;
  }

  function requiredStatementCount(q){
    const choices=(q.choices||[]).map(x=>String(x??''));
    let maxTruth=0,maxLetters=0;
    for(const choice of choices){
      maxTruth=Math.max(maxTruth,(choice.match(/[正誤]/g)||[]).length);
      maxLetters=Math.max(maxLetters,new Set((choice.match(/[a-dａ-ｄ]/gi)||[]).map(x=>x.normalize('NFKC').toLowerCase())).size);
    }
    return Math.max(maxTruth,maxLetters);
  }

  function isUsableExamQuestion(q){
    const needed=requiredStatementCount(q);
    if(needed<3)return true;
    const statements=sourceStatements(q);
    return Object.keys(statements).length>=needed;
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
    const statements=sourceStatements(q);
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
    if(/[�□■◆◇]|\*RRG|&OLQLFDO|3UDFWLFH|(?:[A-Z][a-z]?){5,}|[0-9A-Za-z]{10,}/.test(t))return false;
    if(/(?:問|正しい組合せ|誤っているものはどれか|正しいものはどれか)$/.test(t))return false;
    if(/^[ぁ-んァ-ヶー\s]+$/.test(t))return false;
    if(/^[^。！？]{0,12}[、：]$/.test(t))return false;

    // 単独では参照先が分からない文脈依存語を含む記述は、一問一答から除外する。
    if(/(?:本剤|本品|本製品|本製剤|当該医薬品|当該製剤|この医薬品|この製剤|その医薬品|その製剤|当該製品|同剤|同製剤|前記|上記|下記|前述|後述|このうち|これらのうち|次の成分|次の記述|この薬|その薬|この制酸薬|その制酸薬|この胃腸薬|その胃腸薬|この目薬|その目薬|このカプセル剤|そのカプセル剤)/.test(t))return false;

    // OCRで「陽イオン界面活性」が「陽性界面活性」等に崩れた記述を除外する。
    if(/(?:陽性|陰性)界面活性/.test(t))return false;

    // 「作用を真菌類示す」のように、目的語と「示す」の間へ不自然な語が挟まった文を除外する。
    if(/作用を(?!示す)[^、。！？]{1,12}示す/.test(t))return false;

    // 「〜ため。」「〜ので。」など、理由節だけが切り出された一問一答は単独で成立しない。
    if(/(?:ため|ので|ことから|ことにより|ことによって|おそれがあるため|可能性があるため)[。！？]$/.test(t))return false;
    if(/^(?:そのため|このため|したがって|よって|また|なお)[、，]?/.test(t))return false;

    // 前の設問・製品説明・家族構成等がないと対象を特定できない断片を除外する。
    if(/^(?:息子さん|娘さん|お子さん|子ども|子供|報告者)(?:が|に対しては|に対して|へは|への)/.test(t))return false;
    if(/^ウェブサイトに直接入力することによる電子的な報告/.test(t))return false;

    // 「カプセル剤のため、〜」など、対象説明の後半だけ切り出された理由始まりを除外する。
    if(/^[^。！？、]{1,24}(?:のため|であるため|なので)[、，]/.test(t))return false;

    // 指示語だけで対象を示す書き出しは、一問一答として単独で成立しない。
    if(/^(?:これ|それ|このもの|そのもの|当該品)(?:は|を|に|が|で)/.test(t))return false;

    return true;
  }

  function normalizeSimilarityText(value){
    return cleanText(value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/(?:である|とされる|ことがある|場合がある|こととされている|こととされる)/g,'')
      .replace(/(?:ではない|ない|なく|ず|誤り|誤っている|正しい|適切|不適切)/g,'')
      .replace(/[\s　、。！？「」『』（）()【】［］・:：;；,，.．―—ー－]/g,'');
  }
  function ngramSet(text,n=3){const set=new Set();for(let i=0;i<=text.length-n;i++)set.add(text.slice(i,i+n));return set;}
  function diceSimilarity(a,b,n=3){
    const x=normalizeSimilarityText(a),y=normalizeSimilarityText(b);
    if(!x||!y)return 0;
    if(x===y)return 1;
    if(Math.min(x.length,y.length)>=18&&(x.includes(y)||y.includes(x)))return Math.min(x.length,y.length)/Math.max(x.length,y.length);
    const A=ngramSet(x,n),B=ngramSet(y,n);if(!A.size||!B.size)return 0;
    let common=0;for(const v of A)if(B.has(v))common++;
    return (2*common)/(A.size+B.size);
  }
  function isNearDuplicateOneByOne(candidate,selectedQuestions){
    const c=cleanText(candidate.statement);
    for(const prev of selectedQuestions){
      if(candidate.source_question_id&&prev.source_question_id===candidate.source_question_id)return true;
      const p=cleanText(prev.statement);
      const sim=diceSimilarity(c,p,3);
      if(sim>=0.62)return true;
      const c2=normalizeSimilarityText(c),p2=normalizeSimilarityText(p);
      if(Math.min(c2.length,p2.length)>=24){
        const shorter=c2.length<=p2.length?c2:p2,longer=c2.length<=p2.length?p2:c2;
        if(longer.includes(shorter)&&shorter.length/longer.length>=0.68)return true;
      }
    }
    return false;
  }
  function isNearDuplicateExam(candidate,selectedQuestions){
    const c=questionSemanticText(candidate);
    for(const prev of selectedQuestions){
      if(candidate.question_id===prev.question_id)return true;
      const sim=diceSimilarity(c,questionSemanticText(prev),3);
      if(sim>=0.68)return true;
    }
    return false;
  }
  function buildOneByOnePool(questions){return questions.flatMap(deriveOneByOne).filter(x=>isNaturalStatement(x.statement))}
  function toOneByOneQuestion(q,no){const answer=q.truth?'○':'×';return {no,chapter:q.chapter,theme:`東京都${q.year}年度`,knowledge_id:q.question_id,source:`過去問（東京都${q.year}年度 問${q.question_no}）`,answer,text:cleanText(q.statement),shortExplanation:`正答は「${answer}」です。`,explanation:`正答は「${answer}」です。東京都${q.year}年度 問${q.question_no}の公式過去問に基づく記述です。記述の主語・条件・例外を確認してください。`,category:'one_by_one',category_label:'一問一答'}}

  function pickByDistribution(pool,distribution,random,blocked,selected,selectedQuestions=[],duplicateGuard=null){const picked=[];for(const [chapter,count] of Object.entries(distribution))picked.push(...pick(pool.filter(q=>q.chapter===chapter),count,random,blocked,selected,selectedQuestions,duplicateGuard));return picked}
  function makeSet({pool,distribution,count,id,title,note,random,blocked,selected,mapper,selectedQuestions=[],duplicateGuard=null}){let picked=pickByDistribution(pool,distribution,random,blocked,selected,selectedQuestions,duplicateGuard);if(picked.length<count){for(const q of shuffle(pool,random)){if(picked.length>=count)break;if(selected.has(q.question_id)||blocked.has(q.question_id))continue;if(duplicateGuard&&duplicateGuard(q,selectedQuestions))continue;picked.push(q);selected.add(q.question_id);selectedQuestions.push(q)}}if(picked.length<count)throw new Error(`${title}を${count}問確保できませんでした（類似問題除外後）`);return {id,title,note,questions:shuffle(picked,random).map((q,i)=>mapper(q,i+1))}}
  const KIND_LABELS={normal:'通常',practice:'練習',development:'開発'};
  function generatedTitle(date,kind,sequence=1){const d=date.replace(/-/g,'/'),n=Math.max(1,Number(sequence)||1);if(kind==='practice')return `${d}（練習${n===1?'':n}）`;if(kind==='development')return `${d}（開発${n===1?'':n}）`;return n===1?d:`${d}（${n}）`}
  function saveHistory(result,mode,kind){const ids=result.sets.flatMap(s=>s.questions.map(q=>q.knowledge_id));const rows=history();rows.push({dayId:result.id,date:result.date.replace(/\//g,'-'),resultTitle:result.title,category:result.category,mode,kind,questionIds:ids,createdAt:new Date().toISOString()});localStorage.setItem(HISTORY_KEY,JSON.stringify(rows.slice(-100)))}
  function generate({questions,date,dayId,title,mode='exam_style',kind='normal',sequence=1}){
    const actualTitle=title||generatedTitle(date,kind,sequence);
    const random=rng(hashSeed(`${date}|${dayId}|${mode}|${kind}|${questions.length}`)),blocked=recentIds(mode,3),selected=new Set();
    let result;
    if(mode==='one_by_one'){
      const pool=buildOneByOnePool(questions),sets=[],selectedQuestions=[];
      if(pool.length<120)throw new Error(`一問一答の使用可能問題が不足しています（${pool.length}問）`);
      for(let i=1;i<=4;i++)sets.push(makeSet({pool,distribution:DISTRIBUTIONS.one_by_one,count:30,id:`${dayId}-set-${i}`,title:`第${i}セット`,note:`全120問中 ${i}/4`,random,blocked,selected,mapper:toOneByOneQuestion,selectedQuestions,duplicateGuard:isNearDuplicateOneByOne}));
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'one_by_one',category_label:'一問一答',mode:'one_by_one',kind,sets};
    }else if(mode==='practice60'){
      const examPool=questions.filter(isUsableExamQuestion),selectedQuestions=[];
      const full=makeSet({pool:examPool,distribution:DISTRIBUTIONS.practice60,count:60,id:`${dayId}-practice60`,title:'総合演習 60問',note:'全5章を本番比率で総合演習',random,blocked,selected,mapper:toExamQuestion,selectedQuestions,duplicateGuard:isNearDuplicateExam});
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'practice60',category_label:'総合演習60問',mode:'practice60',kind,sets:[{id:`${dayId}-practice60-front`,title:'前半 30問',note:'総合演習60問の前半',questions:full.questions.slice(0,30)},{id:`${dayId}-practice60-back`,title:'後半 30問',note:'総合演習60問の後半',questions:full.questions.slice(30)}]};
    }else{
      const examPool=questions.filter(isUsableExamQuestion),selectedQuestions=[];
      const front=makeSet({pool:examPool,distribution:DISTRIBUTIONS.exam_am,count:60,id:`${dayId}-front`,title:'前半 60問',note:'第1章20・第2章20・第4章20',random,blocked,selected,mapper:toExamQuestion,selectedQuestions,duplicateGuard:isNearDuplicateExam});
      const back=makeSet({pool:examPool,distribution:DISTRIBUTIONS.exam_pm,count:60,id:`${dayId}-back`,title:'後半 60問',note:'第3章40・第5章20',random,blocked,selected,mapper:toExamQuestion,selectedQuestions,duplicateGuard:isNearDuplicateExam});
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'exam_style',category_label:'本番形式120問',mode:'exam_style',kind,sets:[front,back]};
    }
    result.schemaVersion="2.0";result.embeddedAnswerData=true;result.generation_kind=kind;result.generation_kind_label=KIND_LABELS[kind]||kind;result.generation_sequence=Math.max(1,Number(sequence)||1);result.generated_at=new Date().toISOString();saveHistory(result,mode,kind);return result;
  }

  window.TouhanGenerator={generate,buildOneByOnePool,DISTRIBUTIONS,HISTORY_KEY,KIND_LABELS,generatedTitle,cleanText,stripSourceQuestionNumber,formatExamQuestionText,formatExamChoiceText,extractLetterStatements,isUsableExamQuestion,isNaturalStatement,diceSimilarity,isNearDuplicateOneByOne,isNearDuplicateExam,sourceStatements,questionSemanticText};
})();
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
  function download(name,obj){const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u)}
  document.addEventListener('DOMContentLoaded',()=>{
    $('genDate').value=today();syncMeta();$('genDate').addEventListener('change',syncMeta);$('genRound').addEventListener('input',syncMeta);$('genMode').addEventListener('change',syncMeta);$('genKind').addEventListener('change',syncMeta);
    $('loadDbBtn').onclick=()=>loadBundled().catch(e=>setStatus(e.message,'err'));
    $('validateDbBtn').onclick=()=>validate().catch(e=>setStatus(e.message,'err'));
    $('masterFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;rawDb=JSON.parse(await f.text());report=null;setStatus(`ローカルDB読込完了：${rawDb.questions?.length||0}問`,'ok')}catch(err){setStatus(`読込失敗：${err.message}`,'err')}};
    $('generateDailyBtn').onclick=async()=>{try{if(!report)await validate();const mode=$('genMode').value;generated=TouhanGenerator.generate({questions:report.valid,date:$('genDate').value,dayId:$('genDayId').value.trim(),title:$('genTitle').value.trim(),mode,kind:$('genKind').value,sequence:Number($('genRound').value)||1});renderGenerated(generated);setStatus(`${mode==='one_by_one'?'一問一答':mode==='practice60'?'総合演習':'本番問題'}を生成しました。統合JSONを学習アプリへ取り込めます。`,'ok')}catch(e){setStatus(`生成失敗：${e.message}`,'err')}};
    $('downloadDailyBtn').onclick=()=>generated?download(`${generated.id}_all_sets.json`,generated):setStatus('先に問題を生成してください','err');
    $('downloadSetsBtn').onclick=()=>{if(!generated)return setStatus('先に問題を生成してください','err');generated.sets.forEach(set=>download(`${set.id}.json`,{...generated,sets:[set]}))};
    loadBundled().then(validate).catch(e=>setStatus(`自動読込できません。ローカルDBを選択してください：${e.message}`,'err'));
  });
})();
