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
