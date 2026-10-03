# 液态玻璃外观

本分支将顶栏、Dock、独立搜索框、首页切换控件、设置和对话框改为具有**背景折射**的玻璃表面。控件边缘会弯曲背后的文字、图片和线条；前景文字与按钮保持正常渲染。圆角浮层另有轻微色散和随指针移动的高光。

顶栏只保留一层通栏玻璃，取消外层胶囊、厚阴影与内层搜索框的独立滤镜。搜索输入使用浅色填充，页面切换使用文字和下划线，避免玻璃表面互相嵌套。

视频卡片、普通按钮和搜索建议使用轻量的半透明样式。长列表不逐卡片创建折射滤镜。

## 开源参考

- [shuding/liquid-glass](https://github.com/shuding/liquid-glass)：Canvas 生成位移贴图，通过 SVG `feDisplacementMap` 对背景像素位移。
- [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)：边缘折射、RGB 色散，以及独立于前景内容的玻璃层。
- [ybouane/liquidglass](https://github.com/ybouane/liquidglass)：研究了其 WebGL 折射、光照及页面内容捕获方案；本扩展没有采用它的页面截图与持续渲染循环。

采用的 MIT 参考实现及完整许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。未引入 React 或新的运行时依赖。

## 启用与兼容性

新安装默认开启玻璃效果。已有配置会保留；升级后如果没有看到透明效果，请在 **设置 → 常规 → 毛玻璃和性能** 中关闭 **禁用毛玻璃效果**。

| 环境 / 设置 | 表现 |
| --- | --- |
| 桌面 Chrome / Edge 等 Chromium 浏览器 | SVG 背景折射、轻微色散和高光 |
| Firefox / Safari / iOS 浏览器 | 磨砂玻璃回退，**没有背景折射** |
| 禁用毛玻璃 / 系统减少透明度 | 实色表面，停止折射 |
| 降低毛玻璃模糊强度 | 降低模糊和折射幅度 |
| 系统减少动态效果 | 停止指针高光跟随，缩短界面过渡 |

这是一种 Web 上的折射近似实现。CSS 的 `url()` 语法支持不代表浏览器能处理 SVG 背景滤镜，因此使用明确的 Chromium 路径和回退，不把普通模糊称为折射。

浅色和深色模式分别调整玻璃着色。自定义壁纸、主题色、禁用阴影设置继续生效；未设置壁纸时显示主题色渐变。

## 实现

- `src/components/LiquidGlass.vue`：装饰性的玻璃层、SVG 三通道位移管线、尺寸观察、指针高光与资源清理。滤镜只处理背景层，前景不参与位移。
- `src/utils/glassLens.ts`：按控件实际宽高与圆角生成距离场；曲面边缘向内采样，中心区域保持中性。
- `src/styles/liquidGlass.scss`：浅色 / 深色材质、性能与辅助显示回退。

贴图只在尺寸或启用状态改变时生成，并限制分辨率和缓存数量。滚动由浏览器合成真实背景，不截图、不读取远程图片像素，也不逐帧重新生成贴图。

## 验证

构建：`pnpm build`。类型检查：`pnpm typecheck --noEmit`。测试：`pnpm exec vitest run`。

镜头数学测试覆盖边缘位移、中心中性、对称性、宽胶囊比例、贴图内存上限和非法尺寸。浏览器验证使用实际扩展的 Shadow DOM：在同一控件后放置网格，仅切换位移强度，比较截图以确认边缘像素确实发生形变。

同时检查浅色 / 深色、搜索、设置、390px / 768px / 1440px 窗口、性能开关和系统减少透明度偏好。Firefox / Safari 的回退仍需在对应真实浏览器上验证。

## 本地安装

解压扩展包，在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 打开开发者模式，选择“加载已解压的扩展程序”，选中包含 `manifest.json` 的文件夹，然后刷新 Bilibili。
