// 可调参数的存取：项目里的 tuning.json 是默认值（我能直接读到），
// 开发面板改动后同时存到浏览器（localStorage）和项目（POST 给 serve.py，写回 tuning.json）。

const LS_KEY = 'yili.tuning';
const OLD_GRASS_KEY = 'yili.grassStyle';

export async function loadTuning(defaults) {
  const merged = structuredClone(defaults);
  const mergeIn = (src) => {
    for (const group of Object.keys(merged)) if (src?.[group]) Object.assign(merged[group], src[group]);
  };
  let fromFile = null;
  try {
    const r = await fetch('tuning.json', { cache: 'no-store' });
    if (r.ok) fromFile = await r.json();
  } catch {}
  mergeIn(fromFile);
  // 浏览器里有更新的改动（比如还没来得及写回文件）就以浏览器为准；
  // 也兼容上一版只存了草地参数的格式
  try {
    const local = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    const oldGrass = JSON.parse(localStorage.getItem(OLD_GRASS_KEY) || 'null');
    if (oldGrass && !local) mergeIn({ grass: oldGrass });
    if (local && (!fromFile || (local.savedAt || 0) > (fromFile.savedAt || 0))) mergeIn(local);
  } catch {}
  return merged;
}

let timer = 0;
export function saveTuning(t) {
  const data = { ...t, savedAt: Date.now() };
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
  clearTimeout(timer);
  timer = setTimeout(() => {
    fetch('__tuning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
  }, 400);
}
