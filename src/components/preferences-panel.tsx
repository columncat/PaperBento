"use client";

import { Check, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import {
  COLUMNS,
  DELETE_CONFIRM,
  DELETE_CONFIRM_LABEL,
  DEFAULT_COLUMNS,
  DEFAULT_DELETE_CONFIRM,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  STORAGE_KEYS,
  THEMES,
  applyThemeAndModeToHtml,
  readDeleteConfirmPref,
  type ColumnsPref,
  type DeleteConfirmPref,
  type ModePref,
  type ThemeKey,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

/**
 * 표시 설정 — 브라우저에만 남는다.
 *
 * 테마·모드·열 개수는 기기마다 다를 수 있는 것이라 서버에 두지 않는다.
 * 큰 모니터에서는 6단, 노트북에서는 3단이 편한데 그걸 계정 하나로 묶으면
 * 자리를 옮길 때마다 다시 고쳐야 한다.
 *
 * 서가별 보기 방식(목록/표지)만 서버에 있다. 그건 "이 서가는 표지로 보는
 * 것" 이라는 서가의 성격이지 기기의 사정이 아니다.
 */
export function PreferencesPanel() {
  const [theme, setTheme] = useState<ThemeKey>(DEFAULT_THEME);
  const [mode, setMode] = useState<ModePref>(DEFAULT_MODE);
  const [columns, setColumns] = useState<ColumnsPref>(DEFAULT_COLUMNS);
  const [delConfirm, setDelConfirm] = useState<DeleteConfirmPref>(DEFAULT_DELETE_CONFIRM);

  useEffect(() => {
    try {
      const t = localStorage.getItem(STORAGE_KEYS.theme) as ThemeKey | null;
      const m = localStorage.getItem(STORAGE_KEYS.mode) as ModePref | null;
      const c = localStorage.getItem(STORAGE_KEYS.columns) as ColumnsPref | null;
      if (t) setTheme(t);
      if (m) setMode(m);
      if (c) setColumns(c);
      setDelConfirm(readDeleteConfirmPref());
    } catch {
      /* */
    }
  }, []);

  const save = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 사생활 보호 모드에서는 저장이 막힌다. 이번 세션만 적용되고 끝난다. */
    }
  };

  const onTheme = (t: ThemeKey) => {
    setTheme(t);
    save(STORAGE_KEYS.theme, t);
    applyThemeAndModeToHtml(t, mode);
  };
  const onMode = (m: ModePref) => {
    setMode(m);
    save(STORAGE_KEYS.mode, m);
    applyThemeAndModeToHtml(theme, m);
  };
  const onColumns = (c: ColumnsPref) => {
    setColumns(c);
    save(STORAGE_KEYS.columns, c);
  };
  const onDeleteConfirm = (v: DeleteConfirmPref) => {
    setDelConfirm(v);
    save(STORAGE_KEYS.deleteConfirm, v);
    // 규칙을 바꾸면 "오늘 이미 물어봤음" 기록도 지워 새 규칙이 바로 먹게 한다.
    try {
      localStorage.removeItem(STORAGE_KEYS.deleteConfirmedOn);
    } catch {
      /* */
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <div className="mb-4 text-base font-medium text-(--color-fg)">표시 설정</div>

      {/* 모드 */}
      <div className="mb-5">
        <div className="mb-2 text-[11px] font-medium tracking-wider text-(--color-fg-4) uppercase">
          모드
        </div>
        <div className="flex gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium transition",
                mode === m
                  ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                  : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
              )}
            >
              {m === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
              {m === "dark" ? "다크" : "라이트"}
            </button>
          ))}
        </div>
      </div>

      {/* 테마 */}
      <div className="mb-5">
        <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium tracking-wider text-(--color-fg-4) uppercase">
          <Palette className="h-3 w-3" />
          테마
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTheme(t.key)}
              className={cn(
                "group relative flex flex-col items-center gap-1.5 rounded-lg p-2 transition",
                theme === t.key
                  ? "bg-(--color-bg-2) ring-1 ring-(--color-accent)/60"
                  : "hover:bg-(--color-surface-hi)",
              )}
            >
              <div
                aria-hidden
                className="h-7 w-7 rounded-full ring-1 ring-black/10"
                style={{ background: t.swatch }}
              />
              <span className="text-[10.5px] text-(--color-fg-2)">{t.label}</span>
              {theme === t.key && (
                <Check className="absolute top-1.5 right-1.5 h-2.5 w-2.5 text-(--color-accent-strong)" />
              )}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] break-keep text-(--color-fg-4)">
          MemoBento · MailBento 와 같은 팔레트입니다. 세 앱을 나란히 띄워 두고
          쓰는 자리라 색이 어긋나면 그것만으로 다른 앱처럼 보입니다.
        </p>
      </div>

      {/* 열 개수 */}
      <div className="mb-5">
        <div className="mb-2 text-[11px] font-medium tracking-wider text-(--color-fg-4) uppercase">
          서가 열 개수
        </div>
        <div className="flex gap-1.5">
          {COLUMNS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColumns(c)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                columns === c
                  ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                  : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
              )}
            >
              {c === "auto" ? "Auto" : c}
            </button>
          ))}
        </div>
      </div>

      {/* 논문 삭제 확인 */}
      <div>
        <div className="mb-2 text-[11px] font-medium tracking-wider text-(--color-fg-4) uppercase">
          논문 삭제 확인
        </div>
        <div className="flex gap-1.5">
          {DELETE_CONFIRM.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onDeleteConfirm(v)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                delConfirm === v
                  ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                  : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
              )}
            >
              {DELETE_CONFIRM_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] break-keep text-(--color-fg-4)">
          지운 논문은 30일간 휴지통에 남으므로 <b>묻지 않음</b>도 안전합니다.
          다만 논문은 PDF 를 딸고 있어 되살리기가 더 중요합니다 — 그래서 서가
          삭제는 이 설정과 무관하게 늘 확인합니다.
        </p>
      </div>
    </section>
  );
}
