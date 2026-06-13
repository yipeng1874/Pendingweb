import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Megaphone,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { MiniDatePicker, MiniTimePicker } from "../../../shared/components/date-time/MiniDateTimePickers";
import {
  broadcastTaskApi,
  type BroadcastAnchorOption,
  type BroadcastBootstrapPayload,
  type BroadcastQuestion,
  type BroadcastQuestionType,
} from "../../../services/broadcastTask";

/* ─────────────────────────────── constants ─────────────────────────────── */

const QUESTION_TYPE_OPTIONS: Array<{ value: BroadcastQuestionType; label: string }> = [
  { value: "QA", label: "问答" },
  { value: "FILL_BLANK", label: "待办" },
  { value: "SINGLE_CHOICE", label: "单选" },
  { value: "MULTI_CHOICE", label: "多选" },
  { value: "LINK", label: "链接确认" },
  { value: "ATTACHMENT", label: "附件上传" },
];

/* ─────────────────────────────── types ─────────────────────────────── */

type QuestionDraft = BroadcastQuestion & { _id: string };

function mkQuestion(): QuestionDraft {
  return {
    _id: Math.random().toString(36).slice(2),
    title: "",
    itemType: "QA",
    isRequired: true,
    options: [],
    linkUrl: "",
  };
}

function toLocalDateInputValue(value?: string) {
  return value ? value.slice(0, 10) : "";
}
function toLocalTimeInputValue(value?: string) {
  return value ? value.slice(11, 16) : "";
}
function mergeDateTime(date: string, time: string) {
  if (!date) return "";
  return `${date}T${time || "23:59"}`;
}

/* ─────────────────────────────── AnchorList ─────────────────────────────── */

function AnchorList({
  anchors,
  selected,
  onChange,
}: {
  anchors: BroadcastAnchorOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const allSelected = anchors.length > 0 && anchors.every((a) => selected.has(a.userId));
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return anchors;
    return anchors.filter(
      (a) =>
        a.nickname.toLowerCase().includes(kw) ||
        a.phone.includes(kw) ||
        (a.douyinNo ?? "").toLowerCase().includes(kw) ||
        (a.anchorNickname ?? "").toLowerCase().includes(kw),
    );
  }, [anchors, search]);

  function toggleAll() {
    if (allSelected) {
      // 取消全选（只影响 anchors 里的，保留 filtered 之外的）
      const next = new Set(selected);
      anchors.forEach((a) => next.delete(a.userId));
      onChange(next);
    } else {
      const next = new Set(selected);
      anchors.forEach((a) => next.add(a.userId));
      onChange(next);
    }
  }

  function toggle(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部：搜索 + 全选 */}
      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-2xl border border-slate-200 px-4 py-2 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
          placeholder="搜索主播昵称、手机号、抖音号…"
        />
        <button
          type="button"
          onClick={toggleAll}
          className={`shrink-0 rounded-2xl border-2 px-4 py-2 text-sm font-semibold transition ${
            allSelected
              ? "border-feishu-blue bg-feishu-pale text-feishu-blue"
              : "border-slate-200 bg-white text-slate-600 hover:border-feishu-blue/50"
          }`}
        >
          {allSelected ? "取消全选" : "全选"}
        </button>
      </div>

      {/* 已选计数 */}
      {selected.size > 0 && (
        <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={13} />
          已选 {selected.size} 位主播
        </div>
      )}

      {/* 主播列表 */}
      {anchors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          本厅下暂无 active 主播身份
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
          未找到匹配的主播
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {filtered.map((anchor) => {
            const checked = selected.has(anchor.userId);
            return (
              <label
                key={anchor.userId}
                className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition ${
                  checked ? "bg-feishu-pale/60" : "hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-feishu-blue"
                  checked={checked}
                  onChange={() => toggle(anchor.userId)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 text-sm truncate">{anchor.nickname}</span>
                    {anchor.anchorNickname && anchor.anchorNickname !== anchor.nickname && (
                      <span className="text-xs text-slate-400 truncate">（{anchor.anchorNickname}）</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                    <span>{anchor.phone}</span>
                    {anchor.douyinNo && <span>抖音：{anchor.douyinNo}</span>}
                  </div>
                </div>
                {checked && <CheckCircle2 size={15} className="shrink-0 text-feishu-blue" />}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── QuestionEditor ─────────────────────────── */

function QuestionEditor({
  questions,
  onChange,
}: {
  questions: QuestionDraft[];
  onChange: (next: QuestionDraft[]) => void;
}) {
  function updateQ(id: string, patch: Partial<QuestionDraft>) {
    onChange(questions.map((q) => (q._id === id ? { ...q, ...patch } : q)));
  }
  function removeQ(id: string) {
    if (questions.length <= 1) return;
    onChange(questions.filter((q) => q._id !== id));
  }
  function addQ() {
    onChange([...questions, mkQuestion()]);
  }

  return (
    <div className="flex flex-col gap-3">
      {questions.map((q, idx) => (
        <div key={q._id} className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3.5">
          <div className="flex items-center gap-2">
            {/* 序号 */}
            <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-400">{idx + 1}</span>

            {/* 类型 */}
            <select
              value={q.itemType}
              onChange={(e) => {
                const v = e.target.value as BroadcastQuestionType;
                updateQ(q._id, {
                  itemType: v,
                  options: ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(v) ? ["", ""] : [],
                  linkUrl: "",
                });
              }}
              className="shrink-0 w-24 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-feishu-blue"
            >
              {QUESTION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {/* 标题 */}
            <input
              value={q.title}
              onChange={(e) => updateQ(q._id, { title: e.target.value })}
              className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
              placeholder="输入题目内容…"
            />

            {/* 必填切换 */}
            <button
              type="button"
              onClick={() => updateQ(q._id, { isRequired: !q.isRequired })}
              className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                q.isRequired
                  ? "bg-feishu-blue/10 text-feishu-blue"
                  : "bg-slate-100 text-slate-400 hover:bg-slate-200"
              }`}
            >
              <span className={`h-3 w-3 rounded-full transition ${q.isRequired ? "bg-feishu-blue" : "bg-slate-300"}`} />
              必填
            </button>

            {/* 删除 */}
            {questions.length > 1 && (
              <button
                type="button"
                onClick={() => removeQ(q._id)}
                className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-400 transition"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          {/* 链接 URL */}
          {q.itemType === "LINK" && (
            <div className="mt-2.5 grid gap-1 pl-7">
              <span className="text-[11px] text-slate-400">链接地址 <span className="text-rose-400">*</span></span>
              <input
                value={q.linkUrl ?? ""}
                onChange={(e) => updateQ(q._id, { linkUrl: e.target.value })}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                placeholder="https://example.com"
                type="url"
              />
              {q.linkUrl && !/^https?:\/\/.+/.test(q.linkUrl.trim()) && (
                <span className="text-[11px] text-amber-500">请输入以 http:// 或 https:// 开头的链接</span>
              )}
            </div>
          )}

          {/* 选项配置 */}
          {(q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") && (
            <div className="mt-2.5 pl-7">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-500">选项配置</span>
                <button
                  type="button"
                  onClick={() => updateQ(q._id, { options: [...(q.options ?? []), ""] })}
                  className="text-[11px] font-medium text-feishu-blue hover:opacity-75 transition"
                >
                  + 添加选项
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(q.options ?? []).map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-1.5">
                    <input
                      value={opt}
                      onChange={(e) => {
                        const next = [...(q.options ?? [])];
                        next[oi] = e.target.value;
                        updateQ(q._id, { options: next });
                      }}
                      className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-feishu-blue"
                      placeholder={`选项 ${oi + 1}`}
                    />
                    {(q.options ?? []).length > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          updateQ(q._id, {
                            options: (q.options ?? []).filter((_, i) => i !== oi),
                          })
                        }
                        className="shrink-0 rounded-lg border border-slate-200 px-2 py-2 text-xs text-rose-400 hover:border-rose-200 hover:bg-rose-50 transition"
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addQ}
        className="rounded-2xl border border-dashed border-slate-300 py-2.5 text-xs font-medium text-slate-500 transition hover:border-feishu-blue hover:text-feishu-blue"
      >
        <Plus size={13} className="inline mr-1" />新增题目
      </button>
    </div>
  );
}

/* ─────────────────────────────── PreviewPanel ─────────────────────────────── */

function PreviewPanel({
  title,
  dueAt,
  selectedCount,
  totalCount,
  questionCount,
  hallOrgName,
  submitting,
  canSubmit,
  onSubmit,
  error,
  success,
}: {
  title: string;
  dueAt: string;
  selectedCount: number;
  totalCount: number;
  questionCount: number;
  hallOrgName: string | null;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  error: string;
  success: string;
}) {
  const dueDateStr = dueAt ? dueAt.replace("T", " ").slice(0, 16) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[24px] border border-white/70 bg-white/90 p-6 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-500 uppercase tracking-wide">
          <Megaphone size={15} />
          发布预览
        </div>

        <div className={`text-base font-bold leading-6 ${title ? "text-slate-900" : "text-slate-300"}`}>
          {title || "请填写任务标题…"}
        </div>

        {dueDateStr && (
          <div className="mt-1.5 text-xs font-medium text-slate-500">截止 {dueDateStr}</div>
        )}

        {hallOrgName && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-feishu-pale px-3 py-1 text-xs font-bold text-feishu-blue">
            {hallOrgName}
          </div>
        )}

        <div className="mt-4 space-y-2">
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${selectedCount > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-400"}`}>
            <Users size={13} />
            已选主播：{selectedCount} / {totalCount} 人
          </div>
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${questionCount > 0 ? "bg-blue-50 text-blue-700" : "bg-slate-50 text-slate-400"}`}>
            <CheckCircle2 size={13} />
            题目数量：{questionCount} 题
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 flex items-start gap-2">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          {success}
        </div>
      )}

      <button
        type="button"
        disabled={submitting || !canSubmit}
        onClick={onSubmit}
        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-feishu-blue px-5 py-4 text-base font-bold text-white shadow-[0_14px_30px_rgba(76,114,255,0.35)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send size={17} />
        {submitting ? "发布中…" : "发布群发任务"}
      </button>

      {!canSubmit && !submitting && (
        <p className="text-center text-[11px] text-slate-400">请完整填写标题、选择主播并配置题目后发布</p>
      )}
    </div>
  );
}

/* ─────────────────────────────── main ─────────────────────────────── */

export function BroadcastAnchorPage({ onBack }: { onBack: () => void }) {
  const [bootstrap, setBootstrap] = useState<BroadcastBootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [selectedAnchorIds, setSelectedAnchorIds] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<QuestionDraft[]>([mkQuestion()]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // 折叠区块
  const [anchorExpanded, setAnchorExpanded] = useState(true);
  const [questionExpanded, setQuestionExpanded] = useState(true);

  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void (async () => {
      setLoading(true);
      setPageError("");
      try {
        const data = await broadcastTaskApi.bootstrap();
        setBootstrap(data);
      } catch (err) {
        setPageError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const canSubmit =
    Boolean(title.trim()) &&
    selectedAnchorIds.size > 0 &&
    questions.length > 0 &&
    questions.every((q) => {
      if (!q.title.trim()) return false;
      if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") {
        return (q.options ?? []).filter((o) => o.trim()).length >= 2;
      }
      if (q.itemType === "LINK") return Boolean(q.linkUrl?.trim());
      return true;
    });

  async function handleSubmit() {
    setFormError("");
    setSuccessMsg("");
    if (!title.trim()) { setFormError("请填写任务标题"); return; }
    if (selectedAnchorIds.size === 0) { setFormError("请至少选择一位主播"); return; }
    if (questions.length === 0) { setFormError("请至少配置一道题目"); return; }
    for (const q of questions) {
      if (!q.title.trim()) { setFormError("请完整填写每道题目的标题"); return; }
      if ((q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") && (q.options ?? []).filter((o) => o.trim()).length < 2) {
        setFormError("单选/多选题至少需要两个选项"); return;
      }
      if (q.itemType === "LINK" && !q.linkUrl?.trim()) { setFormError("链接确认题型需要填写链接地址"); return; }
    }

    setSubmitting(true);
    try {
      const result = await broadcastTaskApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueAt || undefined,
        selectedAnchorUserIds: Array.from(selectedAnchorIds),
        questions: questions.map((q) => ({
          title: q.title.trim(),
          itemType: q.itemType,
          isRequired: q.isRequired,
          options: ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(q.itemType)
            ? (q.options ?? []).map((o) => o.trim()).filter(Boolean)
            : [],
          linkUrl: q.itemType === "LINK" ? (q.linkUrl?.trim() ?? "") : undefined,
        })),
      });
      setSuccessMsg(`群发任务已发布，共发放给 ${result.anchorRecords.length} 位主播`);
      // 重置表单
      setTitle("");
      setDescription("");
      setDueAt("");
      setSelectedAnchorIds(new Set());
      setQuestions([mkQuestion()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "发布失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  /* ── render ── */
  return (
    <div className="space-y-5">
      {/* 顶部页头 */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/70 bg-white/90 px-6 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-2xl border-2 border-slate-200 text-slate-500 transition hover:border-feishu-blue hover:text-feishu-blue"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-feishu-pale text-feishu-blue">
            <Megaphone size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">群发主播</h1>
            <p className="text-xs text-slate-400">向本厅主播批量发布任务</p>
          </div>
        </div>
        {bootstrap?.allowed && bootstrap.operator.orgName && (
          <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {bootstrap.operator.orgName}
          </div>
        )}
      </section>

      {loading ? (
        <div className="rounded-[24px] bg-white/90 p-10 text-center text-sm text-slate-400 shadow-sm">加载中…</div>
      ) : pageError ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 flex items-center gap-2">
          <AlertCircle size={16} />{pageError}
        </div>
      ) : !bootstrap?.allowed ? (
        /* ── 非厅管提示 ── */
        <section className="rounded-[24px] border border-amber-200 bg-amber-50/80 p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
              <Info size={22} />
            </div>
            <div>
              <h2 className="text-base font-bold text-amber-800">当前权限不适用群发主播</h2>
              <p className="mt-2 text-sm leading-6 text-amber-700">
                {bootstrap?.redirectHint ?? "群发主播功能仅厅管账号可使用。"}
              </p>
              <button
                type="button"
                onClick={onBack}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl border-2 border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 transition hover:border-amber-400 hover:bg-amber-50"
              >
                <ArrowLeft size={15} />
                返回任务选择
              </button>
            </div>
          </div>
        </section>
      ) : (
        /* ── 主内容：三栏布局 ── */
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">

          {/* ── 左栏：基础信息 ── */}
          <div className="rounded-[24px] border border-white/70 bg-white/90 p-6 shadow-sm backdrop-blur-xl space-y-5 self-start">
            <div>
              <h2 className="text-base font-semibold text-slate-900">基础信息</h2>
              <p className="mt-1 text-xs text-slate-400">填写任务标题、说明和截止时间。</p>
            </div>

            {/* 标题 */}
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">任务标题 <span className="text-rose-400">*</span></span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                placeholder="例如：本周日播任务完成情况确认"
              />
            </label>

            {/* 说明 */}
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-slate-700">任务说明</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[90px] resize-none rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                placeholder="填写任务背景、注意事项等（可选）"
              />
            </label>

            {/* 截止时间 */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">截止时间</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">北京时间 UTC+8</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">截止日期</label>
                  <MiniDatePicker
                    value={toLocalDateInputValue(dueAt)}
                    onChange={(val) => setDueAt(mergeDateTime(val, toLocalTimeInputValue(dueAt) || "23:59"))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">截止时间</label>
                  <MiniTimePicker
                    value={toLocalTimeInputValue(dueAt)}
                    onChange={(val) => setDueAt(mergeDateTime(toLocalDateInputValue(dueAt), val))}
                  />
                </div>
              </div>
            </div>

            {/* 题目配置区块 */}
            <div>
              <button
                type="button"
                onClick={() => setQuestionExpanded((v) => !v)}
                className="flex w-full items-center justify-between gap-2 py-1"
              >
                <h2 className="text-base font-semibold text-slate-900">
                  题目配置
                  <span className="ml-2 text-sm font-normal text-slate-400">（{questions.length} 题）</span>
                </h2>
                {questionExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>
              {questionExpanded && (
                <div className="mt-3">
                  <QuestionEditor questions={questions} onChange={setQuestions} />
                </div>
              )}
            </div>
          </div>

          {/* ── 中栏：主播选择 ── */}
          <div className="rounded-[24px] border border-white/70 bg-white/90 p-6 shadow-sm backdrop-blur-xl self-start">
            <button
              type="button"
              onClick={() => setAnchorExpanded((v) => !v)}
              className="flex w-full items-center justify-between gap-2 mb-4"
            >
              <div>
                <h2 className="text-base font-semibold text-slate-900 text-left">
                  选择主播
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    （共 {bootstrap.anchors.length} 人）
                  </span>
                </h2>
                <p className="text-xs text-slate-400 text-left mt-0.5">仅展示本厅下 active 主播身份</p>
              </div>
              {anchorExpanded ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
            </button>

            {anchorExpanded && (
              <AnchorList
                anchors={bootstrap.anchors}
                selected={selectedAnchorIds}
                onChange={setSelectedAnchorIds}
              />
            )}
          </div>

          {/* ── 右栏：预览 + 发布 ── */}
          <div className="self-start">
            <PreviewPanel
              title={title}
              dueAt={dueAt}
              selectedCount={selectedAnchorIds.size}
              totalCount={bootstrap.anchors.length}
              questionCount={questions.length}
              hallOrgName={bootstrap.operator.orgName}
              submitting={submitting}
              canSubmit={canSubmit}
              onSubmit={() => void handleSubmit()}
              error={formError}
              success={successMsg}
            />
          </div>
        </section>
      )}
    </div>
  );
}
