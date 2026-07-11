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

  window.addEventListener("load", function(){
    const h1 = document.querySelector("h1");
    if (h1) h1.textContent = "登録販売者 過去問エンジン v0.4.0";
  });
})();
