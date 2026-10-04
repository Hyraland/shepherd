import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { TUNING_DEFAULTS, TUNING_PRESETS, applyTuning } from './config.js';
import { saveTuning } from './tuning.js';

// 开发版的调节面板（右上角，按 G 显示 / 隐藏）。
// 每次改动都会存到浏览器和项目里的 tuning.json（需要用 serve.py 启动），下次打开就是调好的样子。

export function createDevPanel(U, tuning, { onSheepStyle, onPlayMusic } = {}) {
  const changed = () => {
    applyTuning(U, tuning);
    saveTuning(tuning);
  };

  const gui = new GUI({ title: '画面调节（G 隐藏）' });
  // 帧率（每秒刷新一次）
  const stats = { fps: '—' };
  gui.add(stats, 'fps').name('帧率').disable().listen();
  let frames = 0, last = performance.now();
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      stats.fps = `${Math.round((frames * 1000) / (now - last))} fps`;
      frames = 0;
      last = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const g = gui.addFolder('草地');
  g.add(tuning.grass, 'toon').name('二分色（关 = 写实）').onChange(changed);
  g.addColor(tuning.grass, 'light').name('亮面颜色').onChange(changed);
  g.addColor(tuning.grass, 'lightDeep').name('亮面深色（叶根/深丛）').onChange(changed);
  g.addColor(tuning.grass, 'shadow').name('暗面颜色').onChange(changed);
  g.add(tuning.grass, 'edge', 0.02, 0.95, 0.01).name('明暗分界').onChange(changed);
  g.add(tuning.grass, 'softness', 0, 0.3, 0.005).name('分界柔和度').onChange(changed);
  g.add(tuning.grass, 'variation', 0, 1, 0.01).name('深色的多少').onChange(changed);
  g.add(tuning.grass, 'flowers', 0, 1, 0.01).name('野花').onChange(changed);
  g.add(tuning.grass, 'hues', 0, 1, 0.01).name('藏色（草叶里的杂色）').onChange(changed);

  const f = gui.addFolder('云杉林');
  f.addColor(tuning.forest, 'lit').name('亮面颜色').onChange(changed);
  f.addColor(tuning.forest, 'shade').name('暗面颜色').onChange(changed);
  f.add(tuning.forest, 'hues', 0, 1, 0.01).name('藏色（枝条里的杂色）').onChange(changed);

  const s = gui.addFolder('羊');
  s.add(tuning.sheep, 'toon').name('插画光影（关 = 写实）').onChange((v) => { changed(); onSheepStyle?.(v); });
  s.addColor(tuning.sheep, 'light').name('亮面颜色').onChange(changed);
  s.addColor(tuning.sheep, 'shadow').name('暗面颜色').onChange(changed);
  s.add(tuning.sheep, 'followGrass', 0, 1, 0.01).name('暗面靠向草地暗面').onChange(changed);
  s.add(tuning.sheep, 'edge', 0.02, 0.95, 0.01).name('明暗分界').onChange(changed);
  s.add(tuning.sheep, 'softness', 0, 0.5, 0.005).name('分界柔和度').onChange(changed);
  s.add(tuning.sheep, 'texture', 0, 1, 0.01).name('贴图细节').onChange(changed);
  s.add(tuning.sheep, 'fuzz', 0, 1, 0.01).name('毛绒凹凸').onChange(changed);
  s.add(tuning.sheep, 'rim', 0, 1, 0.01).name('边缘亮光').onChange(changed);
  s.add(tuning.sheep, 'brightness', 0.5, 2, 0.01).name('整体亮度').onChange(changed);
  s.add(tuning.sheep, 'highlight', 0, 1.5, 0.01).name('向阳面提亮').onChange(changed);

  const k = gui.addFolder('天空与太阳');
  k.add(tuning.sky, 'elevation', 3, 75, 0.5).name('太阳高度（度）').onChange(changed);
  k.add(tuning.sky, 'azimuth', -180, 180, 1).name('太阳方位（度）').onChange(changed);
  k.add(tuning.sky, 'sun', 0.5, 4, 0.05).name('阳光强度').onChange(changed);
  k.add(tuning.sky, 'skyLight', 0.1, 1.5, 0.01).name('天光强度').onChange(changed);
  k.addColor(tuning.sky, 'zenith').name('天顶颜色').onChange(changed);
  k.addColor(tuning.sky, 'horizon').name('地平线颜色').onChange(changed);
  k.add(tuning.sky, 'band', 0.04, 0.8, 0.01).name('地平线浅色带高度').onChange(changed);
  k.add(tuning.sky, 'haze', 0, 1, 0.01).name('远处雾气').onChange(changed);
  k.add(tuning.sky, 'exposure', 0.6, 2.2, 0.01).name('曝光（水/林/山）').onChange(changed);
  k.add(tuning.sky, 'bloom', 0, 1.5, 0.01).name('强光辉光').onChange(changed);
  k.add(tuning.sky, 'cloudCover', 0, 1, 0.01).name('云影覆盖').onChange(changed);
  k.add(tuning.sky, 'cloudStrength', 0, 1, 0.01).name('云影浓淡').onChange(changed);
  k.add(tuning.sky, 'cloudSoftness', 0, 1, 0.01).name('云影边缘柔和').onChange(changed);
  k.add(tuning.sky, 'cloudSpeed', 0, 4, 0.05).name('云飘动速度').onChange(changed);

  const w = gui.addFolder('溪流与湖');
  w.addColor(tuning.water, 'color').name('水色').onChange(changed);
  w.add(tuning.water, 'reflection', 0, 1, 0.01).name('天空倒影').onChange(changed);
  w.add(tuning.water, 'ripple', 0.3, 2.5, 0.01).name('波纹细碎').onChange(changed);
  w.add(tuning.water, 'glitter', 0, 3, 0.01).name('阳光闪光').onChange(changed);
  w.addColor(tuning.water, 'glitterColor').name('远处闪光颜色').onChange(changed);
  w.addColor(tuning.water, 'lake').name('湖水颜色').onChange(changed);

  const so = gui.addFolder('声音（点一下画面后开始）');
  so.add(tuning.sound, 'master', 0, 1.5, 0.01).name('总音量').onChange(changed);
  so.add(tuning.sound, 'wind', 0, 1.5, 0.01).name('风和草').onChange(changed);
  so.add(tuning.sound, 'water', 0, 1.5, 0.01).name('溪水').onChange(changed);
  so.add(tuning.sound, 'sheep', 0, 1.5, 0.01).name('羊叫').onChange(changed);
  so.add(tuning.sound, 'bees', 0, 1.5, 0.01).name('熊蜂').onChange(changed);
  so.add(tuning.sound, 'birds', 0, 1.5, 0.01).name('云雀').onChange(changed);
  so.add(tuning.sound, 'music', 0, 1.5, 0.01).name('背景音乐').onChange(changed);
  so.add(tuning.sound, 'musicStyle', { '冬不拉曲': 'kuy', '草原小曲（长笛）': 'song' }).name('音乐风格').onChange(changed);
  if (onPlayMusic) so.add({ play: onPlayMusic }, 'play').name('立刻来一段音乐');

  // 预设：一键套用一组配好的参数（只改预设里列出的项，羊的参数不动）
  const presetNames = Object.keys(TUNING_PRESETS);
  const pick = { preset: presetNames[0] };
  gui.add(pick, 'preset', presetNames).name('预设');
  gui.add({
    apply() {
      const pr = TUNING_PRESETS[pick.preset];
      for (const k2 of Object.keys(pr)) Object.assign(tuning[k2], pr[k2]);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      changed();
      onSheepStyle?.(tuning.sheep.toon);
    },
  }, 'apply').name('套用这个预设');
  gui.add({
    reset() {
      for (const k of Object.keys(TUNING_DEFAULTS)) Object.assign(tuning[k], TUNING_DEFAULTS[k]);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      changed();
      onSheepStyle?.(tuning.sheep.toon);
    },
  }, 'reset').name('全部恢复默认');

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyG') gui.show(gui._hidden);
  });
  return gui;
}
