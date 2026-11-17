# 立绘点按动作与语音

普通立绘默认支持左键点按：在人物的可见网格内按下并释放、移动不超过 6 像素时，播放一次 motion，结束后回到循环 idle，同时随机播放该服装的一条普通台词。连续点按中止上一句，并避免立即重复同一句。拖拽和中键继续平移；点击背景不播放。

## 音频与官方对应关系

素材库位置是 audio/standing/，运行索引为 audio/standing/index.json。音频不打包进 EXE。设置中的素材库根目录沿用已有的 spine、ui、audio、backgrounds 资源配置。

本机 common 设计数据库中的 CostumeDesignConceptInfoTable 为 207 套服装各列出三条 Profile/NormalLine 事件（protobuf 字段 11）。通过游戏 FMOD 2.03.12 的 create-programmer-sound 回调读取全部 621 条事件，确认它们分别指向该服装的 BattleReady_1、BattleReady_2、BattleReady_3 采样。该名称不影响其作为普通台词事件音源的用途。运行时只从这三条已确认台词中选择，不将情绪短音或好感/生日等特殊条目加入普通点击池。

设计数据库 SHA256：7cbb7275a9fc137592b01383113381f18d209903d34963bdd70c9ad0d5b666ba。完整事件和音源对应保存在素材库 audio/standing/official-click-events.json。

日语共 621 条，覆盖 207 套；韩语共 549 条，覆盖 183 套。所选语言缺少当前服装时，使用另一种已有语言；语音按钮的悬停说明会标明实际语言。缺项见 audio/standing/missing-click-voices.json。最初提取的 4,156 条情绪/特殊语音继续保留，整个 standing 目录目前有 5,326 个 WAV。

## 设置与播放生命周期

设置中的“立绘点击互动”控制点按动作、语音开关、日语/韩语和音量；预览控制栏的“角色语音”按钮可快速静音。默认开启动作与语音，默认日语，音量 80%。三条语音预先读取和解码，只在点按时开始播放。

换角色、换素材库、换语言、静音、开启其他交互/播放序列、手动切换动作和关闭预览时会停止旧声音。暂停/继续同步控制当前语音。读取失败的音频不会进入可用播放池，也不会阻塞立绘动作。

动作来自当前加载的 Spine 骨骼。识别 charNNNNNN 文件名，以及官方映射中对应的 illust_char 文件名；同名 Mod 使用相同语音。未知资源名或没有 idle/motion 的骨骼不自动添加点按动作。约会、小游戏与技能序列继续使用各自的播放方式。

## 本次验证

Vue 类型检查、Vite 生产构建和 Windows Cargo release 构建通过。Chromium 加载真实 Spine、纹理和 WAV，检查人物点按、motion 回到 idle、快速重复点击、拖拽、背景点击、静音、韩语切换、换角色停止旧语音与语言回退。浏览器检查使用本地 HTTP 替代 Tauri 的文件协议；发布 EXE 包含实际文件协议实现。
