(function(){
  const DISTRIBUTIONS={
    one_by_one:{'第1章':5,'第2章':5,'第3章':5,'第4章':10,'第5章':5},
    practice60:{'第1章':10,'第2章':10,'第3章':20,'第4章':10,'第5章':10},
    exam_am:{'第1章':20,'第2章':20,'第4章':20},
    exam_pm:{'第3章':40,'第5章':20}
  };
  const HISTORY_KEY='touhan.engine.generator.history.v085';

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
    const statements=extractLetterStatements(q);
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
    const statements=extractLetterStatements(q);
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

    // 単独では参照先が分からない文脈依存語を含む記述は、一問一答から除外する。
    if(/(?:本剤|本品|本製品|本製剤|当該医薬品|当該製剤|この医薬品|この製剤|その医薬品|その製剤|当該製品|同剤|同製剤|前記|上記|下記|前述|後述|このうち|これらのうち|次の成分|次の記述)/.test(t))return false;

    // OCRで「陽イオン界面活性」が「陽性界面活性」等に崩れた記述を除外する。
    if(/(?:陽性|陰性)界面活性/.test(t))return false;

    // 「作用を真菌類示す」のように、目的語と「示す」の間へ不自然な語が挟まった文を除外する。
    if(/作用を(?!示す)[^、。！？]{1,12}示す/.test(t))return false;

    // 「〜ため。」「〜ので。」など、理由節だけが切り出された一問一答は単独で成立しない。
    if(/(?:ため|ので|ことから|ことにより|ことによって|おそれがあるため|可能性があるため)[。！？]$/.test(t))return false;
    if(/^(?:そのため|このため|したがって|よって|また|なお)[、，]?/.test(t))return false;

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
      const examPool=questions.filter(isUsableExamQuestion);
      const full=makeSet({pool:examPool,distribution:DISTRIBUTIONS.practice60,count:60,id:`${dayId}-practice60`,title:'総合演習 60問',note:'全5章を本番比率で総合演習',random,blocked,selected,mapper:toExamQuestion});
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'practice60',category_label:'総合演習60問',mode:'practice60',kind,sets:[{id:`${dayId}-practice60-front`,title:'前半 30問',note:'総合演習60問の前半',questions:full.questions.slice(0,30)},{id:`${dayId}-practice60-back`,title:'後半 30問',note:'総合演習60問の後半',questions:full.questions.slice(30)}]};
    }else{
      const examPool=questions.filter(isUsableExamQuestion);
      const front=makeSet({pool:examPool,distribution:DISTRIBUTIONS.exam_am,count:60,id:`${dayId}-front`,title:'前半 60問',note:'第1章20・第2章20・第4章20',random,blocked,selected,mapper:toExamQuestion});
      const back=makeSet({pool:examPool,distribution:DISTRIBUTIONS.exam_pm,count:60,id:`${dayId}-back`,title:'後半 60問',note:'第3章40・第5章20',random,blocked,selected,mapper:toExamQuestion});
      result={id:dayId,title:actualTitle,date:date.replace(/-/g,'/'),category:'exam_style',category_label:'本番形式120問',mode:'exam_style',kind,sets:[front,back]};
    }
    result.schemaVersion="2.0";result.embeddedAnswerData=true;result.generation_kind=kind;result.generation_kind_label=KIND_LABELS[kind]||kind;result.generation_sequence=Math.max(1,Number(sequence)||1);result.generated_at=new Date().toISOString();saveHistory(result,mode,kind);return result;
  }

  window.TouhanGenerator={generate,buildOneByOnePool,DISTRIBUTIONS,HISTORY_KEY,KIND_LABELS,generatedTitle,cleanText,stripSourceQuestionNumber,formatExamQuestionText,formatExamChoiceText,extractLetterStatements,isUsableExamQuestion,isNaturalStatement,diceSimilarity,isNearDuplicateOneByOne};
})();
