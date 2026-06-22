# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

番茄钟 (Pomodoro Timer) — Tauri + React 桌面应用。

---

## Tauri 应用 (pomodoro-app/)

### 技术栈
- **前端**: React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4 (via `@tailwindcss/vite`)
- **后端**: Tauri 2 + Rust (edition 2021, stable toolchain)
- **包管理**: pnpm

### 常用命令

```bash
# 前端 dev 服务器（浏览器预览）
cd pomodoro-app && pnpm dev

# 运行 Tauri 桌面应用（开发模式，自动启动 Vite）
cd pomodoro-app && pnpm tauri dev

# 构建 Tauri 桌面应用（生产发布）
cd pomodoro-app && pnpm tauri build

# TypeScript 类型检查（零错误基准）
cd pomodoro-app && pnpm tsc -b

# Lint
cd pomodoro-app && pnpm lint
```

### 架构要点

| 层 | 位置 | 说明 |
|---|---|---|
| React 入口 | `src/main.tsx` | DOM 挂载，StrictMode |
| 主组件 | `src/App.tsx` | 全部 UI 逻辑内聚（计时、设置弹窗、统计栏） |
| 样式 | `src/index.css` | Tailwind v4 + CSS 变量设计令牌（暖瓷色系） |
| Vite 配置 | `vite.config.ts` | React + Tailwind v4 插件，排除 src-tauri/target |
| TypeScript | `tsconfig.json` | Project references: tsconfig.app.json + tsconfig.node.json |
| ESLint | `eslint.config.js` | Flat config: @eslint/js + typescript-eslint + react-hooks + react-refresh |
| Rust 入口 | `src-tauri/src/main.rs` | `windows_subsystem = "windows"` 隐藏控制台 |
| Rust 核心 | `src-tauri/src/lib.rs` | 系统托盘、关闭到托盘行为、通知插件 |
| 编译脚本 | `src-tauri/build.rs` | 标准 `tauri_build::build()` |
| Tauri 配置 | `src-tauri/tauri.conf.json` | 窗口 340×480, 无边框, 透明, 居中, CSP=null |
| 权限 | `src-tauri/capabilities/default.json` | notification 插件全部权限 |

- **窗口**: 无边框装饰 (`decorations: false`), 固定 340×480, 透明背景, 居中。自带 titlebar 组件用于拖拽
- **系统托盘**: 关闭窗口时隐藏到托盘而非退出；托盘菜单有「显示窗口」「退出」；点击托盘图标恢复窗口
- **通知**: `tauri-plugin-notification` 桌面通知 + Audio API base64 WAV 提示音
- **主题**: 亮/暗模式切换，`localStorage` 持久化，跟随系统偏好作为默认
- **数据持久化**: 全部 `localStorage`（`pomodoro-config`、`pomodoro-daily`、`pomodoro-theme`），无后端数据库
- **窗口置顶**: 通过 `getCurrentWindow().setAlwaysOnTop()` 实现，设置弹窗中切换
- **配置单位**: 分钟制

### TypeScript 代码组织约定

`App.tsx` 遵循自上而下结构：

1. **类型定义** → `TimerState`、`Config` interface
2. **默认值** → `DEFAULT_CONFIG`
3. **工具函数** → `formatTime()`、`totalSeconds()`
4. **模块级常量** → 不可变引用，避免每次渲染重建：
   - `CIRCUMFERENCE` — 圆形进度环周长
   - `STATE_LABELS`、`BUTTON_TEXT`、`TOTAL_FN` — 查表替代 switch
   - `S_TEXT_SECONDARY`、`S_TEXT_PRIMARY` 等 — style 对象常量
   - `PlayIcon`、`PauseIcon` — SVG JSX 常量
   - `SETTING_FIELDS` — 配置驱动表单（key/label/min/max/unit/colorVar）
5. **主组件 `App`** — hooks → derived values → effects → handlers → JSX
6. **子组件 `SettingsModal`** — 设置弹窗，独立文件内组件

### CSS 设计令牌（暖瓷色系）

定义在 `src/index.css`，亮/暗双主题：

| 变量 | 用途 |
|---|---|
| `--accent` | 主强调色（柔和陶土 #cd9583） |
| `--accent-break` | 休息强调色（淡鼠尾草绿 #8da891） |
| `--bg-primary` | 主背景（暖瓷白 #faf7f2） |
| `--text-primary` / `--text-secondary` | 文字层级 |
| `--frost-border` | 边框/分隔线 |
| `--card-bg` | 卡片背景 |
| `--btn-bg` | 按钮背景 |
| `--progress-bg` | 进度环底色 |

- 禁止使用纯黑 `#000` 或纯白 `#fff`，全部走 CSS 变量
- CSS transition 精准化：只对需要的属性加过渡（`background`、`border-color`、`transform`），禁用 `transition: all`

---

## 图标资源

- **Tauri 应用图标**: `pomodoro-app/src-tauri/icons/`（多格式: png, ico, icns）

---

## Git & GitHub

- Remote: `git@github.com:tinga525/pomodoro-timer.git`
- SSH key: `~/.ssh/id_ed25519.pub`
