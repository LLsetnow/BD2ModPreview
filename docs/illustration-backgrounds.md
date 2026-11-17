# 立绘与背景的官方映射

## 数据来源

映射文件：`src/data/illustrationBackgrounds.json`。本机设计数据库中找到两张可直接关联的官方表：

```text
CostumeDesignTable.Id = CostumeDesignConceptInfoTable.Id
CostumeDesignTable.PrefabName           → 立绘 Spine 骨骼资源名
CostumeDesignTable.IllustName           → 立绘图片资源名
CostumeDesignConceptInfoTable.CostumeBgResoureceName → 背景资源名
```

`Resourece` 是游戏字段原有的拼写。该快照包含 207 套设计、207 个骨骼名，以及 72 张不同的背景；全部背景 PNG 均已在本地素材库核对存在。映射文件的 `source` 保存表名、字段和源数据库、程序集的 SHA256。

| 设计 ID | PrefabName | IllustName | 背景 |
| --- | --- | --- | --- |
| 101 | Char000101 | illust_char000101_1 | novel_background_160 |
| 102 | Char000102 | illust_char000102_44 | novel_background_53 |
| 1207 | Char001207 | illust_char001207_114 | novel_background_131 |
| 1297 | Char001297 | illust_char001297_229 | novel_background_131 |

背景位置为素材库根目录下的 `ui/novel_background/<背景资源名>.png`。它们是服装立绘的场景背景，与技能时间轴中的 `backgrounds/cutscene/<hash>.webp` 不同。

Preview 的立绘预览加载 `spine/char/charNNNNNN/charNNNNNN.skel`，并不加载 `IllustName.skel`。因此 `skeletons` 显式记录 `PrefabName → IllustName`，`backgrounds` 再记录 `IllustName → 背景`。部分 NPC 的设计 ID 和 PrefabName 数字不同，例如设计 901 的骨骼为 Char100401；禁止按设计 ID 推算骨骼名。

## 行为

- 原版立绘和使用相同骨骼文件名的 Mod 立绘，默认显示对应背景。
- 资源读取复用素材库设置及故事背景加载器，优先本地文件，缺失时沿用在线后备来源。
- 每个预览的控制栏和右键“背景”菜单提供“立绘背景”开关；设置中的“自动显示立绘对应的背景”控制新预览的默认行为。
- 手动选择的图片、颜色和背景画廊内容优先保留。关闭对应背景后恢复主题底色。
- 未知骨骼、技能演出和约会场景不猜测服装背景。切换到无映射资源时清除上一套自动背景。
- 背景缺失不阻塞 Spine 播放；快速切换资源或素材库后，旧请求不能覆盖当前背景。截图合成使用当前显示的背景。

## 更新与验证

源文件是 `%USERPROFILE%/AppData/LocalLow/Gamfs/BrownDust II/Data/t/9F251C63BC72551C681EE75D328FA090D56E444B`，即 `SHA1("common_v1")`。只读逐页解码及 protobuf 导出方法见 Manager 的 `docs/dating-native-entries-unpack-and-plugin.md` 第 2—5 节；改为导出上述两张设计表，并使用同一游戏版本 `Assembly-CSharp.dll` 的官方 protobuf 类型解析。数据库只在临时目录解码，游戏源文件未写入。

更新时按上述 Id 关联重新生成映射，校验重复骨骼没有冲突、背景资源存在，并更新源哈希。不要依赖服装编号相邻、相同角色或相似文件名回填背景。

```text
node --test tests/asset-library-urls.test.mjs tests/illustration-backgrounds.test.mjs
npm run build
```

浏览器验证覆盖两套真实立绘及独立背景开关、自定义背景保留、默认关闭、缺图回退、无映射回退和延迟图片请求的切换竞争。验证使用真实 Preview 组件和本地 Spine/PNG，Tauri 文件接口由测试桥接替代。
