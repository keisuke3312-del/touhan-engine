const SET_DISTRIBUTION = { "第1章": 5, "第2章": 5, "第3章": 10, "第4章": 5, "第5章": 5 };

function normalizeAnswer(raw) {
  return (raw || "")
    .replace(/\s/g, "")
    .replace(/◯/g, "○")
    .replace(/〇/g, "○")
    .replace(/[oO]/g, "○")
    .replace(/[xX]/g, "×");
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem("touhan.v02.grade.history") || "[]"); }
  catch { return []; }
}

function getUsedKnowledgeToday(date) {
  try {
    const items = JSON.parse(localStorage.getItem("touhan.v02.generated.history") || "[]");
    return new Set(items.filter(x => x.date === date).flatMap(x => x.knowledge_keys || []));
  } catch { return new Set(); }
}

function saveGeneratedHistory(problemJson, internalQuestions) {
  const key = "touhan.v02.generated.history";
  const items = JSON.parse(localStorage.getItem(key) || "[]").filter(x => x.session !== problemJson.sets[0].id);
  items.push({
    date: problemJson.date,
    session: problemJson.sets[0].id,
    question_ids: internalQuestions.map(q => q.question_id),
    knowledge_keys: internalQuestions.map(q => q.knowledge_key)
  });
  localStorage.setItem(key, JSON.stringify(items));
}

function buildWeakMap() {
  const history = getHistory();
  const map = {};
  for (const g of history) {
    for (const w of (g.wrong_questions || [])) {
      const k = w.knowledge_key || w.summary || `wrong-${w.no}`;
      map[k] = (map[k] || 0) + 1;
    }
  }
  return map;
}

function scoreQuestion(q, index, usedToday, weakMap, setNo) {
  let score = 0;
  score += (q.frequency_rank || 3) * 10;
  if (weakMap[q.knowledge_key]) score += Math.min(40, weakMap[q.knowledge_key] * 15);
  if (usedToday.has(q.knowledge_key)) score -= 1000;
  score += (index % 7); 
  score -= Math.abs(((setNo - 1) * 30) - index) * 0.01;
  return score;
}

function generateDailySet({ questions, date, dayId, dayTitle, setNo }) {
  const usedToday = getUsedKnowledgeToday(date);
  const weakMap = buildWeakMap();
  const selected = [];
  const internalSelected = [];
  const usedKnowledge = new Set([...usedToday]);

  for (const [chapter, count] of Object.entries(SET_DISTRIBUTION)) {
    let candidates = questions
      .map((q, i) => ({...q, __index: i, __score: scoreQuestion(q, i, usedToday, weakMap, setNo)}))
      .filter(q =>
        q.is_active !== false &&
        q.chapter === chapter &&
        q.format === "true_false" &&
        ["A", "B"].includes(q.quality_rank || "B") &&
        q.answer &&
        q.question_text &&
        q.explanation
      )
      .sort((a,b) => b.__score - a.__score);

    const picked = [];
    for (const q of candidates) {
      if (picked.length >= count) break;
      if (usedKnowledge.has(q.knowledge_key)) continue;
      picked.push(q);
      usedKnowledge.add(q.knowledge_key);
    }

    if (picked.length < count) {
      for (const q of candidates) {
        if (picked.length >= count) break;
        if (picked.some(x => x.question_id === q.question_id)) continue;
        picked.push(q);
      }
    }

    internalSelected.push(...picked);
  }

  const appQuestions = internalSelected.map((q, idx) => ({
    no: idx + 1,
    chapter: q.chapter,
    source: q.source_type === "official_past_exam" ? "過去問" : "改題",
    answer: q.answer,
    text: q.question_text,
    explanation: q.explanation,
    _question_id: q.question_id,
    _knowledge_key: q.knowledge_key
  }));

  const json = {
    id: dayId,
    title: dayTitle,
    date,
    category: "one_by_one",
    category_label: "一問一答",
    sets: [{
      id: `${dayId}-set-${setNo}`,
      title: `第${setNo}セット`,
      note: `全120問中 ${setNo}/4`,
      questions: appQuestions
    }]
  };

  validateProblemJson(json);
  saveGeneratedHistory(json, internalSelected);
  return json;
}

function generateAllSets({ questions, date, dayId, dayTitle }) {
  const sets = [];
  for (let setNo = 1; setNo <= 4; setNo++) {
    const generated = generateDailySet({ questions, date, dayId, dayTitle, setNo });
    sets.push(generated.sets[0]);
  }
  const all = {
    id: dayId,
    title: dayTitle,
    date,
    category: "one_by_one",
    category_label: "一問一答",
    sets
  };
  return all;
}

function validateProblemJson(data) {
  if (!data.id || !data.title || !data.date) throw new Error("基本情報が不足しています。");
  if (!["one_by_one", "exam_style"].includes(data.category)) throw new Error("categoryが不正です。");
  if (!Array.isArray(data.sets) || data.sets.length < 1) throw new Error("setsが不正です。");
  for (const set of data.sets) {
    const qs = set.questions;
    if (!Array.isArray(qs) || qs.length !== 30) throw new Error(`${set.id}の問題数が30問ではありません: ${qs.length}`);
    for (const q of qs) {
      if (!q.no || !q.chapter || !q.source || !q.text || !q.explanation) throw new Error(`問題${q.no}の項目不足`);
      if (!["○", "×"].includes(q.answer)) throw new Error(`問題${q.no}のanswerが不正`);
    }
  }
}

function gradeProblemJson(problemJson, rawAnswer, setIndex = 0, existingGradeHistory = getHistory()) {
  const set = problemJson.sets[setIndex];
  const qs = set.questions;
  const answer = normalizeAnswer(rawAnswer);

  if (answer.length !== qs.length) {
    throw new Error(`回答数が一致しません。現在:${answer.length} 必要:${qs.length}`);
  }

  let correct = 0;
  const chapterMap = {};
  const wrong = [];

  qs.forEach((q, i) => {
    const user = answer[i];
    const ok = user === q.answer;
    if (!chapterMap[q.chapter]) chapterMap[q.chapter] = { correct: 0, total: 0, accuracy: 0 };
    chapterMap[q.chapter].total += 1;
    if (ok) {
      correct += 1;
      chapterMap[q.chapter].correct += 1;
    } else {
      wrong.push({
        no: q.no,
        chapter: q.chapter,
        correct_answer: q.answer,
        user_answer: user,
        question_id: q._question_id || "",
        knowledge_key: q._knowledge_key || "",
        summary: q.explanation
      });
    }
  });

  for (const ch of Object.keys(chapterMap)) {
    chapterMap[ch].accuracy = Math.round((chapterMap[ch].correct / chapterMap[ch].total) * 1000) / 10;
  }

  const total = qs.length;
  const score = { correct, total, accuracy: Math.round((correct / total) * 1000) / 10 };

  const old = Array.isArray(existingGradeHistory) ? existingGradeHistory.filter(x => x.session !== set.id) : [];
  const cumulativeCorrect = old.reduce((s, x) => s + (x.score?.correct || 0), 0) + correct;
  const cumulativeTotal = old.reduce((s, x) => s + (x.score?.total || 0), 0) + total;

  const grade = {
    date: problemJson.date,
    session: set.id,
    category: problemJson.category,
    score,
    cumulative: {
      correct: cumulativeCorrect,
      total: cumulativeTotal,
      accuracy: Math.round((cumulativeCorrect / cumulativeTotal) * 1000) / 10
    },
    chapter_accuracy: chapterMap,
    wrong_questions: wrong,
    danger_knowledge: buildDangerKnowledge(wrong, chapterMap)
  };

  const updated = [...old, grade];
  localStorage.setItem("touhan.v02.grade.history", JSON.stringify(updated));
  return grade;
}

function buildDangerKnowledge(wrong, chapterMap) {
  if (wrong.length === 0) return { label: "なし", reason: "今回の誤答はありません。" };
  const byChapter = {};
  wrong.forEach(w => byChapter[w.chapter] = (byChapter[w.chapter] || 0) + 1);
  const worst = Object.entries(byChapter).sort((a,b)=>b[1]-a[1])[0][0];

  const bySub = {};
  wrong.forEach(w => {
    const label = w.knowledge_key || w.summary;
    bySub[label] = (bySub[label] || 0) + 1;
  });

  if (worst === "第3章") return { label: "第3章の成分名と作用の対応", reason: "成分分類・作用での誤答が出ています。" };
  if (worst === "第4章") return { label: "薬事関係法規・販売制度", reason: "制度問題は法改正影響もあるため優先復習対象です。" };
  if (worst === "第5章") return { label: "適正使用・安全対策制度", reason: "制度名と対象範囲の取り違えが起こりやすい分野です。" };
  return { label: `${worst}の基礎知識`, reason: "同章内で誤答が出ています。" };
}

function getStats() {
  const history = getHistory();
  const total = history.reduce((s,g)=>s+(g.score?.total||0),0);
  const correct = history.reduce((s,g)=>s+(g.score?.correct||0),0);
  const chapters = {};
  for (const g of history) {
    for (const [ch, v] of Object.entries(g.chapter_accuracy || {})) {
      if (!chapters[ch]) chapters[ch] = {correct:0,total:0,accuracy:0};
      chapters[ch].correct += v.correct;
      chapters[ch].total += v.total;
    }
  }
  for (const ch of Object.keys(chapters)) {
    chapters[ch].accuracy = Math.round((chapters[ch].correct / chapters[ch].total) * 1000) / 10;
  }
  return {
    total,
    correct,
    accuracy: total ? Math.round((correct / total) * 1000) / 10 : 0,
    chapters,
    sessions: history.length
  };
}
let QUESTIONS_DB = [{"question_id": "q-v02-001", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "医薬品の基本", "sub_category": "副作用", "knowledge_key": "医薬品は副作用を生じ得る", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品は、有益な作用だけでなく副作用を生じることがある。", "answer": "○", "explanation": "医薬品は有効性と安全性の両面を持ち、適正使用でも副作用を生じることがある。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["医薬品の基本", "副作用"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-002", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "適正使用", "sub_category": "用法用量", "knowledge_key": "一般用医薬品も用法用量を超えると危険", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "一般用医薬品は、用法・用量を超えて使用しても安全性に問題はない。", "answer": "×", "explanation": "一般用医薬品でも過量使用は副作用や中毒につながるため、用法・用量を守る必要がある。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["適正使用", "用法用量"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-003", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "セルフメディケーション", "sub_category": "基本", "knowledge_key": "セルフメディケーションは軽度な不調への自己対処を含む", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "セルフメディケーションとは、軽度な身体の不調について自ら対処する考え方を含む。", "answer": "○", "explanation": "軽度な不調について、自分で健康管理し、必要に応じて一般用医薬品を適正に使用する考え方である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["セルフメディケーション", "基本"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-004", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "受診勧奨", "sub_category": "症状継続", "knowledge_key": "症状長期化時は受診勧奨が必要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "症状が長期間続く場合でも、一般用医薬品のみで対処し続ければよい。", "answer": "×", "explanation": "症状が長引く場合や悪化する場合は、疾病の見落としを避けるため受診勧奨が必要である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["受診勧奨", "症状継続"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-005", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "配慮対象者", "sub_category": "小児高齢者妊婦", "knowledge_key": "小児高齢者妊婦は医薬品使用に注意", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "小児・高齢者・妊婦等では、医薬品の使用に特に注意が必要である。", "answer": "○", "explanation": "年齢や身体状態により薬の作用や副作用の出方が異なるため、慎重な確認が必要である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["配慮対象者", "小児高齢者妊婦"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-006", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "配慮対象者", "sub_category": "高齢者", "knowledge_key": "高齢者は多剤併用による相互作用に注意", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "高齢者では、多剤併用による相互作用に注意する必要がある。", "answer": "○", "explanation": "高齢者は複数の医薬品を使用していることがあり、相互作用や副作用に注意する。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["配慮対象者", "高齢者"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-007", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "配慮対象者", "sub_category": "妊婦", "knowledge_key": "妊婦では胎児への影響を考慮", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "妊婦では、胎児への影響を考慮する必要がある。", "answer": "○", "explanation": "妊婦又は妊娠していると思われる人では、胎児への影響を考慮して慎重に対応する。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["配慮対象者", "妊婦"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-008", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "副作用", "sub_category": "アレルギー", "knowledge_key": "アレルギー体質は過敏反応に注意", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "アレルギー体質では、医薬品による過敏反応に注意が必要である。", "answer": "○", "explanation": "アレルギー体質の人では、発疹、かゆみ等の過敏反応が起こる可能性がある。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["副作用", "アレルギー"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-009", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "医薬品の基本", "sub_category": "プラセボ効果", "knowledge_key": "プラセボ効果は薬理作用のみではない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "プラセボ効果は、有効成分の薬理作用のみによって生じる効果である。", "answer": "×", "explanation": "プラセボ効果は心理的要因等により効果を感じる現象を含む。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["医薬品の基本", "プラセボ効果"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-010", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "情報提供", "sub_category": "代理購入", "knowledge_key": "代理購入では使用者情報確認が重要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "代理購入では、使用者の年齢や症状などの情報確認が重要である。", "answer": "○", "explanation": "購入者と使用者が異なる場合、使用者の状態を確認しないと適切な医薬品選択ができない。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["情報提供", "代理購入"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-011", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "情報提供", "sub_category": "説明", "knowledge_key": "理解しやすい説明が適正使用に重要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "購入者が理解しやすい説明を行うことが、医薬品の適正使用につながる。", "answer": "○", "explanation": "適正使用のためには、購入者が理解できる形で情報提供することが重要である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["情報提供", "説明"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-012", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "副作用", "sub_category": "基本", "knowledge_key": "適正使用でも副作用は起こり得る", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "適正使用していれば、副作用は絶対に起こらない。", "answer": "×", "explanation": "医薬品は適正に使用しても副作用が起こることがある。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["副作用", "基本"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-013", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "副作用", "sub_category": "初期症状", "knowledge_key": "重篤副作用の初期症状把握は早期対応に役立つ", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "重篤な副作用の初期症状を知ることは、早期対応に役立つ。", "answer": "○", "explanation": "初期症状を知っておくことで、使用中止や受診勧奨などの早期対応がしやすくなる。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["副作用", "初期症状"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-014", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "医薬品の基本", "sub_category": "診断", "knowledge_key": "一般用医薬品は診断確定目的ではない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "一般用医薬品は、疾病の診断を確定する目的で販売される。", "answer": "×", "explanation": "疾病の診断は医師等が行うものであり、一般用医薬品は症状緩和等に用いられる。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["医薬品の基本", "診断"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-015", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "適正使用", "sub_category": "乱用", "knowledge_key": "青少年には医薬品乱用注意喚起が必要な場合がある", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "青少年では、医薬品の乱用に関する注意喚起が必要となる場合がある。", "answer": "○", "explanation": "濫用等のおそれのある医薬品では、青少年を含め適正使用の注意喚起が重要である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["適正使用", "乱用"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-016", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "保管", "sub_category": "品質", "knowledge_key": "医薬品の品質は保管状態に影響される", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品の品質は、保管状態によって影響を受けることがある。", "answer": "○", "explanation": "高温、多湿、直射日光などにより医薬品の品質が低下することがある。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["保管", "品質"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-017", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "情報提供", "sub_category": "確認", "knowledge_key": "使用経験だけで同じ医薬品を勧めてはいけない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "過去に使用経験があれば、今回も必ず同じ医薬品を勧めればよい。", "answer": "×", "explanation": "同じ人でも症状や併用薬、身体状態が異なる場合があるため、毎回確認が必要である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["情報提供", "確認"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-018", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "副作用", "sub_category": "相談", "knowledge_key": "副作用相談では使用中止や受診勧奨を検討", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "副作用が疑われる相談では、必要に応じて使用中止や受診を勧める。", "answer": "○", "explanation": "副作用が疑われる場合は、安全確保を優先し、使用中止や受診勧奨を検討する。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["副作用", "相談"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-019", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "相互作用", "sub_category": "健康食品", "knowledge_key": "健康食品との併用でも相互作用に注意", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "健康食品やサプリメントとの併用でも、医薬品との相互作用が問題になることがある。", "answer": "○", "explanation": "食品や健康食品でも医薬品の作用に影響することがあるため確認が必要である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["相互作用", "健康食品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-020", "year": "unknown", "region": "unknown", "chapter": "第1章", "category": "適正使用", "sub_category": "添付文書", "knowledge_key": "添付文書や製品表示に従うことが重要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品は、添付文書や製品表示に従って使用することが重要である。", "answer": "○", "explanation": "添付文書や表示には適正使用のための重要事項が記載されている。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["適正使用", "添付文書"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-021", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "消化管", "knowledge_key": "消化管は口腔から肛門まで続く", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "消化管は、口腔から肛門まで続く管である。", "answer": "○", "explanation": "消化管は口腔、咽頭、食道、胃、小腸、大腸、肛門へと続く。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "消化管"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-022", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "唾液", "knowledge_key": "唾液にはでんぷん分解酵素が含まれる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "唾液には、でんぷんを分解する消化酵素が含まれる。", "answer": "○", "explanation": "唾液にはアミラーゼが含まれ、でんぷんの消化に関与する。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "唾液"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-023", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "胃液", "knowledge_key": "胃液中の塩酸は胃内を酸性に保つ", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "胃液中の塩酸は、胃内をアルカリ性に保つ働きがある。", "answer": "×", "explanation": "胃液中の塩酸により胃内は酸性に保たれる。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "胃液"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-024", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "小腸", "knowledge_key": "小腸は栄養分の消化吸収の主要部位", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "小腸は、栄養分の消化・吸収の主要な部位である。", "answer": "○", "explanation": "小腸では消化された栄養分の多くが吸収される。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "小腸"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-025", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "肝臓胆汁", "knowledge_key": "胆汁は肝臓で産生される", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "肝臓では胆汁が産生される。", "answer": "○", "explanation": "胆汁は肝臓で産生され、胆のうに貯蔵される。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "肝臓胆汁"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-026", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "胆のう", "knowledge_key": "胆汁は胆のうで産生されない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "胆汁は胆のうで産生される。", "answer": "×", "explanation": "胆汁は肝臓で産生され、胆のうでは主に貯蔵・濃縮される。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "胆のう"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-027", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "膵液", "knowledge_key": "膵液には消化酵素が含まれる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "膵液には、消化酵素が含まれる。", "answer": "○", "explanation": "膵液には糖質、脂質、タンパク質の消化に関わる酵素が含まれる。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "膵液"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-028", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "消化器系", "sub_category": "大腸", "knowledge_key": "大腸では主に水分吸収が行われる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "大腸では、主に水分の吸収が行われる。", "answer": "○", "explanation": "大腸では水分が吸収され、便の形成にも関与する。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["消化器系", "大腸"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-029", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "呼吸器系", "sub_category": "肺胞", "knowledge_key": "肺胞ではガス交換が行われる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "肺胞では、酸素と二酸化炭素のガス交換が行われる。", "answer": "○", "explanation": "肺胞は血液と空気の間で酸素と二酸化炭素を交換する場である。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["呼吸器系", "肺胞"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-030", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "循環器系", "sub_category": "心臓", "knowledge_key": "右心室からの血液は肺へ送られる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "右心室から送り出された血液は、肺へ送られる。", "answer": "○", "explanation": "右心室から出た血液は肺動脈を通って肺へ送られる。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["循環器系", "心臓"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-031", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "血液", "sub_category": "赤血球", "knowledge_key": "赤血球は酸素運搬に関与", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "赤血球は、主に酸素の運搬に関与する。", "answer": "○", "explanation": "赤血球中のヘモグロビンが酸素の運搬に重要な役割を果たす。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["血液", "赤血球"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-032", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "血液", "sub_category": "白血球", "knowledge_key": "白血球は血液凝固が主役ではない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "白血球は、血液凝固を主な役割とする。", "answer": "×", "explanation": "白血球は免疫に関与し、血液凝固には主に血小板が関与する。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["血液", "白血球"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-033", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "泌尿器系", "sub_category": "腎臓", "knowledge_key": "腎臓は尿生成と老廃物排泄に関与", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "腎臓は、尿を生成して老廃物の排泄に関与する。", "answer": "○", "explanation": "腎臓は血液をろ過し、尿を生成して老廃物を排泄する。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["泌尿器系", "腎臓"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-034", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "泌尿器系", "sub_category": "膀胱", "knowledge_key": "膀胱は尿を一時貯留する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "膀胱は、尿を一時的に貯留する器官である。", "answer": "○", "explanation": "膀胱は腎臓で作られた尿を排尿まで一時的にためる。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["泌尿器系", "膀胱"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-035", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "自律神経", "sub_category": "交感神経", "knowledge_key": "交感神経優位で心拍数は増加しやすい", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "交感神経が優位になると、一般に心拍数は増加しやすい。", "answer": "○", "explanation": "交感神経は活動時に優位となり、心拍数増加などを起こしやすい。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["自律神経", "交感神経"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-036", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "自律神経", "sub_category": "副交感神経", "knowledge_key": "副交感神経優位で消化管運動は促進されやすい", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "副交感神経が優位になると、一般に消化管運動は抑制される。", "answer": "×", "explanation": "副交感神経は一般に消化管運動を促進する方向に働く。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["自律神経", "副交感神経"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-037", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "皮膚", "sub_category": "バリア", "knowledge_key": "皮膚は異物侵入を防ぐバリアである", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "皮膚は、外界からの異物の侵入を防ぐバリアとして働く。", "answer": "○", "explanation": "皮膚は角質層などにより外界からの刺激や異物侵入を防ぐ。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["皮膚", "バリア"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-038", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "感覚器", "sub_category": "水晶体", "knowledge_key": "水晶体は光を屈折させ焦点を合わせる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "水晶体は、光を屈折させて網膜に焦点を合わせる働きがある。", "answer": "○", "explanation": "水晶体は厚みを変えて光を屈折させ、網膜に像を結ぶ。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["感覚器", "水晶体"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-039", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "感覚器", "sub_category": "中耳", "knowledge_key": "中耳は音の振動を伝える", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "中耳には鼓膜や耳小骨があり、音の振動を伝える。", "answer": "○", "explanation": "鼓膜や耳小骨は音の振動を内耳へ伝える働きをする。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["感覚器", "中耳"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-040", "year": "unknown", "region": "unknown", "chapter": "第2章", "category": "薬の体内動態", "sub_category": "吸収", "knowledge_key": "経口薬は主に小腸から吸収されることが多い", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "経口薬の成分は、主に小腸から吸収されることが多い。", "answer": "○", "explanation": "経口投与された医薬品成分の多くは小腸から吸収される。", "difficulty": 2, "frequency_rank": 4, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["薬の体内動態", "吸収"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-041", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "解熱鎮痛薬", "sub_category": "解熱鎮痛成分", "knowledge_key": "アセトアミノフェンは解熱鎮痛成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "アセトアミノフェンは、解熱鎮痛成分として用いられる。", "answer": "○", "explanation": "アセトアミノフェンは発熱や痛みを和らげる目的で用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["解熱鎮痛薬", "解熱鎮痛成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-042", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "解熱鎮痛薬", "sub_category": "NSAIDs", "knowledge_key": "イブプロフェンはNSAIDs", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "イブプロフェンは、非ステロイド性抗炎症成分である。", "answer": "○", "explanation": "イブプロフェンはNSAIDsに分類され、解熱鎮痛抗炎症作用を示す。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["解熱鎮痛薬", "NSAIDs"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-043", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "解熱鎮痛薬", "sub_category": "アスピリン", "knowledge_key": "アスピリンは15歳未満では原則使用しない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "アスピリンは、15歳未満の小児にも積極的に使用される。", "answer": "×", "explanation": "アスピリンは小児への使用制限があり、15歳未満では原則として使用しない。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["解熱鎮痛薬", "アスピリン"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-044", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "眠気防止薬", "sub_category": "カフェイン", "knowledge_key": "カフェインは眠気防止薬に用いられる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "カフェインは、眠気防止薬などに配合されることがある。", "answer": "○", "explanation": "カフェインには中枢神経興奮作用があり、眠気防止薬等に用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["眠気防止薬", "カフェイン"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-045", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "かぜ薬", "sub_category": "抗ヒスタミン成分", "knowledge_key": "ジフェンヒドラミンは抗ヒスタミン成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ジフェンヒドラミン塩酸塩は、抗ヒスタミン成分である。", "answer": "○", "explanation": "ジフェンヒドラミン塩酸塩は抗ヒスタミン作用を持ち、眠気等に注意する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["かぜ薬", "抗ヒスタミン成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-046", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "かぜ薬", "sub_category": "抗ヒスタミン成分", "knowledge_key": "クロルフェニラミンは抗ヒスタミン成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "クロルフェニラミンマレイン酸塩は、抗ヒスタミン成分として用いられる。", "answer": "○", "explanation": "クロルフェニラミンマレイン酸塩は鼻水、くしゃみ等を抑える目的で配合される。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["かぜ薬", "抗ヒスタミン成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-047", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "鼻炎薬", "sub_category": "アドレナリン作動成分", "knowledge_key": "プソイドエフェドリンは鼻粘膜充血を緩和する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "プソイドエフェドリン塩酸塩は、鼻粘膜の充血を和らげる目的で配合されることがある。", "answer": "○", "explanation": "プソイドエフェドリン塩酸塩は交感神経刺激作用により鼻粘膜の充血を改善する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["鼻炎薬", "アドレナリン作動成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-048", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "鎮咳去痰薬", "sub_category": "鎮咳成分", "knowledge_key": "デキストロメトルファンは鎮咳成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "デキストロメトルファン臭化水素酸塩水和物は、鎮咳成分である。", "answer": "○", "explanation": "デキストロメトルファンは咳中枢に作用し、咳を鎮める。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["鎮咳去痰薬", "鎮咳成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-049", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "鎮咳去痰薬", "sub_category": "去痰成分", "knowledge_key": "グアイフェネシンは去痰成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "グアイフェネシンは、去痰成分である。", "answer": "○", "explanation": "グアイフェネシンは痰の切れをよくする去痰成分である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["鎮咳去痰薬", "去痰成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-050", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "かぜ薬", "sub_category": "抗炎症成分", "knowledge_key": "トラネキサム酸は抗炎症成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "トラネキサム酸は、抗炎症成分として用いられることがある。", "answer": "○", "explanation": "トラネキサム酸は炎症を抑える目的で、咽頭痛等に用いられることがある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["かぜ薬", "抗炎症成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-051", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "止瀉薬", "sub_category": "止瀉成分", "knowledge_key": "ロペラミドは腸管運動抑制性止瀉成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ロペラミド塩酸塩は、腸管運動を抑制する止瀉成分である。", "answer": "○", "explanation": "ロペラミド塩酸塩は腸管運動を抑えて下痢を改善する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["止瀉薬", "止瀉成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-052", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "瀉下薬", "sub_category": "刺激性瀉下成分", "knowledge_key": "センノシドは刺激性瀉下成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "センノシドは、刺激性瀉下成分である。", "answer": "○", "explanation": "センノシドは大腸を刺激して排便を促す刺激性瀉下成分である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["瀉下薬", "刺激性瀉下成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-053", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "瀉下薬", "sub_category": "刺激性瀉下成分", "knowledge_key": "ビサコジルは刺激性瀉下成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ビサコジルは、便秘薬に用いられる刺激性瀉下成分である。", "answer": "○", "explanation": "ビサコジルは大腸を刺激して排便を促す。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["瀉下薬", "刺激性瀉下成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-054", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "瀉下薬", "sub_category": "塩類下剤", "knowledge_key": "酸化マグネシウムは便を軟らかくする", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "酸化マグネシウムは、腸管内に水分を保持して便を軟らかくする。", "answer": "○", "explanation": "酸化マグネシウムは塩類下剤として便を軟らかくする。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["瀉下薬", "塩類下剤"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-055", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "瀉下薬", "sub_category": "刺激性瀉下成分", "knowledge_key": "ピコスルファートナトリウムは刺激性瀉下成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ピコスルファートナトリウムは、止瀉薬として下痢を止める目的で用いられる。", "answer": "×", "explanation": "ピコスルファートナトリウムは刺激性瀉下成分であり、便秘薬に用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["瀉下薬", "刺激性瀉下成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-056", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "胃腸薬", "sub_category": "H2ブロッカー", "knowledge_key": "ファモチジンはH2ブロッカー", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ファモチジンは、胃酸分泌を抑えるH2ブロッカーである。", "answer": "○", "explanation": "ファモチジンはH2受容体を遮断して胃酸分泌を抑える。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["胃腸薬", "H2ブロッカー"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-057", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "胃腸薬", "sub_category": "制酸成分", "knowledge_key": "制酸成分は胃酸を中和する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "制酸成分は、胃酸を中和する目的で用いられる。", "answer": "○", "explanation": "制酸成分は過剰な胃酸を中和して症状を改善する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["胃腸薬", "制酸成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-058", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "胃腸薬", "sub_category": "胃粘膜保護成分", "knowledge_key": "スクラルファートは胃粘膜保護成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "スクラルファートは、胃粘膜を保護する目的で用いられる。", "answer": "○", "explanation": "スクラルファートは胃粘膜保護成分として用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["胃腸薬", "胃粘膜保護成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-059", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "胃腸薬", "sub_category": "消泡成分", "knowledge_key": "ジメチルポリシロキサンは消泡成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ジメチルポリシロキサンは、消化管内のガスを除く目的で用いられることがある。", "answer": "○", "explanation": "ジメチルポリシロキサンは消泡成分として腹部膨満感等に用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["胃腸薬", "消泡成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-060", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "胃腸薬", "sub_category": "健胃生薬", "knowledge_key": "健胃生薬は味や香りで胃の働きを高める", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "健胃生薬は、味や香りなどによって胃の働きを高める目的で用いられることがある。", "answer": "○", "explanation": "健胃生薬は味や香りによる刺激で胃の働きを促すことがある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["胃腸薬", "健胃生薬"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-061", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "禁煙補助剤", "sub_category": "ニコチン", "knowledge_key": "禁煙補助剤は喫煙しながら使用しない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "禁煙補助剤は、喫煙しながら使用することが推奨される。", "answer": "×", "explanation": "ニコチン置換療法では、喫煙しながらの使用は避ける。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["禁煙補助剤", "ニコチン"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-062", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "外用薬", "sub_category": "局所麻酔成分", "knowledge_key": "アミノ安息香酸エチルは局所麻酔成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "アミノ安息香酸エチルは、局所麻酔成分である。", "answer": "○", "explanation": "アミノ安息香酸エチルは局所麻酔作用により痛みやかゆみを抑える。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["外用薬", "局所麻酔成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-063", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "外用薬", "sub_category": "ステロイド成分", "knowledge_key": "ヒドロコルチゾン酢酸エステルはステロイド性抗炎症成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ヒドロコルチゾン酢酸エステルは、ステロイド性抗炎症成分である。", "answer": "○", "explanation": "ヒドロコルチゾン酢酸エステルは炎症を抑えるステロイド成分である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["外用薬", "ステロイド成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-064", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "眼科用薬", "sub_category": "抗菌成分", "knowledge_key": "クロラムフェニコールは抗菌成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "クロラムフェニコールは、抗菌成分として用いられることがある。", "answer": "○", "explanation": "クロラムフェニコールは細菌感染に対する抗菌成分として用いられることがある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["眼科用薬", "抗菌成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-065", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "眼科用薬", "sub_category": "抗菌成分", "knowledge_key": "スルファメトキサゾールはサルファ剤系抗菌成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "スルファメトキサゾールは、サルファ剤系の抗菌成分である。", "answer": "○", "explanation": "スルファメトキサゾールはサルファ剤系抗菌成分である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["眼科用薬", "抗菌成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-066", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "点鼻薬点眼薬", "sub_category": "血管収縮成分", "knowledge_key": "ナファゾリンは血管収縮成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ナファゾリン塩酸塩は、血管収縮成分として点鼻薬や点眼薬に用いられることがある。", "answer": "○", "explanation": "ナファゾリン塩酸塩は血管を収縮させ、充血を改善する目的で用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["点鼻薬点眼薬", "血管収縮成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-067", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "眼科用薬", "sub_category": "人工涙液", "knowledge_key": "人工涙液は涙液補充を目的とする", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "人工涙液は、涙液の補充を目的として用いられる。", "answer": "○", "explanation": "人工涙液は目の乾きに対して涙液を補う目的で用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["眼科用薬", "人工涙液"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-068", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "皮膚用薬", "sub_category": "抗ウイルス成分", "knowledge_key": "アシクロビルは口唇ヘルペス再発治療薬に用いられる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "アシクロビルは、口唇ヘルペスの再発治療薬として用いられることがある。", "answer": "○", "explanation": "アシクロビルは抗ウイルス成分で、口唇ヘルペス再発治療薬に用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["皮膚用薬", "抗ウイルス成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-069", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "皮膚用薬", "sub_category": "抗真菌成分", "knowledge_key": "テルビナフィンは抗真菌成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "テルビナフィン塩酸塩は、抗真菌成分である。", "answer": "○", "explanation": "テルビナフィン塩酸塩はみずむし等に用いられる抗真菌成分である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["皮膚用薬", "抗真菌成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-070", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "皮膚用薬", "sub_category": "鎮痒成分", "knowledge_key": "クロタミトンは鎮痒成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "クロタミトンは、鎮痒成分として用いられる。", "answer": "○", "explanation": "クロタミトンはかゆみを抑える鎮痒成分である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["皮膚用薬", "鎮痒成分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-071", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "外用鎮痛消炎薬", "sub_category": "NSAIDs", "knowledge_key": "インドメタシンは外用NSAIDs", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "インドメタシンは、外用鎮痛消炎薬に用いられる非ステロイド性抗炎症成分である。", "answer": "○", "explanation": "インドメタシンは外用薬に用いられるNSAIDsである。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["外用鎮痛消炎薬", "NSAIDs"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-072", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "外用鎮痛消炎薬", "sub_category": "NSAIDs", "knowledge_key": "フェルビナクは外用鎮痛消炎成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "フェルビナクは、外用鎮痛消炎成分である。", "answer": "○", "explanation": "フェルビナクは外用鎮痛消炎薬に配合されるNSAIDsである。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["外用鎮痛消炎薬", "NSAIDs"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-073", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "外用鎮痛消炎薬", "sub_category": "サリチル酸系", "knowledge_key": "サリチル酸メチルは外用鎮痛消炎成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "サリチル酸メチルは、鎮痛消炎を目的として外用薬に配合されることがある。", "answer": "○", "explanation": "サリチル酸メチルは外用鎮痛消炎成分として用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["外用鎮痛消炎薬", "サリチル酸系"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-074", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "ビタミン主薬製剤", "sub_category": "ビタミンA", "knowledge_key": "ビタミンAは脂溶性で過剰摂取に注意", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ビタミンAは、過剰摂取に注意が必要な脂溶性ビタミンである。", "answer": "○", "explanation": "ビタミンAは脂溶性であり、過剰摂取に注意が必要である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["ビタミン主薬製剤", "ビタミンA"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-075", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "ビタミン主薬製剤", "sub_category": "ビタミンC", "knowledge_key": "ビタミンCはアスコルビン酸", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ビタミンCは、アスコルビン酸とも呼ばれる。", "answer": "○", "explanation": "ビタミンCはアスコルビン酸である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["ビタミン主薬製剤", "ビタミンC"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-076", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "ビタミン主薬製剤", "sub_category": "ビタミンB1", "knowledge_key": "ビタミンB1はチアミン", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ビタミンB1は、チアミンとも呼ばれる。", "answer": "○", "explanation": "ビタミンB1はチアミンとも呼ばれる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["ビタミン主薬製剤", "ビタミンB1"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-077", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "公衆衛生用薬", "sub_category": "ヨウ素", "knowledge_key": "ヨウ素含有殺菌消毒成分は甲状腺疾患に注意", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "ヨウ素を含む殺菌消毒成分では、甲状腺疾患のある人に注意が必要となることがある。", "answer": "○", "explanation": "ポビドンヨード等のヨウ素含有成分では甲状腺疾患のある人に注意が必要な場合がある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["公衆衛生用薬", "ヨウ素"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-078", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "公衆衛生用薬", "sub_category": "エタノール", "knowledge_key": "エタノールは殺菌消毒成分", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "エタノールは、殺菌消毒成分として用いられることがある。", "answer": "○", "explanation": "エタノールは手指や皮膚の殺菌消毒に用いられる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["公衆衛生用薬", "エタノール"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-079", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "漢方処方製剤", "sub_category": "副作用", "knowledge_key": "漢方処方製剤でも副作用は起こる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "漢方処方製剤は、体質や症状に合わない場合でも副作用は起こらない。", "answer": "×", "explanation": "漢方処方製剤でも体質や症状に合わない場合、副作用が起こることがある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["漢方処方製剤", "副作用"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-080", "year": "unknown", "region": "unknown", "chapter": "第3章", "category": "漢方処方製剤", "sub_category": "甘草", "knowledge_key": "甘草含有製剤は偽アルドステロン症に注意", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "甘草を含む漢方処方製剤では、偽アルドステロン症に注意が必要である。", "answer": "○", "explanation": "甘草を含む製剤では偽アルドステロン症が頻出の注意点である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": false, "quality_rank": "B", "is_active": true, "tags": ["漢方処方製剤", "甘草"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-081", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "要指導医薬品", "knowledge_key": "要指導医薬品は薬剤師の対面情報提供が必要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "要指導医薬品は、薬剤師による対面での情報提供等が必要である。", "answer": "○", "explanation": "要指導医薬品は薬剤師による対面での情報提供及び指導が必要である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "要指導医薬品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-082", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "第一類医薬品", "knowledge_key": "第一類医薬品は薬剤師が扱う", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "第一類医薬品は、登録販売者が単独で販売できる。", "answer": "×", "explanation": "第一類医薬品は薬剤師が販売又は情報提供を行う区分であり、登録販売者が単独で扱うことはできない。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "第一類医薬品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-083", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "登録販売者", "knowledge_key": "登録販売者は第二類第三類を販売できる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "第二類医薬品および第三類医薬品は、登録販売者が販売できる。", "answer": "○", "explanation": "登録販売者は第二類医薬品及び第三類医薬品を販売できる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "登録販売者"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-084", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "販売制度", "sub_category": "濫用等のおそれのある医薬品", "knowledge_key": "濫用等のおそれのある医薬品は購入目的等確認が必要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "濫用等のおそれのある医薬品では、購入目的等の確認が必要となる。", "answer": "○", "explanation": "濫用等のおそれのある医薬品では、販売時に購入目的や必要事項を確認する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["販売制度", "濫用等のおそれのある医薬品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-085", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "リスク区分", "knowledge_key": "一般用医薬品はリスク区分に応じて分類される", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "一般用医薬品は、リスク区分に応じて分類されている。", "answer": "○", "explanation": "一般用医薬品はリスクの程度に応じて第一類、第二類、第三類等に区分される。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "リスク区分"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-086", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "法規", "sub_category": "薬機法", "knowledge_key": "医薬品医療機器等法は品質有効性安全性確保を目的とする", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品医療機器等法は、医薬品等の品質、有効性及び安全性の確保等を目的とする。", "answer": "○", "explanation": "医薬品医療機器等法は医薬品等の品質、有効性、安全性の確保を目的とする。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["法規", "薬機法"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-087", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "医薬部外品", "knowledge_key": "医薬部外品は作用が緩和なもの", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬部外品は、人体に対する作用が緩和なものに限られる。", "answer": "○", "explanation": "医薬部外品は人体に対する作用が緩和なものとして定義される。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "医薬部外品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-088", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "化粧品", "knowledge_key": "化粧品は清潔美化等を目的とする", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "化粧品は、人の身体を清潔にし、美化し、魅力を増す等の目的で使用される。", "answer": "○", "explanation": "化粧品は清潔、美化、魅力増進等を目的とし、作用が緩和なものをいう。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "化粧品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-089", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "広告規制", "sub_category": "食品", "knowledge_key": "食品は医薬品的効能効果を自由に標ぼうできない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "食品は、医薬品的な効能効果を標ぼうしても問題ない。", "answer": "×", "explanation": "食品が医薬品的な効能効果を標ぼうすると、医薬品該当性が問題となる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["広告規制", "食品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-090", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "販売業", "sub_category": "店舗販売業", "knowledge_key": "店舗販売業は許可店舗で一般用医薬品等を販売する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "店舗販売業では、許可を受けた店舗で一般用医薬品等を販売する。", "answer": "○", "explanation": "店舗販売業は許可を受けた店舗において一般用医薬品等を販売する形態である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["販売業", "店舗販売業"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-091", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "販売業", "sub_category": "配置販売業", "knowledge_key": "配置販売業は居宅等に医薬品を配置する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "配置販売業では、購入者の居宅等に医薬品を配置し、使用分の代金を受け取る形態がある。", "answer": "○", "explanation": "配置販売業は配置した医薬品の使用分について代金を受け取る販売形態である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["販売業", "配置販売業"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-092", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "薬局", "sub_category": "薬局開設者", "knowledge_key": "薬局開設者は薬局管理に責任を負う", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "薬局開設者は、薬局の管理に関する責任を負う。", "answer": "○", "explanation": "薬局開設者は薬局の管理や法令遵守に関する責任を負う。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["薬局", "薬局開設者"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-093", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "広告規制", "sub_category": "効能効果", "knowledge_key": "未承認効能効果を広告してはならない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品の広告では、承認等を受けていない効能効果を標ぼうしてはならない。", "answer": "○", "explanation": "未承認の効能効果を広告することは虚偽・誇大広告等として問題となる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["広告規制", "効能効果"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-094", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "表示", "sub_category": "容器表示", "knowledge_key": "医薬品の容器等には必要表示事項がある", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品の直接の容器又は被包には、必要な表示事項が定められている。", "answer": "○", "explanation": "医薬品の容器等には名称、成分、使用期限等の必要表示事項が定められている。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["表示", "容器表示"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-095", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "表示", "sub_category": "使用期限", "knowledge_key": "医薬品の使用期限は表示事項である", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品の使用期限は、どのような医薬品でも表示する必要はない。", "answer": "×", "explanation": "医薬品の使用期限は必要な表示事項として扱われる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["表示", "使用期限"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-096", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "毒薬劇薬", "knowledge_key": "毒薬劇薬は一般用医薬品として自由販売できない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "毒薬・劇薬は、一般用医薬品として自由に販売できる。", "answer": "×", "explanation": "毒薬・劇薬は厳格な取扱いが必要であり、一般用医薬品として自由に販売できない。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "毒薬劇薬"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-097", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "医薬品分類", "sub_category": "指定第二類医薬品", "knowledge_key": "指定第二類医薬品は禁忌確認が重要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "指定第二類医薬品では、禁忌確認や注意喚起が特に重要である。", "answer": "○", "explanation": "指定第二類医薬品は使用上の注意で禁忌等があり、購入者への注意喚起が重要である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["医薬品分類", "指定第二類医薬品"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-098", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "販売制度", "sub_category": "特定販売", "knowledge_key": "特定販売にはインターネット販売等が含まれる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "特定販売とは、インターネット販売等、店舗以外の場所にいる者への販売等をいう。", "answer": "○", "explanation": "特定販売にはインターネット等を用いた店舗以外の場所にいる者への販売が含まれる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["販売制度", "特定販売"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-099", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "販売制度", "sub_category": "特定販売表示", "knowledge_key": "特定販売では販売サイト等に必要事項を表示する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "特定販売では、販売サイト等に必要事項を表示する必要がある。", "answer": "○", "explanation": "特定販売では販売サイト等に店舗情報や医薬品区分等の必要事項を表示する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["販売制度", "特定販売表示"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-100", "year": "unknown", "region": "unknown", "chapter": "第4章", "category": "販売制度", "sub_category": "陳列", "knowledge_key": "医薬品の陳列はリスク区分に応じる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品の陳列では、リスク区分に応じた方法が求められる。", "answer": "○", "explanation": "医薬品はリスク区分に応じて区分陳列等が求められる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["販売制度", "陳列"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-101", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "添付文書", "sub_category": "適正使用", "knowledge_key": "添付文書は適正使用の重要な情報源", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "添付文書は、医薬品を適正に使用するための重要な情報源である。", "answer": "○", "explanation": "添付文書には用法・用量、使用上の注意、副作用等の重要情報が記載されている。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["添付文書", "適正使用"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-102", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "添付文書", "sub_category": "してはいけないこと", "knowledge_key": "してはいけないことには副作用等防止の禁止事項がある", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "添付文書の「してはいけないこと」には、守らないと副作用等につながる事項が記載される。", "answer": "○", "explanation": "『してはいけないこと』には、症状悪化や副作用・事故を避けるための禁止事項が記載される。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["添付文書", "してはいけないこと"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-103", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "添付文書", "sub_category": "相談すること", "knowledge_key": "相談することには専門家へ相談すべき事項がある", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "添付文書の「相談すること」には、使用前・使用後に専門家へ相談すべき事項が含まれる。", "answer": "○", "explanation": "使用前や使用後に医師、薬剤師、登録販売者等へ相談すべき事項が記載される。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["添付文書", "相談すること"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-104", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "副作用被害救済制度", "sub_category": "対象範囲", "knowledge_key": "副作用被害救済制度は健康食品対象外", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品副作用被害救済制度は、健康食品による健康被害も対象とする。", "answer": "×", "explanation": "医薬品副作用被害救済制度は、医薬品を適正に使用したにもかかわらず生じた副作用被害を対象とする制度であり、健康食品は対象外である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["副作用被害救済制度", "対象範囲"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-105", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "安全対策", "sub_category": "安全性情報報告", "knowledge_key": "副作用疑い時は安全性情報報告制度への協力が重要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "副作用が疑われる場合には、安全性情報報告制度への協力が重要である。", "answer": "○", "explanation": "医薬品の安全対策のため、副作用が疑われる情報の報告に協力することが重要である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["安全対策", "安全性情報報告"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-106", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "安全対策", "sub_category": "緊急安全性情報", "knowledge_key": "緊急安全性情報は重要な安全性情報として提供される", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "緊急安全性情報は、重篤な副作用等に関する重要な安全性情報として提供される。", "answer": "○", "explanation": "緊急安全性情報は重篤な副作用等に関する重要情報を迅速に提供するためのものである。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["安全対策", "緊急安全性情報"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-107", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "安全対策", "sub_category": "安全性速報", "knowledge_key": "安全性速報は安全対策上必要な情報として発出される", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "安全性速報は、医薬品の安全対策上必要な情報として発出されることがある。", "answer": "○", "explanation": "安全性速報は医薬品の安全対策上、迅速な注意喚起が必要な場合に発出される。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["安全対策", "安全性速報"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-108", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "安全対策", "sub_category": "PMDA", "knowledge_key": "PMDAでは添付文書情報等を確認できる", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "PMDAの医薬品医療機器情報提供ホームページでは、添付文書情報等を確認できる。", "answer": "○", "explanation": "PMDAでは添付文書、緊急安全性情報、安全性速報等を確認できる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["安全対策", "PMDA"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-109", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "保管", "sub_category": "使用期限", "knowledge_key": "使用期限切れ医薬品は使用を避ける", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "使用期限を過ぎた医薬品は、品質が保証されないため使用を避ける。", "answer": "○", "explanation": "使用期限を過ぎると品質、有効性、安全性が保証されないため使用を避ける。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["保管", "使用期限"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-110", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "保管", "sub_category": "小児誤飲", "knowledge_key": "医薬品は小児の手の届かない場所に保管する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "小児の手の届くところに医薬品を保管しても、容器が閉まっていれば問題ない。", "answer": "×", "explanation": "誤飲防止のため、小児の手の届かない場所に保管する必要がある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["保管", "小児誤飲"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-111", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "相談対応", "sub_category": "情報収集", "knowledge_key": "相談対応では症状使用者併用薬既往歴確認が重要", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "一般用医薬品の相談対応では、症状、使用者、併用薬、既往歴等を確認することが重要である。", "answer": "○", "explanation": "適切な情報提供のため、使用者の状態や併用薬、既往歴等の確認が重要である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["相談対応", "情報収集"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-112", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "適正使用", "sub_category": "譲渡", "knowledge_key": "医薬品を他人に譲渡使用させるのは常に適切ではない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品を他人に譲渡して使用させることは、常に適切である。", "answer": "×", "explanation": "医薬品は使用者の状態により適否が異なるため、他人への譲渡使用は適切でない場合がある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["適正使用", "譲渡"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-113", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "添付文書", "sub_category": "保管", "knowledge_key": "添付文書は保管が望ましい", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "外箱を捨てた後でも、添付文書は保管しておくことが望ましい。", "answer": "○", "explanation": "使用中に注意事項を確認できるよう、添付文書は保管しておくことが望ましい。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["添付文書", "保管"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-114", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "副作用", "sub_category": "初期症状", "knowledge_key": "副作用初期症状が出たら必ず継続ではない", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "副作用の初期症状が現れた場合でも、軽ければ必ず服用を継続する。", "answer": "×", "explanation": "副作用が疑われる場合は、使用中止や専門家への相談、受診が必要な場合がある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["副作用", "初期症状"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-115", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "保管", "sub_category": "品質", "knowledge_key": "医薬品保管では直射日光高温多湿を避ける", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品の保管では、直射日光、高温、多湿を避けることが望ましい。", "answer": "○", "explanation": "医薬品の品質保持のため、直射日光、高温、多湿を避けて保管する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["保管", "品質"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-116", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "使用上の注意", "sub_category": "年齢制限", "knowledge_key": "使用上の注意の年齢制限は守る", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "使用上の注意に記載された年齢制限は、守る必要がある。", "answer": "○", "explanation": "年齢制限は安全性に関わるため、記載に従って使用する必要がある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["使用上の注意", "年齢制限"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-117", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "適正使用", "sub_category": "重複投与", "knowledge_key": "同一有効成分含有薬の併用は過量摂取のおそれ", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "同じ有効成分を含む複数の医薬品を併用すると、過量摂取になるおそれがある。", "answer": "○", "explanation": "かぜ薬と解熱鎮痛薬などで同一成分が重複すると過量摂取につながることがある。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["適正使用", "重複投与"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-118", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "受診勧奨", "sub_category": "症状悪化", "knowledge_key": "症状が重い急激悪化時は受診勧奨を検討", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "症状が重い、又は急激に悪化している場合は、受診勧奨を検討する。", "answer": "○", "explanation": "重い症状や急激な悪化は重大な疾病の可能性があるため、受診勧奨が必要となる。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["受診勧奨", "症状悪化"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-119", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "安全対策", "sub_category": "相談対応", "knowledge_key": "リスク情報は使用後相談にも関係する", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "医薬品のリスク情報は、販売時だけでなく使用後の相談対応にも関係する。", "answer": "○", "explanation": "医薬品の安全確保には販売時の情報提供だけでなく、使用後の相談対応も重要である。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["安全対策", "相談対応"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}, {"question_id": "q-v02-120", "year": "unknown", "region": "unknown", "chapter": "第5章", "category": "添付文書", "sub_category": "改訂情報", "knowledge_key": "添付文書改訂情報は最新確認が望ましい", "format": "true_false", "source_type": "modified", "source_note": "公式過去問由来の頻出知識", "question_text": "添付文書の改訂情報は、必要に応じて最新情報を確認することが望ましい。", "answer": "○", "explanation": "添付文書の内容は改訂されることがあるため、必要に応じて最新情報を確認する。", "difficulty": 2, "frequency_rank": 5, "legal_sensitive": true, "quality_rank": "B", "is_active": true, "tags": ["添付文書", "改訂情報"], "created_at": "2026-07-06", "updated_at": "2026-07-06"}];
let currentProblem = null;
let currentAll = null;
let currentGrade = null;

function params(){
  return {
    questions: QUESTIONS_DB,
    date: document.getElementById("date").value,
    dayId: document.getElementById("dayId").value,
    dayTitle: document.getElementById("dayTitle").value,
    setNo: Number(document.getElementById("setNo").value)
  };
}

function showError(e){ alert(e.message || e); }

function generateOne(){
  try{
    currentProblem = generateDailySet(params());
    currentAll = null;
    renderCurrentProblem();
  }catch(e){ showError(e); }
}

function generateAll(){
  try{
    const p = params();
    currentAll = generateAllSets(p);
    const setNo = Number(document.getElementById("setNo").value);
    currentProblem = {
      id: currentAll.id,
      title: currentAll.title,
      date: currentAll.date,
      category: currentAll.category,
      category_label: currentAll.category_label,
      sets: [currentAll.sets[setNo-1]]
    };
    renderCurrentProblem();
  }catch(e){ showError(e); }
}

function renderCurrentSet(){
  if(!currentAll) return;
  const setNo = Number(document.getElementById("setNo").value);
  currentProblem = {
    id: currentAll.id,
    title: currentAll.title,
    date: currentAll.date,
    category: currentAll.category,
    category_label: currentAll.category_label,
    sets: [currentAll.sets[setNo-1]]
  };
  renderCurrentProblem();
}

function renderCurrentProblem(){
  renderQuestions();
  document.getElementById("problemJson").value = JSON.stringify(currentProblem,null,2);
  localStorage.setItem("touhan.v02.problem."+currentProblem.sets[0].id, JSON.stringify(currentProblem));
}

function renderQuestions(){
  const qs = currentProblem.sets[0].questions;
  document.getElementById("questions").innerHTML = qs.map(q =>
    `<div class="q"><b>${q.no}.【${q.chapter}】</b>${q.text}（○ / ×）</div>`
  ).join("");
}

async function copyProblemJson(){
  const text = document.getElementById("problemJson").value;
  await navigator.clipboard.writeText(text);
  alert("問題JSONをコピーしました");
}

function downloadProblemJson(){
  if(!currentProblem) return showError("先に生成してください");
  downloadText(`${currentProblem.sets[0].id}.json`, JSON.stringify(currentProblem,null,2));
}

function downloadAllSets(){
  if(!currentAll) return showError("先に4セット生成してください");
  downloadText(`${currentAll.id}_all_sets.json`, JSON.stringify(currentAll,null,2));
}

function grade(){
  try{
    if(!currentProblem) throw new Error("先に問題を生成してください。");
    currentGrade = gradeProblemJson(currentProblem, document.getElementById("answers").value, 0);
    document.getElementById("gradeJson").value = JSON.stringify(currentGrade,null,2);
    renderGrade();
    renderStats();
  }catch(e){ showError(e); }
}

function renderGrade(){
  const g = currentGrade;
  const wrong = g.wrong_questions.map(w => `<li>${w.no}問：正答${w.correct_answer} / あなた${w.user_answer}<br>${w.summary}</li>`).join("");
  document.getElementById("gradeSummary").innerHTML =
    `<p class="ok">今回：${g.score.correct}/${g.score.total}（${g.score.accuracy}%）</p>
     <p>累計：${g.cumulative.correct}/${g.cumulative.total}（${g.cumulative.accuracy}%）</p>
     <p>危ない知識：<b>${g.danger_knowledge.label}</b><br>${g.danger_knowledge.reason}</p>
     <ul>${wrong}</ul>`;
}

async function copyGradeJson(){
  const text = document.getElementById("gradeJson").value;
  await navigator.clipboard.writeText(text);
  alert("採点JSONをコピーしました");
}

function downloadGradeJson(){
  if(!currentGrade) return showError("先に採点してください");
  downloadText(`grade-${currentGrade.session}.json`, JSON.stringify(currentGrade,null,2));
}

function renderStats(){
  const s = getStats();
  const chapters = Object.entries(s.chapters).map(([ch,v]) => `<li>${ch}: ${v.correct}/${v.total}（${v.accuracy}%）</li>`).join("");
  document.getElementById("stats").innerHTML =
    `<p>採点済みセット：${s.sessions}</p>
     <p>累計：${s.correct}/${s.total}（${s.accuracy}%）</p>
     <ul>${chapters}</ul>`;
}

function clearHistory(){
  if(confirm("採点履歴と生成履歴を削除しますか？")){
    localStorage.removeItem("touhan.v02.grade.history");
    localStorage.removeItem("touhan.v02.generated.history");
    renderStats();
  }
}

function downloadText(filename, text){
  const blob = new Blob([text], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

generateAll();
renderStats();
(function(){
  function cleanProblemJson(problemJson){
    const cloned = JSON.parse(JSON.stringify(problemJson));
    if (Array.isArray(cloned.sets)) {
      cloned.sets.forEach(set => {
        if (Array.isArray(set.questions)) {
          set.questions = set.questions.map(q => ({
            no: q.no,
            chapter: q.chapter,
            source: q.source,
            answer: q.answer,
            text: q.text,
            explanation: q.explanation
          }));
        }
      });
    }
    return cloned;
  }

  function getVisibleProblemJson(){
    if (window.currentProblem && window.currentProblem.sets && window.currentProblem.sets[0]) {
      return cleanProblemJson(window.currentProblem);
    }
    const area = document.getElementById("problemJson");
    if (area && area.value.trim()) {
      return cleanProblemJson(JSON.parse(area.value));
    }
    throw new Error("先に問題を生成してください。");
  }

  function setProblemTextareaText(text){
    const area = document.getElementById("problemJson");
    if (area) {
      area.value = text;
      area.removeAttribute("disabled");
      area.removeAttribute("readonly");
    }
  }

  async function copyFullTextToClipboard(text){
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw new Error("この環境では自動コピーが使えません。JSON欄から手動コピーしてください。");
    }
    await navigator.clipboard.writeText(text);
    return true;
  }

  function downloadJson(filename, obj){
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  window.copyProblemJson = async function(){
    try {
      const json = getVisibleProblemJson();
      const text = JSON.stringify(json, null, 2);
      setProblemTextareaText(text);

      await copyFullTextToClipboard(text);

      alert("問題JSONを全文コピーしました。文字数：" + text.length);
    } catch(e) {
      alert((e.message || e) + "\n\nJSON欄には全文を表示しています。そこから手動コピーしてください。");
    }
  };

  window.downloadProblemJson = function(){
    try {
      const json = getVisibleProblemJson();
      const text = JSON.stringify(json, null, 2);
      setProblemTextareaText(text);
      const filename = (json.sets && json.sets[0] && json.sets[0].id ? json.sets[0].id : "problem") + ".json";
      downloadJson(filename, json);
    } catch(e) {
      alert(e.message || e);
    }
  };

  window.downloadAllSets = function(){
    try {
      if (!window.currentAll) throw new Error("先に4セット生成してください。");
      const json = cleanProblemJson(window.currentAll);
      downloadJson(json.id + "_all_sets.json", json);
    } catch(e) {
      alert(e.message || e);
    }
  };

})();
(function(){
  const DISTRIBUTIONS={
    one_by_one:{'第1章':5,'第2章':5,'第3章':5,'第4章':10,'第5章':5},
    practice60:{'第1章':10,'第2章':10,'第3章':20,'第4章':10,'第5章':10},
    exam_am:{'第1章':20,'第2章':20,'第4章':20},
    exam_pm:{'第3章':40,'第5章':20}
  };
  const HISTORY_KEY='touhan.engine.generator.history.v084';

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
      explanation:`正答は${q.answer}です。東京都${q.year}年度の公式過去問です。`
    };
  }

  function extractLetterStatements(q){
    const text=normalizeExamRaw(q.question_text);
    const matches=[...text.matchAll(/(?:^|\n)\s*([ａ-ｄa-d])\s+([\s\S]*?)(?=(?:\n\s*[ａ-ｄa-d]\s+)|(?:\n\s*[１-５1-5]\s*[（(])|(?:\n\s*[１-５1-5]\s+(?:正|誤))|$)/g)];
    const out={};
    for(const m of matches){
      const key=m[1].normalize('NFKC').toLowerCase();
      const body=cleanExamParagraph(m[2]).replace(/(?:１|1)[（(].*$/,'').trim();
      if(body.length>=6)out[key]=body;
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

  window.TouhanGenerator={generate,buildOneByOnePool,DISTRIBUTIONS,HISTORY_KEY,KIND_LABELS,generatedTitle,cleanText,stripSourceQuestionNumber,formatExamQuestionText,formatExamChoiceText};
})();
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

  function statementLabels(text){
    const raw=String(text??'').replace(/\r/g,'').normalize('NFKC');
    return [...new Set([...raw.matchAll(/(?:^|\n)\s*([a-d])\s+\S/g)].map(m=>m[1].toLowerCase()))];
  }
  function structuralReasons(q,choices){
    const reasons=[];
    const text=String(q.question_text??'');
    const labels=statementLabels(text);
    const marks=choices.flatMap(x=>String(x).match(/[正誤]/g)||[]);
    const isTruthTable=choices.length===5 && marks.length>=15;
    const isPair=/組合せはどれか/.test(text) && choices.some(x=>/[a-dａ-ｄ].*[,、・].*[a-dａ-ｄ]/i.test(String(x)));
    if((isTruthTable||isPair) && labels.length>0 && labels.length<4)reasons.push(`記述a〜d欠落（${labels.join(',')}のみ）`);
    if((isTruthTable||isPair) && labels.length===0)reasons.push('組合せ対象の記述欠落');
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
    reasons.push(...structuralReasons(q,choices));
    return {ok:reasons.length===0,reasons,choices};
  }
  function validateDatabase(db){
    const list=Array.isArray(db)?db:(Array.isArray(db?.questions)?db.questions:[]); const seen=new Set(),valid=[],invalid=[],duplicateIds=[]; const chapterCounts={},yearCounts={};
    for(const q of list){if(seen.has(q.question_id)){duplicateIds.push(q.question_id);invalid.push({id:q.question_id,reasons:['ID重複']});continue;}seen.add(q.question_id);const r=validateQuestion(q);if(r.ok){valid.push({...q,choices:r.choices});chapterCounts[q.chapter]=(chapterCounts[q.chapter]||0)+1;yearCounts[q.year]=(yearCounts[q.year]||0)+1;}else invalid.push({id:q.question_id||'(なし)',year:q.year,no:q.question_no,reasons:r.reasons});}
    return {total:list.length,valid,invalid,validCount:valid.length,invalidCount:invalid.length,duplicateIds,chapterCounts,yearCounts};
  }
  window.TouhanValidator={validateQuestion,validateDatabase};
})();(function(){
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
      explanation:`正答は${q.answer}です。東京都${q.year}年度の公式過去問です。`
    };
  }

  function extractLetterStatements(q){
    const text=normalizeExamRaw(q.question_text);
    const matches=[...text.matchAll(/(?:^|\n)\s*([ａ-ｄa-d])\s+([\s\S]*?)(?=(?:\n\s*[ａ-ｄa-d]\s+)|(?:\n\s*[１-５1-5]\s*[（(])|(?:\n\s*[１-５1-5]\s+(?:正|誤))|$)/g)];
    const out={};
    for(const m of matches){
      const key=m[1].normalize('NFKC').toLowerCase();
      const body=cleanExamParagraph(m[2]).replace(/(?:１|1)[（(].*$/,'').trim();
      if(body.length>=2&&!/^[a-d](?:\s+[a-d]){1,3}$/i.test(body))out[key]=body;
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

  window.TouhanGenerator={generate,buildOneByOnePool,DISTRIBUTIONS,HISTORY_KEY,KIND_LABELS,generatedTitle,cleanText,stripSourceQuestionNumber,formatExamQuestionText,formatExamChoiceText};
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
    document.querySelectorAll('.mode-tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode-tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.mode-panel').forEach(x=>x.classList.add('hidden'));b.classList.add('active');$(b.dataset.panel).classList.remove('hidden')}));
    $('loadDbBtn').onclick=()=>loadBundled().catch(e=>setStatus(e.message,'err'));
    $('validateDbBtn').onclick=()=>validate().catch(e=>setStatus(e.message,'err'));
    $('masterFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;rawDb=JSON.parse(await f.text());report=null;setStatus(`ローカルDB読込完了：${rawDb.questions?.length||0}問`,'ok')}catch(err){setStatus(`読込失敗：${err.message}`,'err')}};
    $('generateDailyBtn').onclick=async()=>{try{if(!report)await validate();const mode=$('genMode').value;generated=TouhanGenerator.generate({questions:report.valid,date:$('genDate').value,dayId:$('genDayId').value.trim(),title:$('genTitle').value.trim(),mode,kind:$('genKind').value,sequence:Number($('genRound').value)||1});renderGenerated(generated);setStatus(`${mode==='one_by_one'?'一問一答':mode==='practice60'?'総合演習':'本番問題'}を生成しました。統合JSONを学習アプリへ取り込めます。`,'ok')}catch(e){setStatus(`生成失敗：${e.message}`,'err')}};
    $('downloadDailyBtn').onclick=()=>generated?download(`${generated.id}_all_sets.json`,generated):setStatus('先に問題を生成してください','err');
    $('downloadSetsBtn').onclick=()=>{if(!generated)return setStatus('先に問題を生成してください','err');generated.sets.forEach(set=>download(`${set.id}.json`,{...generated,sets:[set]}))};
    loadBundled().then(validate).catch(e=>setStatus(`自動読込できません。ローカルDBを選択してください：${e.message}`,'err'));
  });
})();
