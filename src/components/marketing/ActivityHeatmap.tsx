"use client";

import { useMemo } from "react";
import { useUserData } from "@/components/auth/UserDataProvider";

const TOTAL_WEEKS = 18;
const DAYS = TOTAL_WEEKS * 7;
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function intensity(count: number) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export function ActivityHeatmap() {
  const { activityMap, isAuthenticated, userName } = useUserData();

  const data = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const latestWeekStart = startOfWeek(today);
    const start = addDays(latestWeekStart, -(DAYS - 7));

    const weeks = Array.from({ length: TOTAL_WEEKS }, (_, weekIndex) => {
      const weekStart = addDays(start, weekIndex * 7);
      const previousWeekStart = addDays(weekStart, -7);
      const monthLabel = weekStart.toLocaleString("en-US", { month: "short" });
      return {
        label: weekIndex === 0 || weekStart.getMonth() !== previousWeekStart.getMonth() ? monthLabel : "",
        days: Array.from({ length: 7 }, (_, dayIndex) => {
          const date = addDays(weekStart, dayIndex);
          const key = toDateKey(date);
          const count = activityMap[key] || 0;
          return { count, date, key, level: intensity(count) };
        }),
      };
    });

    const totalActions = Object.values(activityMap).reduce((sum, count) => sum + count, 0);
    const activeDays = Object.values(activityMap).filter((count) => count > 0).length;
    const thisWeek = weeks[weeks.length - 1]?.days.reduce((sum, day) => sum + day.count, 0) || 0;
    return { activeDays, totalActions, thisWeek, weeks };
  }, [activityMap]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Daily study activity</div>
          <p className="mt-1 text-sm leading-6 text-secondary">
            {isAuthenticated
              ? `${userName || "Your"} recent activity on this device.`
              : "Your recent activity in this browser."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-xs text-muted">
          <span>{data.activeDays} active days</span>
          <span>{data.thisWeek} actions this week</span>
          <span>{data.totalActions} total actions</span>
        </div>
      </div>

      <div className="rounded-[24px] border border-terminal bg-[color-mix(in_srgb,var(--bg-surface)_74%,transparent)] p-4">
        <div className="heatmap-months mb-2">
          {data.weeks.map((week, index) => (
            <span key={`${week.label}-${index}`}>{week.label}</span>
          ))}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-weekdays">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          <div className="heatmap-weeks">
            {data.weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="heatmap-week">
                {week.days.map((day) => (
                  <span
                    key={day.key}
                    className="activity-cell"
                    data-level={day.level}
                    title={`${day.date.toDateString()}: ${day.count} ${day.count === 1 ? "action" : "actions"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
