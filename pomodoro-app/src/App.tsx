import { useState, useEffect, useRef, useCallback } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ============================================================
// Types & Constants
// ============================================================
type TimerState = "idle" | "working" | "paused" | "short_break" | "long_break";

interface Config {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  dailyGoal: number;
  alwaysOnTop: boolean;
}

const DEFAULT_CONFIG: Config = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  dailyGoal: 8,
  alwaysOnTop: false,
};

// ============================================================
// Helper functions
// ============================================================
const formatTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

const totalSeconds = (minutes: number): number => minutes * 60;

// ============================================================
// Module-level constants
// ============================================================
const CIRCUMFERENCE = 2 * Math.PI * 44; // r=44

const STATE_LABELS: Record<TimerState, { text: string; sub: string }> = {
  idle:        { text: "准备开始", sub: "" },
  working:     { text: "专注中",   sub: "保持专注" },
  paused:      { text: "已暂停",   sub: "休息一下" },
  short_break: { text: "短休息",   sub: "放松片刻" },
  long_break:  { text: "长休息",   sub: "好好放松" },
};

const BUTTON_TEXT: Record<TimerState, string> = {
  idle:        "开始专注",
  working:     "暂停",
  paused:      "继续",
  short_break: "暂停",
  long_break:  "暂停",
};

const TOTAL_FN: Record<TimerState, (c: Config) => number> = {
  idle:        (c) => totalSeconds(c.workMinutes),
  working:     (c) => totalSeconds(c.workMinutes),
  paused:      (c) => totalSeconds(c.workMinutes),
  short_break: (c) => totalSeconds(c.shortBreakMinutes),
  long_break:  (c) => totalSeconds(c.longBreakMinutes),
};

// 不可变 style 引用
const S_TEXT_SECONDARY  = { color: "var(--text-secondary)" } as const;
const S_TEXT_PRIMARY    = { color: "var(--text-primary)" } as const;
const S_BTN_BORDER      = { border: "1px solid var(--frost-border)" } as const;
const S_TRANSPARENT     = { background: "transparent" } as const;

// SVG 图标
const PlayIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);
const PauseIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

// 设置表单字段定义
const SETTING_FIELDS: {
  key: keyof Config;
  label: string;
  min: number;
  max: number;
  unit: string;
  colorVar: string;
}[] = [
  { key: "workMinutes",       label: "专注时间",   min: 1, max: 120, unit: "分钟",   colorVar: "var(--accent)" },
  { key: "shortBreakMinutes", label: "短休息",     min: 1, max: 30,  unit: "分钟",   colorVar: "var(--accent-break)" },
  { key: "longBreakMinutes",  label: "长休息",     min: 1, max: 60,  unit: "分钟",   colorVar: "var(--accent-break)" },
  { key: "longBreakInterval", label: "长休息间隔",  min: 1, max: 20,  unit: "个番茄", colorVar: "var(--text-primary)" },
  { key: "dailyGoal",         label: "每日目标",   min: 1, max: 99,  unit: "个",     colorVar: "var(--text-primary)" },
];

// ============================================================
// Main App
// ============================================================
export default function App() {
  // --- Config ---
  const [config, setConfig] = useState<Config>(() => {
    try {
      const saved = localStorage.getItem("pomodoro-config");
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  });

  // --- Dark mode ---
  const [dark, setDark] = useState(() => {
    return localStorage.getItem("pomodoro-theme") === "dark" ||
      (!localStorage.getItem("pomodoro-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("pomodoro-theme", dark ? "dark" : "light");
  }, [dark]);

  // --- Timer state ---
  const [state, setState] = useState<TimerState>("idle");
  const [timeLeft, setTimeLeft] = useState(totalSeconds(config.workMinutes));
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const [dailyCount, setDailyCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("pomodoro-daily");
      if (saved) {
        const data = JSON.parse(saved);
        const today = new Date().toISOString().slice(0, 10);
        return data.date === today ? data.count : 0;
      }
    } catch {}
    return 0;
  });
  const [showSettings, setShowSettings] = useState(false);

  const intervalRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- Derived ---
  const currentTotal = TOTAL_FN[state](config);

  const progress = currentTotal > 0
    ? ((currentTotal - timeLeft) / currentTotal) * 100
    : 0;

  const strokeDashoffset = CIRCUMFERENCE * (1 - progress / 100);

  const completedToday = Math.min(dailyCount, config.dailyGoal);

  // --- Save daily count ---
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem("pomodoro-daily", JSON.stringify({ date: today, count: dailyCount }));
  }, [dailyCount]);

  // --- Save config ---
  useEffect(() => {
    localStorage.setItem("pomodoro-config", JSON.stringify(config));
  }, [config]);

  // --- Play notification ---
  const playNotification = useCallback(() => {
    // Tauri 桌面通知
    try {
      isPermissionGranted().then((granted) => {
        if (!granted) {
          requestPermission().then(() => {
            sendNotification({ title: "🍅 番茄钟", body: "时间到！" });
          });
        } else {
          sendNotification({ title: "🍅 番茄钟", body: "时间到！" });
        }
      });
    } catch {}

    // 同时播放声音
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(
          "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACAgICAf39/f39/f3+AgICAf39/f3+AgICAf39/f3+AgICAf39/f39/f3+AgICAf39/f39/f3+AgICAf39/f39/f3+AgICAf39/f39/f3+AgICAf39/f38"
        );
      }
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } catch {}
  }, []);

  // --- Clear interval helper ---
  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // --- Start countdown ---
  const startCountdown = useCallback(() => {
    clearTimer();
    intervalRef.current = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTimer]);

  // --- Timer complete handler ---
  useEffect(() => {
    if (timeLeft > 0 || state === "idle") return;

    playNotification();

    if (state === "working") {
      const newPomo = pomodoroCount + 1;
      setPomodoroCount(newPomo);
      setDailyCount((prev) => prev + 1);

      if (newPomo % config.longBreakInterval === 0) {
        setState("long_break");
        setTimeLeft(totalSeconds(config.longBreakMinutes));
      } else {
        setState("short_break");
        setTimeLeft(totalSeconds(config.shortBreakMinutes));
      }
    } else {
      // Break finished → back to idle
      setState("idle");
      setTimeLeft(totalSeconds(config.workMinutes));
    }
  }, [timeLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Start auto-countdown when entering working/break states ---
  useEffect(() => {
    if (state === "working" || state === "short_break" || state === "long_break") {
      startCountdown();
    }
    return clearTimer;
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Handlers ---
  const handleToggle = () => {
    switch (state) {
      case "idle":
        setState("working");
        break;
      case "paused":
        setState("working");
        startCountdown();
        break;
      case "working":
      case "short_break":
      case "long_break":
        clearTimer();
        setState("paused");
        break;
    }
  };

  const resetToIdle = useCallback(() => {
    clearTimer();
    setState("idle");
    setTimeLeft(totalSeconds(config.workMinutes));
  }, [clearTimer, config.workMinutes]);

  // --- Settings save ---
  const handleSaveSettings = (newConfig: Config) => {
    setConfig(newConfig);
    if (state === "idle" || state === "paused") {
      setTimeLeft(totalSeconds(newConfig.workMinutes));
    }
    setShowSettings(false);

    // Tauri: window always-on-top
    try {
      getCurrentWindow().setAlwaysOnTop(newConfig.alwaysOnTop);
    } catch {} // 浏览器环境下忽略
  };

  // --- State display labels ---
  const stateLabel = STATE_LABELS[state];

  const isBreak = state === "short_break" || state === "long_break";

  // --- Button text ---
  const buttonText = BUTTON_TEXT[state];

  const accentColor = isBreak ? "var(--accent-break)" : "var(--accent)";

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center frost relative overflow-hidden">
      {/* Title bar (drag region) + 右上角操作区 */}
      <div className="titlebar">
        <span className="text-xs tracking-widest ml-3" style={S_TEXT_SECONDARY}>
          番茄钟
        </span>
        {/* 右侧按钮组 */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 titlebar-button z-50">
          {/* 设置 */}
          <button
            onClick={() => setShowSettings(true)}
            className="w-7 h-7 rounded-full flex items-center justify-center btn-press"
            style={{...S_TRANSPARENT, ...S_TEXT_SECONDARY}}
            aria-label="设置"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {/* 主题切换 */}
          <button
            onClick={() => setDark((d) => !d)}
            className="w-7 h-7 rounded-full flex items-center justify-center btn-press"
            style={{...S_TRANSPARENT, ...S_TEXT_SECONDARY}}
            aria-label="切换主题"
          >
            {dark ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Main Timer */}
      <div className="flex-1 flex flex-col items-center justify-center gap-1 mt-6 animate-fade-in">
        {/* State label */}
        <span
          className="text-lg font-medium tracking-wide mb-2"
          style={S_TEXT_SECONDARY}
        >
          {stateLabel.text}
        </span>

        {/* Circular Progress */}
        <div className="relative w-56 h-56">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            {/* Background ring */}
            <circle
              cx="50" cy="50" r="44"
              fill="none"
              stroke="var(--progress-bg)"
              strokeWidth="4"
            />
            {/* Progress ring */}
            <circle
              cx="50" cy="50" r="44"
              fill="none"
              stroke={accentColor}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              className="progress-ring"
            />
          </svg>

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="text-6xl font-semibold tracking-tight tabular-nums"
              style={S_TEXT_PRIMARY}
            >
              {formatTime(timeLeft)}
            </span>
            <span
              className="text-xs mt-1 font-medium"
              style={S_TEXT_SECONDARY}
            >
              {state === "idle" ? `${config.workMinutes} 分钟` : stateLabel.sub}
            </span>

            {/* Progress percentage (only when active) */}
            {state !== "idle" && (
              <span
                className="text-[10px] mt-2 tabular-nums"
                style={S_TEXT_SECONDARY}
              >
                {Math.round(progress)}%
              </span>
            )}
          </div>
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={handleToggle}
            className="btn-press w-36 h-12 rounded-full text-base font-semibold text-white flex items-center justify-center gap-2"
            style={{ background: accentColor, boxShadow: `0 4px 16px ${accentColor}33` }}
          >
            {(state === "paused" || state === "idle") ? PlayIcon : PauseIcon}
            {buttonText}
          </button>

          <button
            onClick={resetToIdle}
            className="btn-press w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "var(--btn-bg)", ...S_TEXT_SECONDARY, ...S_BTN_BORDER }}
            aria-label="重置"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>

        {/* Skip break (visible during breaks) */}
        {isBreak && (
          <button
            onClick={resetToIdle}
            className="btn-press text-xs mt-2 px-4 py-1.5 rounded-full"
            style={{ background: "var(--btn-bg)", ...S_TEXT_SECONDARY, ...S_BTN_BORDER }}
          >
            跳过休息 →
          </button>
        )}
      </div>

      {/* Bottom: Stats */}
      <div className="w-full px-6 pb-5 animate-fade-in">
        <div className="frost-card flex items-center justify-center gap-8 px-4 py-4">
          {/* 今日完成 */}
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-xs font-normal" style={S_TEXT_SECONDARY}>
              今日完成
            </span>
            <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--accent)" }}>
              {dailyCount}
            </span>
          </div>

          {/* 分隔 */}
          <div className="w-px h-10" style={{ background: "var(--frost-border)" }} />

          {/* 连续番茄 */}
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-xs font-normal" style={S_TEXT_SECONDARY}>
              连续番茄
            </span>
            <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--accent-break)" }}>
              {pomodoroCount}
            </span>
          </div>

          {/* 分隔 */}
          <div className="w-px h-10" style={{ background: "var(--frost-border)" }} />

          {/* 目标进度 */}
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-xs font-normal" style={S_TEXT_SECONDARY}>
              目标进度
            </span>
            <span className="text-2xl font-bold tabular-nums" style={S_TEXT_PRIMARY}>
              {completedToday}/{config.dailyGoal}
            </span>
            {/* 迷你进度条 */}
            <div className="w-full max-w-16 h-1 rounded-full mt-0.5" style={{ background: "var(--progress-bg)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${config.dailyGoal > 0 ? (completedToday / config.dailyGoal) * 100 : 0}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          config={config}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Settings Modal
// ============================================================
function SettingsModal({
  config,
  onSave,
  onClose,
}: {
  config: Config;
  onSave: (c: Config) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Config>(() => ({ ...config }));

  const set = (key: keyof Config, value: number | boolean) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center animate-fade-in"
      style={{ background: "rgba(0,0,0,0.15)", backdropFilter: "blur(2px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="frost-card w-72 px-5 py-5 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题行 */}
        <div className="flex items-center justify-between">
          <h2
            className="text-xl font-bold tracking-tight"
            style={S_TEXT_PRIMARY}
          >
            设置
          </h2>
          <button
            onClick={onClose}
            className="btn-press w-6 h-6 rounded-full flex items-center justify-center"
            style={{ background: "var(--btn-bg)", ...S_TEXT_SECONDARY }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 表单 */}
        <div className="space-y-4">
          {SETTING_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-4">
              <span className="text-sm font-normal flex-shrink-0" style={S_TEXT_SECONDARY}>
                {f.label}
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min={f.min} max={f.max}
                  value={local[f.key] as number}
                  onChange={(e) => set(f.key, Math.max(1, +e.target.value || 1))}
                  className="w-20 text-right bg-transparent border-0 outline-none text-base font-normal tabular-nums py-1 rounded"
                  style={{ color: f.colorVar }}
                />
                <span className="text-xs font-normal" style={S_TEXT_SECONDARY}>{f.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 窗口置顶 */}
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <span className={labelClass} style={S_TEXT_SECONDARY}>窗口置顶</span>
          <div
            className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
            style={{
              background: local.alwaysOnTop ? "var(--accent)" : "var(--progress-bg)",
            }}
            onClick={() => set("alwaysOnTop", !local.alwaysOnTop)}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
              style={{ left: local.alwaysOnTop ? "22px" : "2px" }}
            />
          </div>
        </label>

        {/* 按钮组 */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="btn-press flex-1 py-2.5 rounded-full text-sm font-medium"
            style={{ background: "var(--btn-bg)", ...S_TEXT_SECONDARY, ...S_BTN_BORDER }}
          >
            取消
          </button>
          <button
            onClick={() => onSave(local)}
            className="btn-press flex-1 py-2.5 rounded-full text-sm font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
