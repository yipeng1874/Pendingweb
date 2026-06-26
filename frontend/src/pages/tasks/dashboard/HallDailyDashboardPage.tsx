import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, Loader2, RefreshCw } from "lucide-react";

import type { HallDailyDashboardResponse } from "../../../types";
import { reportApi } from "../../../services/task";

function getPhaseMeta(phase: HallDailyDashboardResponse["phase"]) {
  if (phase === "in_progress") return { label: "今日执行中", cls: "border-blue-100 bg-blue-50 text-blue-700" };
  if (phase === "supplement") return { label: "补录期", cls: "border-amber-100 bg-amber-50 text-amber-700" };
  return { label: "统计已冻结", cls: "border-emerald-100 bg-emerald-50 text-emerald-700" };
}

function getStatusMeta(status: string | null) {
  if (status === "submitted") return { label: "已提交", cls: "text-emerald-600" };
  if (status === "in_progress") return { label: "进行中", cls: "text-blue-600" };
  if (status === "overdue") return { label: "已逾期", cls: "text-red-600" };
  if (status === "pending") return { label: "未开始", cls: "text-slate-500" };
  return { label: "暂无数据", cls: "text-slate-400" };
}

function getItemTypeName(itemType: string) {
  const map: Record<string, string> = {
    QA: "问答",
    SINGLE_CHOICE: "单选",
    MULTI_CHOICE: "多选",
    FILL_BLANK: "填空",
    LINK: "学习链接",
    ATTACHMENT: "附件",
  };
  return map[itemType] ?? itemType;
}

type Item = NonNullable<HallDailyDashboardResponse["record"]>["items"][number];

function TaskItemCard({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-2xl border ${item.done ? "border-emerald-100 bg-emerald-50/60" : "border-slate-200 bg-white"} px-4 py-3`}>
      <div
        className="flex cursor-pointer items-center justify-between gap-3"
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
            {item.done ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{item.title}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {getItemTypeName(item.itemType)} · {item.isRequired ? "必填" : "选填"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${item.done ? "text-emerald-600" : "text-slate-500"}`}>
            {item.done ? "已完成" : "未完成"}
          </span>
          {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {item.doneAt && <p>完成时间：{item.doneAt.slice(0, 16).replace("T", " ")}</p>}
          {item.answerText && <p>填写内容：{item.answerText}</p>}
          {item.answerOptions?.length ? <p>选项答案：{item.answerOptions.join("、")}</p> : null}
          {item.itemType === "LINK" && (
            <div className="flex items-center gap-2">
              <span>链接确认：{item.isLinkConfirmed ? "已确认" : "未确认"}</span>
              {item.linkUrl && (
                <a
                  href={item.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700 transition hover:bg-blue-100"
                >
                  打开链接
                </a>
              )}
            </div>
          )}
          {!item.done && !item.answerText && !item.answerOptions?.length && <p>暂无回传内容</p>}
        </div>
      )}
    </div>
  );
}

export function HallDailyDashboardPage() {
  const [taskDate, setTaskDate] = useState("");
  const [data, setData] = useState<HallDailyDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(forceDate?: string) {
    setLoading(true);
    setError("");
    const result = await reportApi.getHallDailyDashboard(forceDate ?? taskDate || undefined).catch((err: Error) => {
      setError(err.message || "厅管日常任务看板加载失败");
      return null;
    });
    setData(result);
    if (!taskDate && result?.taskDate) setTaskDate(result.taskDate);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const phaseMeta = data ? getPhaseMeta(data.phase) : null;
  const statusMeta = data ? getStatusMeta(data.summary.status) : null;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-4 xl:flex-nowrap">
          <div className="shrink-0">
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-slate-900">厅管日常任务看板</h1>
            {data?.hall && (
              <p className="mt-1 text-sm text-slate-500">当前厅：<span className="font-medium text-slate-700">{data.hall.name}</span></p>
            )}
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <input
              type="date"
              value={taskDate}
              onChange={(event) => {
                const newDate = event.target.value;
                setTaskDate(newDate);
                if (newDate) void load(newDate);
              }}
              className="h-11 min-w-[200px] rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-blue-400"
            />
            <button
              type="button"
              onClick={() => {
                const today = data?.quickRanges.today ?? taskDate;
                if (!today) return;
                setTaskDate(today);
                void load(today);
              }}
              disabled={!data?.quickRanges.today && !taskDate}
              className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
            >
              今天
            </button>
            {data?.quickRanges.canSupplementYesterday && (
              <button
                type="button"
                onClick={() => {
                  const yesterday = data.quickRanges.yesterday;
                  if (!yesterday) return;
                  setTaskDate(yesterday);
                  void load(yesterday);
                }}
                className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                昨天（补录）
              </button>
            )}
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw size={15} />
              刷新
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />厅管日常任务看板加载中...</span>
        </div>
      ) : data ? (
        <>
          {/* 顶部状态栏 */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">当前状态</p>
              <p className={`mt-3 text-2xl font-bold ${statusMeta?.cls ?? "text-slate-400"}`}>{statusMeta?.label}</p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">已完成题目</p>
              <p className="mt-3 text-2xl font-bold text-emerald-600">
                {data.summary.doneItems}
                <span className="text-base font-normal text-slate-400"> / {data.summary.totalItems}</span>
              </p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">完成率</p>
              <p className={`mt-3 text-2xl font-bold ${data.summary.completionRate >= 100 ? "text-emerald-600" : data.summary.completionRate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                {data.summary.completionRate}%
              </p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <p className="text-sm text-slate-500">数据阶段</p>
              <span className={`mt-3 inline-block rounded-full border px-3 py-1 text-sm font-medium ${phaseMeta?.cls}`}>
                {phaseMeta?.label}
              </span>
            </div>
          </section>

          {/* 题目列表 */}
          <section className="rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">今日任务题目</h2>
              {data.record?.templateTitle && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{data.record.templateTitle}</span>
              )}
            </div>

            {!data.record ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400">
                {data.taskDate}
                {" "}暂无厅管日常任务记录。请确认当日是否有生效中的任务被分配至本厅。
              </div>
            ) : data.record.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400">
                模板暂无题目。
              </div>
            ) : (
              <div className="space-y-3">
                {data.record.items.map((item) => (
                  <TaskItemCard key={item.taskItemId} item={item} />
                ))}
              </div>
            )}

            {data.record?.submittedAt && (
              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                本日任务已于 {data.record.submittedAt.slice(0, 16).replace("T", " ")} 提交完成。
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
