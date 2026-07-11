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
