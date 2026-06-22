#!/usr/bin/env python3
"""
🍅 番茄钟桌面应用 - Pomodoro Timer
一个简洁美观的桌面番茄钟，帮助提高工作效率。
"""

import tkinter as tk
from tkinter import ttk, messagebox
import time
import threading
import json
import os
import sys
import math
from datetime import datetime

# ============================================================
# 配置
# ============================================================
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pomodoro_config.json")

DEFAULT_CONFIG = {
    "work_time": 25 * 60,           # 专注时间（秒）
    "short_break": 5 * 60,          # 短休息（秒）
    "long_break": 15 * 60,          # 长休息（秒）
    "long_break_interval": 4,       # 长休息间隔（番茄数）
    "daily_goal": 8,                # 每日目标（番茄数）
    "always_on_top": False,         # 窗口置顶
    "opacity": 1.0,                 # 窗口透明度
}

COLORS = {
    "bg": "#2B2B2B",
    "fg": "#FFFFFF",
    "accent": "#E74C3C",        # 番茄红
    "accent_break": "#2ECC71",  # 休息绿
    "accent_dark": "#C0392B",
    "card_bg": "#363636",
    "card_fg": "#CCCCCC",
    "progress_bg": "#444444",
    "progress_fg": "#E74C3C",
    "progress_break": "#2ECC71",
    "btn_bg": "#444444",
    "btn_fg": "#FFFFFF",
    "btn_hover": "#555555",
    "text_dim": "#888888",
    "text_bright": "#FFFFFF",
}

FONTS = {
    "timer": ("Segoe UI", 56, "bold"),
    "timer_small": ("Segoe UI", 40, "bold"),
    "label": ("Segoe UI", 12),
    "label_small": ("Segoe UI", 10),
    "stats": ("Segoe UI", 14, "bold"),
    "title": ("Segoe UI", 16, "bold"),
}


class PomodoroTimer:
    """番茄钟主应用"""

    def __init__(self):
        self.load_config()

        self.root = tk.Tk()
        self.root.title("🍅 番茄钟")
        self.root.geometry("380x520")
        self.root.configure(bg=COLORS["bg"])
        self.root.resizable(False, False)

        # 窗口图标（使用字符）
        # self.root.iconbitmap(default=...)

        # 状态变量
        self.state = "idle"       # idle | work | short_break | long_break
        self.time_left = self.config["work_time"]
        self.pomodoro_count = 0   # 当前连续番茄数
        self.daily_count = 0      # 今日完成番茄数
        self.is_running = False
        self.paused = False
        self.timer_thread = None
        self.session_start = None

        # 加载今日数据
        self.load_daily_data()

        # 构建 UI
        self.setup_ui()

        # 窗口设置
        self.root.attributes("-topmost", self.config["always_on_top"])
        self.root.attributes("-alpha", self.config["opacity"])

        # 绑定快捷键
        self.root.bind("<space>", lambda e: self.toggle_timer())
        self.root.bind("<Escape>", lambda e: self.reset_timer())
        self.root.bind("<Control-s>", lambda e: self.open_settings())

        # 窗口关闭事件
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ============================================================
    # 配置管理
    # ============================================================
    def load_config(self):
        self.config = DEFAULT_CONFIG.copy()
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    self.config.update(saved)
        except Exception:
            pass

    def save_config(self):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

    def load_daily_data(self):
        """加载今日统计数据"""
        self.data_file = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "pomodoro_data.json"
        )
        try:
            if os.path.exists(self.data_file):
                with open(self.data_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                today = datetime.now().strftime("%Y-%m-%d")
                if data.get("date") == today:
                    self.daily_count = data.get("count", 0)
        except Exception:
            pass

    def save_daily_data(self):
        """保存今日统计数据"""
        today = datetime.now().strftime("%Y-%m-%d")
        try:
            with open(self.data_file, "w", encoding="utf-8") as f:
                json.dump({"date": today, "count": self.daily_count}, f)
        except Exception:
            pass

    # ============================================================
    # UI 构建
    # ============================================================
    def setup_ui(self):
        # 标题栏
        title_frame = tk.Frame(self.root, bg=COLORS["bg"])
        title_frame.pack(fill="x", pady=(15, 0))

        tk.Label(
            title_frame,
            text="🍅 番茄钟",
            font=FONTS["title"],
            bg=COLORS["bg"],
            fg=COLORS["fg"],
        ).pack()

        # 模式标签
        self.mode_label = tk.Label(
            title_frame,
            text="准备开始",
            font=FONTS["label"],
            bg=COLORS["bg"],
            fg=COLORS["text_dim"],
        )
        self.mode_label.pack()

        # 计时器显示
        timer_frame = tk.Frame(self.root, bg=COLORS["bg"])
        timer_frame.pack(pady=(20, 10))

        self.canvas = tk.Canvas(
            timer_frame,
            width=220,
            height=220,
            bg=COLORS["bg"],
            highlightthickness=0,
        )
        self.canvas.pack()

        # 绘制圆形进度环
        self.center_x = 110
        self.center_y = 110
        self.radius = 95
        self.progress_width = 8

        # 背景圆
        self.canvas.create_oval(
            self.center_x - self.radius,
            self.center_y - self.radius,
            self.center_x + self.radius,
            self.center_y + self.radius,
            outline=COLORS["progress_bg"],
            width=self.progress_width,
        )

        # 进度弧（用扇形模拟）
        self.progress_arc = self.canvas.create_arc(
            self.center_x - self.radius,
            self.center_y - self.radius,
            self.center_x + self.radius,
            self.center_y + self.radius,
            start=90,
            extent=0,
            outline="",
            fill="",
            width=self.progress_width,
            style="arc",
        )

        # 时间文本
        self.timer_text = self.canvas.create_text(
            self.center_x,
            self.center_y - 15,
            text=self.format_time(self.time_left),
            font=FONTS["timer"],
            fill=COLORS["fg"],
            anchor="center",
        )

        # 状态小标签
        self.status_text = self.canvas.create_text(
            self.center_x,
            self.center_y + 30,
            text="",
            font=FONTS["label_small"],
            fill=COLORS["text_dim"],
            anchor="center",
        )

        # 进度百分比
        self.percent_text = self.canvas.create_text(
            self.center_x,
            self.center_y + 52,
            text="",
            font=("Segoe UI", 9),
            fill=COLORS["text_dim"],
            anchor="center",
        )

        # 控制按钮
        btn_frame = tk.Frame(self.root, bg=COLORS["bg"])
        btn_frame.pack(pady=(5, 15))

        self.btn_style = {
            "font": ("Segoe UI", 11, "bold"),
            "bg": COLORS["btn_bg"],
            "fg": COLORS["btn_fg"],
            "activebackground": COLORS["btn_hover"],
            "activeforeground": COLORS["fg"],
            "bd": 0,
            "padx": 20,
            "pady": 8,
            "cursor": "hand2",
            "relief": "flat",
        }

        btn_inner = tk.Frame(btn_frame, bg=COLORS["bg"])
        btn_inner.pack()

        self.start_btn = tk.Button(
            btn_inner,
            text="▶  开始",
            command=self.toggle_timer,
            width=10,
            **self.btn_style,
        )
        self.start_btn.pack(side="left", padx=5)

        self.reset_btn = tk.Button(
            btn_inner,
            text="↺  重置",
            command=self.reset_timer,
            width=8,
            **self.btn_style,
        )
        self.reset_btn.pack(side="left", padx=5)

        self.settings_btn = tk.Button(
            btn_inner,
            text="⚙  设置",
            command=self.open_settings,
            width=8,
            **self.btn_style,
        )
        self.settings_btn.pack(side="left", padx=5)

        # 统计信息
        stats_frame = tk.Frame(self.root, bg=COLORS["card_bg"], bd=0, highlightthickness=0)
        stats_frame.pack(fill="x", padx=30, pady=(0, 15), ipady=8)

        stats_inner = tk.Frame(stats_frame, bg=COLORS["card_bg"])
        stats_inner.pack(pady=5)

        # 今日完成
        tk.Label(
            stats_inner,
            text="今日完成",
            font=FONTS["label_small"],
            bg=COLORS["card_bg"],
            fg=COLORS["text_dim"],
        ).grid(row=0, column=0, padx=(0, 20))

        self.daily_label = tk.Label(
            stats_inner,
            text=f"{self.daily_count} 个",
            font=FONTS["stats"],
            bg=COLORS["card_bg"],
            fg=COLORS["accent"],
        )
        self.daily_label.grid(row=1, column=0, padx=(0, 20))

        # 连续番茄
        tk.Label(
            stats_inner,
            text="当前连续",
            font=FONTS["label_small"],
            bg=COLORS["card_bg"],
            fg=COLORS["text_dim"],
        ).grid(row=0, column=1, padx=20)

        self.session_label = tk.Label(
            stats_inner,
            text=f"{self.pomodoro_count} 个",
            font=FONTS["stats"],
            bg=COLORS["card_bg"],
            fg=COLORS["accent_break"],
        )
        self.session_label.grid(row=1, column=1, padx=20)

        # 目标进度
        tk.Label(
            stats_inner,
            text="目标进度",
            font=FONTS["label_small"],
            bg=COLORS["card_bg"],
            fg=COLORS["text_dim"],
        ).grid(row=0, column=2, padx=(20, 0))

        goal = self.config["daily_goal"]
        self.goal_label = tk.Label(
            stats_inner,
            text=f"{min(self.daily_count, goal)}/{goal}",
            font=FONTS["stats"],
            bg=COLORS["card_bg"],
            fg=COLORS["fg"],
        )
        self.goal_label.grid(row=1, column=2, padx=(20, 0))

        # 底部快捷键提示
        tk.Label(
            self.root,
            text="空格: 开始/暂停  Esc: 重置  Ctrl+S: 设置",
            font=("Segoe UI", 8),
            bg=COLORS["bg"],
            fg=COLORS["text_dim"],
        ).pack(side="bottom", pady=(0, 10))

        # 更新进度环颜色
        self.update_progress_color()

    # ============================================================
    # 计时逻辑
    # ============================================================
    def toggle_timer(self):
        if self.state == "idle":
            self.start_work()
        elif self.paused:
            self.resume_timer()
        else:
            self.pause_timer()

    def start_work(self):
        self.state = "work"
        self.time_left = self.config["work_time"]
        self.is_running = True
        self.paused = False
        self.session_start = time.time()
        self.mode_label.config(text="📚 专注时间", fg=COLORS["accent"])
        self.start_btn.config(text="⏸  暂停")
        self.canvas.itemconfig(self.status_text, text="工作中")
        self.update_progress_color()
        self.start_countdown()

    def start_short_break(self):
        self.state = "short_break"
        self.time_left = self.config["short_break"]
        self.is_running = True
        self.paused = False
        self.mode_label.config(text="☕ 休息一下", fg=COLORS["accent_break"])
        self.start_btn.config(text="⏸  暂停")
        self.canvas.itemconfig(self.status_text, text="休息中")
        self.update_progress_color()
        self.start_countdown()

    def start_long_break(self):
        self.state = "long_break"
        self.time_left = self.config["long_break"]
        self.is_running = True
        self.paused = False
        self.mode_label.config(text="🌿 长休息", fg=COLORS["accent_break"])
        self.start_btn.config(text="⏸  暂停")
        self.canvas.itemconfig(self.status_text, text="长休息中")
        self.update_progress_color()
        self.start_countdown()

    def pause_timer(self):
        if not self.is_running:
            return
        self.paused = True
        self.is_running = False
        self.start_btn.config(text="▶  继续")
        self.mode_label.config(text="⏸ 已暂停")
        self.canvas.itemconfig(self.status_text, text="已暂停")

    def resume_timer(self):
        self.paused = False
        self.is_running = True
        self.start_btn.config(text="⏸  暂停")
        if self.state == "work":
            self.mode_label.config(text="📚 专注时间", fg=COLORS["accent"])
            self.canvas.itemconfig(self.status_text, text="工作中")
        else:
            self.mode_label.config(text="☕ 休息中", fg=COLORS["accent_break"])
            self.canvas.itemconfig(self.status_text, text="休息中")
        self.start_countdown()

    def reset_timer(self):
        self.is_running = False
        self.paused = False
        self.state = "idle"
        self.time_left = self.config["work_time"]
        self.mode_label.config(text="准备开始", fg=COLORS["text_dim"])
        self.start_btn.config(text="▶  开始")
        self.canvas.itemconfig(self.status_text, text="")
        self.update_display()
        self.update_progress_color()

    def start_countdown(self):
        if self.timer_thread and self.timer_thread.is_alive():
            return
        self.timer_thread = threading.Thread(target=self.countdown_loop, daemon=True)
        self.timer_thread.start()

    def countdown_loop(self):
        """倒计时主循环（在子线程中运行）"""
        while self.is_running and self.time_left > 0:
            time.sleep(0.1)
            if not self.is_running:
                break
            self.time_left -= 0.1
            if self.time_left < 0:
                self.time_left = 0
            # 更新 UI（必须在主线程）
            self.root.after(0, self.update_display)

        # 倒计时结束
        if self.is_running and self.time_left <= 0:
            self.root.after(0, self.on_timer_complete)

    def on_timer_complete(self):
        """计时完成时的处理"""
        self.is_running = False
        self.paused = False

        # 播放提示音
        self.play_notification()

        if self.state == "work":
            # 完成一个番茄
            self.pomodoro_count += 1
            self.daily_count += 1
            self.save_daily_data()
            self.update_stats()

            # 显示完成信息
            self.show_completion_message(f"🎉 完成第 {self.pomodoro_count} 个番茄！")

            # 判断是短休息还是长休息
            if self.pomodoro_count % self.config["long_break_interval"] == 0:
                self.start_long_break()
            else:
                self.start_short_break()
        else:
            # 休息结束，回到工作状态
            self.show_completion_message("⏰ 休息结束，继续加油！")
            self.state = "idle"
            self.time_left = self.config["work_time"]
            self.mode_label.config(text="准备开始", fg=COLORS["text_dim"])
            self.start_btn.config(text="▶  开始")
            self.canvas.itemconfig(self.status_text, text="")
            self.update_display()

    def play_notification(self):
        """播放提示音（非阻塞，使用 root.after 避免卡 UI）"""
        try:
            import winsound
            self._beep_count = 0
            self._beep_loop()
        except Exception:
            # 使用系统 bell
            print("\a", end="", flush=True)

    def _beep_loop(self):
        """用 after 链式播放提示音，不阻塞主线程"""
        try:
            import winsound
            winsound.Beep(880, 180)
            self._beep_count += 1
            if self._beep_count < 3:
                self.root.after(250, self._beep_loop)
        except Exception:
            pass

    def show_completion_message(self, message):
        """显示完成消息"""
        popup = tk.Toplevel(self.root)
        popup.title("🍅 番茄钟")
        popup.geometry("300x150")
        popup.configure(bg=COLORS["bg"])
        popup.resizable(False, False)
        popup.attributes("-topmost", True)

        # 居中显示
        popup.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() - 300) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - 150) // 2
        popup.geometry(f"+{x}+{y}")

        tk.Label(
            popup,
            text=message,
            font=("Segoe UI", 14),
            bg=COLORS["bg"],
            fg=COLORS["fg"],
            wraplength=260,
        ).pack(expand=True)

        tk.Button(
            popup,
            text="👍 好的",
            command=popup.destroy,
            font=("Segoe UI", 11),
            bg=COLORS["accent"],
            fg="white",
            activebackground=COLORS["accent_dark"],
            bd=0,
            padx=25,
            pady=6,
            cursor="hand2",
        ).pack(pady=(0, 20))

        # 3 秒后自动关闭
        popup.after(3000, lambda: popup.destroy() if popup.winfo_exists() else None)

    # ============================================================
    # UI 更新
    # ============================================================
    def update_display(self):
        """更新计时器显示"""
        self.update_time_text()
        self.update_progress()

    def update_time_text(self):
        """更新时间数字"""
        text = self.format_time(self.time_left)
        self.canvas.itemconfig(self.timer_text, text=text)

    def format_time(self, seconds):
        """将秒数格式化为 MM:SS"""
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes:02d}:{secs:02d}"

    def update_progress(self):
        """更新进度环"""
        if self.state == "work":
            total = self.config["work_time"]
        elif self.state == "short_break":
            total = self.config["short_break"]
        elif self.state == "long_break":
            total = self.config["long_break"]
        else:
            total = self.config["work_time"]
            progress = 0
            self.canvas.itemconfig(self.percent_text, text="")
            self.canvas.itemconfig(self.progress_arc, extent=0)
            return

        progress = max(0, (total - self.time_left) / total) if total > 0 else 0
        extent = progress * 360

        self.canvas.itemconfig(self.progress_arc, extent=extent)
        self.canvas.itemconfig(
            self.percent_text,
            text=f"{int(progress * 100)}%"
        )

    def update_progress_color(self):
        """更新进度环颜色"""
        if self.state in ("short_break", "long_break"):
            color = COLORS["progress_break"]
        else:
            color = COLORS["progress_fg"]

        self.canvas.itemconfig(self.progress_arc, outline=color)

    def update_stats(self):
        """更新统计信息"""
        self.daily_label.config(text=f"{self.daily_count} 个")
        self.session_label.config(text=f"{self.pomodoro_count} 个")

        goal = self.config["daily_goal"]
        self.goal_label.config(text=f"{min(self.daily_count, goal)}/{goal}")

    # ============================================================
    # 设置窗口
    # ============================================================
    def open_settings(self):
        if self.is_running:
            if not messagebox.askyesno("提示", "计时器正在运行，打开设置将重置计时器。是否继续？"):
                return
            self.reset_timer()

        win = tk.Toplevel(self.root)
        win.title("⚙ 番茄钟设置")
        win.geometry("360x350")
        win.configure(bg=COLORS["bg"])
        win.resizable(False, False)
        win.attributes("-topmost", True)
        win.transient(self.root)
        win.grab_set()

        # 居中
        win.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() - 360) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - 350) // 2
        win.geometry(f"+{x}+{y}")

        lbl_style = {
            "font": FONTS["label"],
            "bg": COLORS["bg"],
            "fg": COLORS["fg"],
        }
        entry_style = {
            "font": ("Segoe UI", 11),
            "bg": COLORS["card_bg"],
            "fg": COLORS["fg"],
            "insertbackground": COLORS["fg"],
            "bd": 0,
            "width": 6,
            "justify": "center",
        }

        frame = tk.Frame(win, bg=COLORS["bg"])
        frame.pack(pady=20, padx=30, fill="both", expand=True)

        # 输入字段
        fields = [
            ("专注时间 (分钟)", "work_time", self.config["work_time"] // 60),
            ("短休息 (分钟)", "short_break", self.config["short_break"] // 60),
            ("长休息 (分钟)", "long_break", self.config["long_break"] // 60),
            ("长休息间隔 (番茄数)", "long_break_interval", self.config["long_break_interval"]),
            ("每日目标 (番茄数)", "daily_goal", self.config["daily_goal"]),
        ]

        entries = {}
        for i, (label, key, default) in enumerate(fields):
            tk.Label(frame, text=label, **lbl_style).grid(
                row=i, column=0, sticky="w", pady=6
            )
            var = tk.StringVar(value=str(default))
            entry = tk.Entry(frame, textvariable=var, **entry_style)
            entry.grid(row=i, column=1, padx=(10, 0), pady=6)
            entries[key] = var

        # 置顶选项
        var_top = tk.BooleanVar(value=self.config["always_on_top"])
        tk.Checkbutton(
            frame,
            text="窗口置顶",
            variable=var_top,
            font=FONTS["label"],
            bg=COLORS["bg"],
            fg=COLORS["fg"],
            selectcolor=COLORS["card_bg"],
            activebackground=COLORS["bg"],
            activeforeground=COLORS["fg"],
        ).grid(row=len(fields), column=0, columnspan=2, sticky="w", pady=8)

        def save_settings():
            try:
                self.config["work_time"] = int(entries["work_time"].get()) * 60
                self.config["short_break"] = int(entries["short_break"].get()) * 60
                self.config["long_break"] = int(entries["long_break"].get()) * 60
                self.config["long_break_interval"] = int(entries["long_break_interval"].get())
                self.config["daily_goal"] = int(entries["daily_goal"].get())
                self.config["always_on_top"] = var_top.get()

                if any(v <= 0 for v in [
                    self.config["work_time"],
                    self.config["short_break"],
                    self.config["long_break"],
                    self.config["long_break_interval"],
                    self.config["daily_goal"],
                ]):
                    messagebox.showerror("错误", "所有值必须大于 0", parent=win)
                    return

                self.save_config()
                self.time_left = self.config["work_time"]
                self.update_display()
                self.update_stats()
                self.root.attributes("-topmost", self.config["always_on_top"])

                win.destroy()
                messagebox.showinfo("设置已保存", "番茄钟设置已更新。")

            except ValueError:
                messagebox.showerror("错误", "请输入有效的数字", parent=win)

        btn_frame = tk.Frame(win, bg=COLORS["bg"])
        btn_frame.pack(pady=(0, 20))

        tk.Button(
            btn_frame,
            text="✅  保存",
            command=save_settings,
            font=("Segoe UI", 11, "bold"),
            bg=COLORS["accent"],
            fg="white",
            activebackground=COLORS["accent_dark"],
            bd=0,
            padx=25,
            pady=6,
            cursor="hand2",
        ).pack(side="left", padx=5)

        tk.Button(
            btn_frame,
            text="取消",
            command=win.destroy,
            font=("Segoe UI", 11),
            bg=COLORS["btn_bg"],
            fg=COLORS["btn_fg"],
            activebackground=COLORS["btn_hover"],
            bd=0,
            padx=20,
            pady=6,
            cursor="hand2",
        ).pack(side="left", padx=5)

    # ============================================================
    # 窗口事件
    # ============================================================
    def on_close(self):
        if self.is_running:
            if not messagebox.askyesno("退出", "计时器正在运行，确定退出吗？"):
                return
        self.save_config()
        self.save_daily_data()
        self.root.destroy()

    def run(self):
        self.root.mainloop()


# ============================================================
# 启动
# ============================================================
if __name__ == "__main__":
    app = PomodoroTimer()
    app.run()
