// 右上角一个半透明的“⋯”：点开是一个小菜单——操作说明、致谢、背景音乐开 / 关。
// 平时几乎看不见，不打扰画面；说明和致谢是一张居中的半透明卡片，点卡片外面、✕ 或按 Esc 关掉。

const CSS = `
#ym-dots {
  position: fixed; top: 14px; right: 14px; z-index: 20;
  width: 38px; height: 38px; border-radius: 50%; border: 0; padding: 0;
  background: rgba(255,255,255,.18); color: rgba(255,255,255,.95);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; gap: 3px;
  cursor: pointer; opacity: .55; transition: opacity .25s, background .25s;
}
#ym-dots:hover, #ym-dots.open { opacity: 1; background: rgba(255,255,255,.3); }
#ym-dots span { width: 4px; height: 4px; border-radius: 50%; background: currentColor; box-shadow: 0 0 3px rgba(0,0,0,.25); }
#ym-menu {
  position: fixed; top: 58px; right: 14px; z-index: 20; min-width: 168px;
  padding: 6px; border-radius: 14px;
  background: rgba(255,255,255,.72); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  box-shadow: 0 6px 24px rgba(20,40,70,.18);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #24323f;
  opacity: 0; transform: translateY(-6px); pointer-events: none; transition: opacity .2s, transform .2s;
}
#ym-menu.open { opacity: 1; transform: none; pointer-events: auto; }
#ym-menu button {
  display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 14px;
  padding: 9px 12px; border: 0; border-radius: 9px; background: none;
  font: inherit; color: inherit; text-align: left; cursor: pointer;
}
#ym-menu button:hover { background: rgba(36,50,63,.08); }
#ym-menu .state { font-size: 12px; color: #6b7a87; }
#ym-veil {
  position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(20,35,55,.18);
  opacity: 0; pointer-events: none; transition: opacity .25s;
}
#ym-veil.open { opacity: 1; pointer-events: auto; }
#ym-card {
  position: relative; box-sizing: border-box; width: min(440px, 100%); max-height: calc(100% - 32px); overflow: auto;
  padding: 22px 24px 20px; border-radius: 18px;
  background: rgba(255,255,255,.82); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
  box-shadow: 0 10px 40px rgba(20,40,70,.22);
  font: 14px/1.65 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #24323f;
  -webkit-user-select: text; user-select: text;
}
#ym-card h2 { margin: 0 0 12px; font-size: 17px; font-weight: 600; }
#ym-card h3 { margin: 14px 0 4px; font-size: 13px; font-weight: 600; color: #4b5b69; }
#ym-card p { margin: 0 0 6px; }
#ym-card table { border-collapse: collapse; width: 100%; }
#ym-card td { padding: 5px 0; vertical-align: top; }
#ym-card td:first-child { white-space: nowrap; padding-right: 16px; color: #4b5b69; }
#ym-card kbd {
  display: inline-block; min-width: 1.4em; padding: 0 5px; border-radius: 5px; text-align: center;
  font: 12px/1.6 ui-monospace, Menlo, monospace; background: rgba(36,50,63,.08); border: 1px solid rgba(36,50,63,.15);
}
#ym-card a { color: #2b6cb0; text-decoration: none; }
#ym-card a:hover { text-decoration: underline; }
#ym-card .note { font-size: 12px; color: #6b7a87; margin-top: 12px; }
#ym-close {
  position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border: 0; border-radius: 50%;
  background: none; font-size: 18px; line-height: 30px; color: #6b7a87; cursor: pointer;
}
#ym-close:hover { background: rgba(36,50,63,.08); }
`;

const HELP = (max) => `
<h2>操作说明</h2>
<table>
  <tr><td>环顾四周</td><td>拖动画面，或 <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></td></tr>
  <tr><td>唤来一只小羊</td><td>单击画面，或按 <kbd>+</kbd> / <kbd>Enter</kbd>（最多 ${max} 只）</td></tr>
  <tr><td>送走一只小羊</td><td>双击那只羊，或按 <kbd>−</kbd> / <kbd>Backspace</kbd></td></tr>
  <tr><td>停下 / 继续走</td><td><kbd>Space</kbd></td></tr>
  <tr><td>换一种走法</td><td><kbd>R</kbd>：往视线方向一直走 ↔ 沿着固定的小路走</td></tr>
</table>
<p class="note">一直往前走，草原没有尽头。声音会在第一次点击或按键后响起；背景音乐可以在右上角的菜单里关掉。</p>
`;

const CREDITS = `
<h2>致谢</h2>
<h3>小羊模型</h3>
<p>“Realistic Sheep 3D Model” by WildMesh3D —
<a href="https://www.cgtrader.com/free-3d-models/animal/mammal/realistic-sheep-3d-model" target="_blank" rel="noopener">CGTrader</a>（Royalty Free License）</p>
<h3>羊叫声</h3>
<p>Sheep sounds from “Yo Frankie!” © Blender Foundation —
<a href="https://opengameart.org/content/sheep-sound-bleats-yo-frankie" target="_blank" rel="noopener">OpenGameArt</a>，
<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>（播放时按体型改变了音高）</p>
<p>“Sheep Baa” by AntumDeluge, from a recording by mikewest —
<a href="https://opengameart.org/node/132779" target="_blank" rel="noopener">OpenGameArt</a>，CC0</p>
<h3>渲染</h3>
<p><a href="https://threejs.org" target="_blank" rel="noopener">three.js</a>（MIT License）</p>
<p class="note">草地、野花、云杉、溪流与湖、天空、熊蜂，以及风声、溪水、蜂鸣、云雀和背景音乐，都是在浏览器里现场程序生成的。</p>
`;

export function createMenu({ sound, maxSheep, right = 14 }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const dots = document.createElement('button');
  dots.id = 'ym-dots';
  dots.setAttribute('aria-label', '菜单');
  dots.innerHTML = '<span></span><span></span><span></span>';

  const menu = document.createElement('div');
  menu.id = 'ym-menu';
  menu.innerHTML = `
    <button data-act="help">操作说明</button>
    <button data-act="credits">致谢</button>
    <button data-act="music">背景音乐 <span class="state"></span></button>`;
  const musicState = menu.querySelector('.state');
  const syncMusic = () => { musicState.textContent = sound.musicOn ? '开' : '关'; };
  syncMusic();

  const veil = document.createElement('div');
  veil.id = 'ym-veil';
  veil.innerHTML = '<div id="ym-card" role="dialog"><button id="ym-close" aria-label="关闭">✕</button><div class="body"></div></div>';
  const body = veil.querySelector('.body');

  document.body.append(dots, menu, veil);
  dots.style.right = menu.style.right = `${right}px`;

  const setMenu = (open) => { menu.classList.toggle('open', open); dots.classList.toggle('open', open); };
  const showCard = (html) => { body.innerHTML = html; veil.classList.add('open'); setMenu(false); };
  const hideCard = () => veil.classList.remove('open');

  // 菜单上的点击不要穿到画面上（不然会唤来一只羊）
  for (const el of [dots, menu, veil]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  dots.addEventListener('click', () => { sound.start(); setMenu(!menu.classList.contains('open')); });
  menu.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'help') showCard(HELP(maxSheep));
    else if (act === 'credits') showCard(CREDITS);
    else if (act === 'music') { sound.start(); sound.setMusic(!sound.musicOn); syncMusic(); }
  });
  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.id === 'ym-close') hideCard(); });
  addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && e.target !== dots) setMenu(false); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideCard(); setMenu(false); }
  });
  return { isOpen: () => veil.classList.contains('open') };
}
