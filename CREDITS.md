# 素材署名 / Credits

## 已确认授权（Sketchfab，CC BY 4.0：允许商用，须署名）

对外发布时，请在页面可见处（例如“关于”页）附上以下署名。

- "Sheep" (https://sketchfab.com/3d-models/sheep-5b11b1aedc9a478eb5e2f3adcf0f4e2e) by DibArts (https://sketchfab.com/youssefe22) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- "Cartoon sheep" (https://sketchfab.com/3d-models/cartoon-sheep-10f9803452d24abfafbe4bd928e663f7) by _Yen_ (https://sketchfab.com/_Yen_) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

本项目对模型做了缩放、朝向归一化与材质颜色调整（DibArts 模型的 spec-gloss 材质被转换为金属度/粗糙度材质），
并在着色器里加了腿部摆动和头部转动。

## CGTrader 版税授权：models/sheep_cgtrader（"Sheep (1).zip"）

- "Realistic Sheep 3D Model" by WildMesh3D — https://www.cgtrader.com/free-3d-models/animal/mammal/realistic-sheep-3d-model
  （Model ID #6034144，与下载记录一致；2025-04-10 发布，免费）
- 授权：**CGTrader Royalty Free License (no AI)**
  - 可以用于商业项目（网页、游戏、应用），不要求署名（这里仍然记下来源）。
  - 只能作为“嵌入的产品”使用：**不得把模型文件本身再分发**，并且要“采取商业上合理的措施，防止最终用户拿到模型本身”
    （例如加密或专有格式），不能让人从网页里直接下载到 glTF/贴图。
  - no AI：不得用于机器学习 / 训练神经网络（包括生成式 AI）。
- 因此：
  - 本地开发随意使用；
  - **不要把 models/sheep_cgtrader/ 和原始 zip 提交到公开仓库**；
  - 公开发布前，需要把模型和贴图打包成加密的二进制、在页面里解密加载（而不是直接放 Sheep.gltf / PNG）。

## 声音：assets/sounds（羊叫）

- `sheep_baa.ogg` — "Sheep Baa" by AntumDeluge（from a recording by mikewest），**CC0**（无需署名）— https://opengameart.org/node/132779
- `sheep1.flac`、`sheepBleet.flac`、`sheep2.flac` — "Sheep Sound Bleats (Yo Frankie!)" by Blender Foundation（submitted by Lamoot），
  **CC-BY 3.0**（允许商用，须署名）— https://opengameart.org/content/sheep-sound-bleats-yo-frankie
  对外发布时请在页面可见处署名：Sheep sounds from "Yo Frankie!" © Blender Foundation, CC-BY 3.0。
  本项目只在播放时改变了音高（按每只羊的体型）。

其余声音（风、溪水、熊蜂、云雀）都在浏览器里现场合成，没有用到外部素材。

## 已不再使用

- "Sheep animation lowpoly" by EREMA_GEP（CC BY 4.0）——已从模型选项中移除，文件仍在 models/ 下。
