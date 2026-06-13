import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Pencil,
  ChevronUp,
  GitBranch,
  Plus,
  Route,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { MiniDatePicker, MiniTimePicker } from "../../../shared/components/date-time/MiniDateTimePickers";
import {
  workflowTaskApi,
  type WorkflowAssigneeOption,
  type WorkflowBootstrapPayload,
  type WorkflowCreateInput,
  type WorkflowTaskQuestion,
  type WorkflowTaskQuestionType,
} from "../../../services/workflowTask";
import { BroadcastAnchorPage } from "./BroadcastAnchorPage";

/* ─────────────────────────────── constants ─────────────────────────────── */

const modeCards = [
  {
    key: "workflow",
    title: "流转模式",
    description: "类似审批流。A 完成后再到 B，按顺序逐步流转直至结束。",
    icon: Route,
    enabled: true,
  },
  {
    key: "collaboration",
    title: "协同模式",
    description: "多人共享一个任务共同完成，按账号维度触达，同一账号多个身份只记一次。",
    icon: Users,
    enabled: false,
  },
  {
    key: "broadcast",
    title: "群发主播",
    description: "向本厅主播批量发任务，可全选或单选。仅厅管账号可用。",
    icon: Send,
    enabled: true,
  },
] as const;

const questionTypeOptions: Array<{ value: WorkflowTaskQuestionType; label: string; desc: string }> = [
  { value: "QA", label: "问答", desc: "填写文字说明或结果" },
  { value: "FILL_BLANK", label: "待办", desc: "勾选完成确认" },
  { value: "SINGLE_CHOICE", label: "单选", desc: "从选项中选一个" },
  { value: "MULTI_CHOICE", label: "多选", desc: "可选多个选项" },
  { value: "LINK", label: "链接确认", desc: "打开链接并确认" },
  { value: "ATTACHMENT", label: "附件上传", desc: "上传图片或文件" },
];

/* ─────────────────────────────── types ─────────────────────────────── */

type QuestionDraft = WorkflowTaskQuestion & { id: string };

type StepDraft = {
  title: string;
  assigneeUserId: string;
  assigneeKeyword: string;
  selectedAssignee?: WorkflowAssigneeOption | null;
  searchResults: WorkflowAssigneeOption[];
  searching: boolean;
  questions: QuestionDraft[];
  /** 节点卡片是否展开（题目区域） */
  expanded: boolean;
};

/* ─────────────────────────────── helpers ─────────────────────────────── */

function createEmptyQuestion(): QuestionDraft {
  return {
    id: Math.random().toString(36).slice(2),
    title: "",
    itemType: "QA",
    isRequired: true,
    options: [],
    linkUrl: "",
  };
}

function createEmptyStep(index: number): StepDraft {
  return {
    title: `节点${index}`,
    assigneeUserId: "",
    assigneeKeyword: "",
    selectedAssignee: null,
    searchResults: [],
    searching: false,
    questions: [createEmptyQuestion()],
    expanded: index === 1, // 只有第一个节点默认展开
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

function getAssigneeCategoryLabel(item: WorkflowAssigneeOption) {
  if (item.primaryCategory === "subordinate_anchor") return "主播";
  return "管理";
}
function getAssigneeBadgeClass(item: WorkflowAssigneeOption) {
  if (item.primaryCategory === "subordinate_anchor") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (item.primaryCategory === "peer_manager") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}
function getAssigneeGroupLabel(category: WorkflowAssigneeOption["primaryCategory"]) {
  if (category === "subordinate_anchor") return "名下主播";
  if (category === "peer_manager") return "同级管理";
  return "名下管理";
}

function getStepCompletion(step: StepDraft) {
  const hasTitle = Boolean(step.title.trim());
  const hasAssignee = Boolean(step.assigneeUserId);
  const totalQuestions = step.questions.length;
  const completeQuestions = step.questions.filter((q) => {
    if (!q.title.trim()) return false;
    if (q.itemType === "SINGLE_CHOICE" || q.itemType === "MULTI_CHOICE") {
      return (q.options ?? []).filter((o) => o.trim()).length >= 2;
    }
    if (q.itemType === "LINK") {
      return Boolean(q.linkUrl?.trim());
    }
    return true;
  }).length;
  const isComplete = hasTitle && hasAssignee && totalQuestions > 0 && totalQuestions === completeQuestions;
  return { hasTitle, hasAssignee, totalQuestions, completeQuestions, isComplete };
}

/* ─────────────────────────────── sub-components ─────────────────────────────── */

/** 右侧任务缩略预览卡 */
function TaskPreviewPanel({
  title,
  dueAt,
  steps,
  orgName,
  allNodesConfigured,
  submitting,
  onSubmit,
  error,
  successMessage,
}: {
  title: string;
  dueAt: string;
  steps: StepDraft[];
  orgName?: string | null;
  allNodesConfigured: boolean;
  submitting: boolean;
  onSubmit: () => void;
  error: string;
  successMessage: string;
}) {
  const hasTitle = Boolean(title.trim());
  const dueDateStr = dueAt ? dueAt.replace("T", " ").slice(0, 16) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* 预览卡 */}
      <div className="rounded-[24px] border border-white/70 bg-white/90 p-6 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-500 uppercase tracking-wide">
          <GitBranch size={15} />
          任务预览
        </div>

        {/* 标题 */}
        <div className={`text-base font-bold leading-6 ${hasTitle ? "text-slate-900" : "text-slate-300"}`}>
          {hasTitle ? title : "请填写任务标题…"}
        </div>

        {/* 截止时间 */}
        {dueDateStr && (
          <div className="mt-1.5 text-xs font-medium text-slate-500">截止 {dueDateStr}</div>
        )}

        {/* 目标组织 */}
        {orgName && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-feishu-pale px-3 py-1 text-xs font-bold text-feishu-blue">
            {orgName}
          </div>
        )}

        {/* 节点列表 */}
        {steps.length > 0 && (
          <div className="mt-4 space-y-2.5">
            {steps.map((step, index) => {
              const summary = getStepCompletion(step);
              return (
                <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${summary.isComplete ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}>
                        {index + 1}
                      </span>
                      <span className="text-sm font-bold text-slate-800 truncate max-w-[100px]">
                        {step.title || `节点${index + 1}`}
                      </span>
                    </div>
                    {step.selectedAssignee ? (
                      <span className="shrink-0 text-xs font-medium text-slate-600 truncate max-w-[90px]">
                        {step.selectedAssignee.nickname}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-amber-500">待选人</span>
                    )}
                  </div>
                  {step.questions.length > 0 && (
                    <div className="mt-2 space-y-1 pl-8">
                      {step.questions.slice(0, 3).map((q, qi) => (
                        <div key={qi} className="flex items-center gap-1.5 min-w-0">
                          <span className="rounded-full bg-feishu-pale px-2 py-0.5 text-[11px] font-bold text-feishu-blue shrink-0">
                            {questionTypeOptions.find((o) => o.value === q.itemType)?.label ?? q.itemType}
                          </span>
                          <span className="truncate text-xs text-slate-500">
                            {q.title || <span className="text-slate-300">待填写题目</span>}
                          </span>
                        </div>
                      ))}
                      {step.questions.length > 3 && (
                        <div className="text-xs text-slate-400">…共 {step.questions.length} 题</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 错误 / 成功提示 */}
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 flex items-start gap-2">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          {successMessage}
        </div>
      )}

      {/* 发布按钮 */}
      <button
        type="button"
        disabled={submitting || !allNodesConfigured || !hasTitle}
        onClick={onSubmit}
        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-feishu-blue px-5 py-4 text-base font-bold text-white shadow-[0_14px_30px_rgba(76,114,255,0.35)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <GitBranch size={17} />
        {submitting ? "创建中…" : "发布流转任务"}
      </button>

      {!allNodesConfigured && !submitting && (
        <p className="text-center text-[11px] text-slate-400">请完成所有节点配置后发布</p>
      )}
    </div>
  );
}

/* ─────────────────────────────── main page ─────────────────────────────── */

export function WorkflowTaskPage() {
  const [bootstrap, setBootstrap] = useState<WorkflowBootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [formError, setFormError] = useState("");

  const [selectedMode, setSelectedMode] = useState<"selector" | "workflow" | "broadcast">("selector");
  /** 当前步骤：1=基础信息，2=节点配置 */
  const [workflowStep, setWorkflowStep] = useState<1 | 2>(1);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([createEmptyStep(1), createEmptyStep(2)]);

  /* ── load ── */
  async function loadBootstrap() {
    setLoading(true);
    setPageError("");
    try {
      const data = await workflowTaskApi.bootstrap();
      setBootstrap(data);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "协同任务初始化失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadBootstrap(); }, []);

  /* ── derived ── */
  const allStepSummaries = useMemo(() => steps.map(getStepCompletion), [steps]);
  const allNodesConfigured = allStepSummaries.length > 0 && allStepSummaries.every((s) => s.isComplete);

  /* ── step helpers ── */
  function updateStep(
    index: number,
    key: keyof StepDraft,
    value: string | WorkflowAssigneeOption[] | WorkflowAssigneeOption | QuestionDraft[] | boolean | null,
  ) {
    setSteps((cur) => cur.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }

  function updateQuestion(stepIndex: number, questionId: string, patch: Partial<QuestionDraft>) {
    setSteps((cur) =>
      cur.map((step, i) =>
        i !== stepIndex
          ? step
          : { ...step, questions: step.questions.map((q) => (q.id === questionId ? { ...q, ...patch } : q)) },
      ),
    );
  }

  function addQuestion(stepIndex: number) {
    setSteps((cur) =>
      cur.map((step, i) => (i !== stepIndex ? step : { ...step, questions: [...step.questions, createEmptyQuestion()] })),
    );
  }

  function removeQuestion(stepIndex: number, questionId: string) {
    setSteps((cur) =>
      cur.map((step, i) => {
        if (i !== stepIndex || step.questions.length <= 1) return step;
        return { ...step, questions: step.questions.filter((q) => q.id !== questionId) };
      }),
    );
  }

  async function handleAssigneeKeywordChange(index: number, keyword: string) {
    updateStep(index, "assigneeKeyword", keyword);
    updateStep(index, "assigneeUserId", "");
    updateStep(index, "selectedAssignee", null);

    const digitsOnly = keyword.replace(/\D/g, "");
    const isPhoneSearch = /^\d+$/.test(keyword.trim());
    const enough =
      keyword.trim() &&
      ((isPhoneSearch && digitsOnly.length >= 5) || (!isPhoneSearch && keyword.trim().length >= 2));
    if (!enough) {
      updateStep(index, "searchResults", []);
      updateStep(index, "searching", false);
      return;
    }

    updateStep(index, "searching", true);
    try {
      const rows = await workflowTaskApi.searchAssignees(keyword.trim());
      setSteps((cur) =>
        cur.map((item, i) => (i === index ? { ...item, searchResults: rows, searching: false } : item)),
      );
    } catch {
      setSteps((cur) =>
        cur.map((item, i) => (i === index ? { ...item, searchResults: [], searching: false } : item)),
      );
    }
  }

  function addStep() {
    setSteps((cur) => [...cur, createEmptyStep(cur.length + 1)]);
  }

  function removeStep(index: number) {
    setSteps((cur) => {
      if (cur.length <= 1) return cur;
      return cur.filter((_, i) => i !== index);
    });
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setDueAt("");
    setSteps([createEmptyStep(1), createEmptyStep(2)]);
    setWorkflowStep(1);
  }

  /* ── submit ── */
  async function handleSubmit() {
    if (!bootstrap) return;
    setFormError("");
    setSuccessMessage("");

    const payload: WorkflowCreateInput = {
      title: title.trim(),
      description: description.trim(),
      dueAt: dueAt || undefined,
      steps: steps.map((item, index) => ({
        title: item.title.trim() || `节点${index + 1}`,
        requirement: item.questions.map((q) => q.title.trim()).filter(Boolean).join("；"),
        assigneeUserId: item.assigneeUserId,
        questions: item.questions.map((q) => ({
          title: q.title.trim(),
          itemType: q.itemType,
          isRequired: q.isRequired,
          options: (q.options ?? []).map((o) => o.trim()).filter(Boolean),
          ...(q.itemType === "LINK" ? { linkUrl: q.linkUrl?.trim() ?? "" } : {}),
        })),
      })),
    };

    if (!payload.title) { setFormError("请填写任务标题"); setWorkflowStep(1); return; }
    if (payload.steps.some((s) => !s.assigneeUserId)) { setFormError("请为每个节点选择执行账号"); return; }
    if (payload.steps.some((s) => s.questions.length === 0 || s.questions.some((q) => !q.title))) {
      setFormError("请完整填写每个节点题目内容");
      return;
    }
    if (payload.steps.some((s) => s.questions.some((q) => ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(q.itemType) && (q.options?.length ?? 0) < 2))) {
      setFormError("单选题和多选题至少需要两个选项");
      return;
    }
    if (payload.steps.some((s) => s.questions.some((q) => q.itemType === "LINK" && !q.linkUrl?.trim()))) {
      setFormError("链接确认题型需要填写链接地址");
      return;
    }

    setSubmitting(true);
    try {
      await workflowTaskApi.create(payload);
      setSuccessMessage(`流转任务已创建，归属：${bootstrap.operator.orgName ?? "当前权限范围"}`);
      resetForm();
      await loadBootstrap();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建流转任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  /* ── render ── */
  return (
    <div className="space-y-5">
      {loading ? (
        <div className="rounded-[24px] bg-white/90 p-10 text-center text-sm text-slate-400 shadow-sm">
          加载中…
        </div>
      ) : pageError && !bootstrap ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 flex items-center gap-2">
          <AlertCircle size={16} />{pageError}
        </div>
      ) : selectedMode === "selector" ? (

        /* ════════════════ 模式选择 ════════════════ */
        <section className="grid gap-4 lg:grid-cols-3">
          {modeCards.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                disabled={!item.enabled}
                onClick={() => {
                  if (!item.enabled) return;
                  if (item.key === "broadcast") setSelectedMode("broadcast");
                  else setSelectedMode("workflow");
                }}
                className={`rounded-[24px] border p-6 text-left shadow-sm transition ${
                  item.enabled
                    ? "border-white/70 bg-white/90 hover:-translate-y-0.5 hover:border-feishu-blue/30 hover:shadow-md"
                    : "cursor-not-allowed border-slate-200 bg-slate-50/80 opacity-60"
                }`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-feishu-pale text-feishu-blue">
                  <Icon size={20} />
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">{item.title}</h2>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${item.enabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                    {item.enabled ? "可用" : "待开发"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
              </button>
            );
          })}
        </section>

      ) : selectedMode === "broadcast" ? (

        /* ════════════════ 群发主播 ════════════════ */
        <BroadcastAnchorPage onBack={() => setSelectedMode("selector")} />

      ) : (

        /* ════════════════ 流转模式：发布界面 ════════════════ */
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">

          {/* ── 中间主内容 ── */}
          <div className="rounded-[24px] border border-white/70 bg-white/90 p-6 shadow-sm backdrop-blur-xl">

            {/* ── 顶部横向导航条 ── */}
            {(() => {
              const step1Valid = Boolean(title.trim()) && Boolean(dueAt);
              return (
                <div className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-2.5">
                  {/* 返回 */}
                  <button
                    type="button"
                    onClick={() => setSelectedMode("selector")}
                    className="shrink-0 rounded-xl border-2 border-slate-300 px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:border-feishu-blue hover:text-feishu-blue transition"
                  >
                    返回
                  </button>

                  {/* 模式标签 */}
                  <div className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-feishu-blue">
                    <GitBranch size={15} />
                    流转模式
                  </div>

                  {/* 分隔 */}
                  <div className="h-5 w-px bg-slate-300 shrink-0" />

                  {/* 步骤 tabs */}
                  <div className="flex items-center gap-2">
                    {([
                      { id: 1 as const, label: "基础信息" },
                      { id: 2 as const, label: "节点配置" },
                    ]).map((tab, idx) => {
                      const active = workflowStep === tab.id;
                      const done = workflowStep > tab.id;
                      const disabled = tab.id === 2 && !step1Valid;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => !disabled && setWorkflowStep(tab.id)}
                          title={disabled ? "请先填写任务标题和截止时间" : undefined}
                          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold transition ${
                            disabled
                              ? "cursor-not-allowed text-slate-400"
                              : active
                                ? "bg-feishu-blue text-white shadow-sm"
                                : "text-slate-600 hover:bg-white hover:text-feishu-blue"
                          }`}
                        >
                          {done
                            ? <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                            : <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-white/25" : disabled ? "bg-slate-200 text-slate-400" : "bg-slate-200 text-slate-600"}`}>{tab.id}</span>
                          }
                          {tab.label}
                          {idx === 0 && <span className="mx-0.5 text-slate-400">›</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* 右侧：目标组织 */}
                  <div className="ml-auto shrink-0 rounded-full bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500">
                    目标：<span className="font-bold text-slate-800">{bootstrap?.operator.orgName ?? "—"}</span>
                  </div>
                </div>
              );
            })()}

            {/* ======== 步骤 1：基础信息 ======== */}
            {workflowStep === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">步骤 1 · 基础信息</h2>
                  <p className="mt-1 text-xs text-slate-400">填写任务标题、说明和截止时间。</p>
                </div>

                {/* 标题 */}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-slate-700">任务标题 <span className="text-rose-400">*</span></span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                    placeholder="例如：基地月度资料补全流转"
                  />
                </label>

                {/* 说明 */}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-slate-700">任务说明</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[110px] resize-none rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                    placeholder="填写流转背景、注意事项、验收说明等"
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

                {/* 步骤1校验提示 */}
                {!title.trim() && (
                  <p className="text-xs text-rose-500 flex items-center gap-1">
                    <AlertCircle size={12} className="shrink-0" />
                    请先填写任务标题，才能进入节点配置
                  </p>
                )}
                {title.trim() && !dueAt && (
                  <p className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertCircle size={12} className="shrink-0" />
                    请设置截止时间，才能进入节点配置
                  </p>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!title.trim() || !dueAt}
                    onClick={() => setWorkflowStep(2)}
                    className="rounded-2xl bg-feishu-blue px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(76,114,255,0.25)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一步：配置节点
                  </button>
                </div>
              </div>
            )}

            {/* ======== 步骤 2：节点配置（执行人 + 题目融合） ======== */}
            {workflowStep === 2 && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">步骤 2 · 节点配置</h2>
                    <p className="mt-1 text-xs text-slate-400">为每个节点选择执行人，并配置该节点需要完成的题目。</p>
                  </div>
                  <button
                    type="button"
                    onClick={addStep}
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-feishu-blue px-4 py-2.5 text-sm font-bold text-white shadow-[0_6px_16px_rgba(76,114,255,0.25)] transition hover:opacity-90"
                  >
                    <Plus size={16} />新增节点
                  </button>
                </div>

                <div className="space-y-4">
                  {steps.map((step, stepIndex) => {
                    const summary = allStepSummaries[stepIndex];
                    return (
                      <StepCard
                        key={stepIndex}
                        step={step}
                        stepIndex={stepIndex}
                        total={steps.length}
                        summary={summary}
                        onUpdateStep={updateStep}
                        onUpdateQuestion={updateQuestion}
                        onAddQuestion={addQuestion}
                        onRemoveQuestion={removeQuestion}
                        onRemoveStep={removeStep}
                        onAssigneeKeywordChange={handleAssigneeKeywordChange}
                        onToggleExpand={(i) => updateStep(i, "expanded", !step.expanded)}
                      />
                    );
                  })}
                </div>

                <div className="flex justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setWorkflowStep(1)}
                    className="rounded-2xl border-2 border-slate-300 px-6 py-3 text-base font-semibold text-slate-700 transition hover:border-feishu-blue hover:text-feishu-blue"
                  >
                    返回基础配置
                  </button>
                </div>
              </div>
            )}

            {formError && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                <AlertCircle size={14} className="shrink-0" />{formError}
              </div>
            )}
          </div>

          {/* ── 右侧预览 + 发布 ── */}
          <div className="self-start">
            <TaskPreviewPanel
              title={title}
              dueAt={dueAt}
              steps={steps}
              orgName={bootstrap?.operator.orgName}
              allNodesConfigured={allNodesConfigured}
              submitting={submitting}
              onSubmit={() => void handleSubmit()}
              error={formError}
              successMessage={successMessage}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────────── StepCard ─────────────────────────────── */

function StepCard({
  step,
  stepIndex,
  total,
  summary,
  onUpdateStep,
  onUpdateQuestion,
  onAddQuestion,
  onRemoveQuestion,
  onRemoveStep,
  onAssigneeKeywordChange,
  onToggleExpand,
}: {
  step: StepDraft;
  stepIndex: number;
  total: number;
  summary: ReturnType<typeof getStepCompletion>;
  onUpdateStep: (index: number, key: keyof StepDraft, value: string | WorkflowAssigneeOption[] | WorkflowAssigneeOption | QuestionDraft[] | boolean | null) => void;
  onUpdateQuestion: (stepIndex: number, questionId: string, patch: Partial<QuestionDraft>) => void;
  onAddQuestion: (stepIndex: number) => void;
  onRemoveQuestion: (stepIndex: number, questionId: string) => void;
  onRemoveStep: (index: number) => void;
  onAssigneeKeywordChange: (index: number, keyword: string) => Promise<void>;
  onToggleExpand: (index: number) => void;
}) {
  // 每个节点循环使用不同主题色（边框/背景/圆圈/输入框等）
  const STEP_THEMES = [
    {
      border:      "border-emerald-300",
      borderSlate: "border-slate-300",
      headerBg:    "bg-emerald-50",
      badgeBg:     "bg-emerald-500",
      badgeBgDim:  "bg-emerald-300",
      badgeText:   "text-emerald-800",
      inputBorder: "border-emerald-300",
      inputFocus:  "focus:border-emerald-500 focus:ring-emerald-300/40",
      pencil:      "text-emerald-500",
      divider:     "bg-emerald-200",
      assigneeBorder: "border-emerald-200",
      searchBorder:   "border-emerald-200",
      searchFocus:    "focus:border-emerald-400 focus:ring-emerald-200/50",
      countText:   "text-emerald-700",
      chevronBorder:  "border-emerald-200",
      chevronText:    "text-emerald-600",
    },
    {
      border:      "border-violet-300",
      borderSlate: "border-slate-300",
      headerBg:    "bg-violet-50",
      badgeBg:     "bg-violet-500",
      badgeBgDim:  "bg-violet-300",
      badgeText:   "text-violet-800",
      inputBorder: "border-violet-300",
      inputFocus:  "focus:border-violet-500 focus:ring-violet-300/40",
      pencil:      "text-violet-500",
      divider:     "bg-violet-200",
      assigneeBorder: "border-violet-200",
      searchBorder:   "border-violet-200",
      searchFocus:    "focus:border-violet-400 focus:ring-violet-200/50",
      countText:   "text-violet-700",
      chevronBorder:  "border-violet-200",
      chevronText:    "text-violet-600",
    },
    {
      border:      "border-amber-300",
      borderSlate: "border-slate-300",
      headerBg:    "bg-amber-50",
      badgeBg:     "bg-amber-500",
      badgeBgDim:  "bg-amber-300",
      badgeText:   "text-amber-800",
      inputBorder: "border-amber-300",
      inputFocus:  "focus:border-amber-500 focus:ring-amber-300/40",
      pencil:      "text-amber-500",
      divider:     "bg-amber-200",
      assigneeBorder: "border-amber-200",
      searchBorder:   "border-amber-200",
      searchFocus:    "focus:border-amber-400 focus:ring-amber-200/50",
      countText:   "text-amber-700",
      chevronBorder:  "border-amber-200",
      chevronText:    "text-amber-600",
    },
    {
      border:      "border-sky-300",
      borderSlate: "border-slate-300",
      headerBg:    "bg-sky-50",
      badgeBg:     "bg-sky-500",
      badgeBgDim:  "bg-sky-300",
      badgeText:   "text-sky-800",
      inputBorder: "border-sky-300",
      inputFocus:  "focus:border-sky-500 focus:ring-sky-300/40",
      pencil:      "text-sky-500",
      divider:     "bg-sky-200",
      assigneeBorder: "border-sky-200",
      searchBorder:   "border-sky-200",
      searchFocus:    "focus:border-sky-400 focus:ring-sky-200/50",
      countText:   "text-sky-700",
      chevronBorder:  "border-sky-200",
      chevronText:    "text-sky-600",
    },
    {
      border:      "border-rose-300",
      borderSlate: "border-slate-300",
      headerBg:    "bg-rose-50",
      badgeBg:     "bg-rose-500",
      badgeBgDim:  "bg-rose-300",
      badgeText:   "text-rose-800",
      inputBorder: "border-rose-300",
      inputFocus:  "focus:border-rose-500 focus:ring-rose-300/40",
      pencil:      "text-rose-500",
      divider:     "bg-rose-200",
      assigneeBorder: "border-rose-200",
      searchBorder:   "border-rose-200",
      searchFocus:    "focus:border-rose-400 focus:ring-rose-200/50",
      countText:   "text-rose-700",
      chevronBorder:  "border-rose-200",
      chevronText:    "text-rose-600",
    },
  ] as const;
  const theme = STEP_THEMES[stepIndex % STEP_THEMES.length];

  return (
    <div className={`rounded-[20px] border-2 transition ${summary.isComplete ? theme.border : theme.borderSlate}`}>

      {/* ── 节点头部：内联编辑名称 + 执行人 ── */}
      <div className={`rounded-t-[18px] px-4 py-3.5 ${summary.isComplete ? theme.headerBg : "bg-slate-50"}`}>
        <div className="flex items-center gap-3">
          {/* 序号圆圈 */}
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${summary.isComplete ? `${theme.badgeBg} text-white` : `${theme.badgeBgDim} ${theme.badgeText}`}`}>
            {stepIndex + 1}
          </span>

          {/* 节点名称：inline 直接编辑 */}
          <div className="relative shrink-0 w-36 group">
            <input
              value={step.title}
              onChange={(e) => onUpdateStep(stepIndex, "title", e.target.value)}
              className={`w-full rounded-lg border-2 ${theme.inputBorder} bg-white py-1.5 pl-3 pr-7 text-sm font-bold text-slate-800 shadow-sm outline-none transition ${theme.inputFocus}`}
              placeholder="节点名称"
            />
            <Pencil
              size={12}
              className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 ${theme.pencil} opacity-70 group-focus-within:opacity-100 transition`}
            />
          </div>

          {/* 分隔 */}
          <div className={`h-4 w-px ${theme.divider} shrink-0`} />

          {/* 执行人区域 */}
          <div className="relative flex min-w-0 flex-1 items-center gap-2">
            {step.selectedAssignee ? (
              /* 已选：展示 pill + 清除 */
              <>
                <div className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border ${theme.assigneeBorder} bg-white px-3 py-1.5`}>
                  <span className="truncate text-sm font-medium text-slate-900">{step.selectedAssignee.nickname}</span>
                  <span className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getAssigneeBadgeClass(step.selectedAssignee)}`}>
                    {getAssigneeCategoryLabel(step.selectedAssignee)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateStep(stepIndex, "assigneeUserId", "");
                    onUpdateStep(stepIndex, "assigneeKeyword", "");
                    onUpdateStep(stepIndex, "selectedAssignee", null);
                    onUpdateStep(stepIndex, "searchResults", []);
                  }}
                  className="shrink-0 text-[11px] font-medium text-rose-400 hover:text-rose-600 transition"
                >
                  清除
                </button>
              </>
            ) : (
              /* 未选：搜索框 */
              <div className="relative flex-1">
                <input
                  value={step.assigneeKeyword}
                  onChange={(e) => { void onAssigneeKeywordChange(stepIndex, e.target.value); }}
                  className={`w-full rounded-lg border ${theme.searchBorder} bg-white/80 px-3 py-1.5 text-sm outline-none transition focus:bg-white focus:ring-2 ${theme.searchFocus}`}
                  placeholder="搜索执行人（昵称 / 手机号 / 抖音号）"
                />
                {step.searching && (
                  <div className="absolute left-0 top-full mt-1 text-xs text-slate-400">搜索中…</div>
                )}
                {!step.searching && step.searchResults.length > 0 && (
                  <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-80 min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    {(["subordinate_anchor", "subordinate_manager", "peer_manager"] as const).map((group) => {
                      const groupItems = step.searchResults.filter((item) => item.primaryCategory === group);
                      if (!groupItems.length) return null;
                      return (
                        <div key={group} className="border-b border-slate-100 last:border-b-0">
                          <div className="sticky top-0 bg-slate-50/95 px-3 py-1.5 text-[11px] font-semibold text-slate-400 backdrop-blur">
                            {getAssigneeGroupLabel(group)}
                          </div>
                          {groupItems.map((item) => (
                            <div key={item.userId} className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5 first:border-t-0 hover:bg-slate-50">
                              <div className="min-w-0 truncate text-sm text-slate-700">
                                <span className="font-medium text-slate-900">{item.nickname}</span>
                                <span className="ml-1.5 text-slate-400">{item.phone}</span>
                                {item.anchorDouyinNo && <span className="ml-1.5 text-slate-400">{item.anchorDouyinNo}</span>}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getAssigneeBadgeClass(item)}`}>
                                  {getAssigneeCategoryLabel(item)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const kw = `${item.nickname} ${item.phone}${item.anchorDouyinNo ? ` ${item.anchorDouyinNo}` : ""}`.trim();
                                    onUpdateStep(stepIndex, "assigneeUserId", item.userId);
                                    onUpdateStep(stepIndex, "assigneeKeyword", kw);
                                    onUpdateStep(stepIndex, "selectedAssignee", item);
                                    onUpdateStep(stepIndex, "searchResults", []);
                                  }}
                                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-feishu-blue hover:text-feishu-blue transition"
                                >
                                  选择
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右侧操作 */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* 题目进度 */}
            <span className={`text-xs font-semibold ${theme.countText}`}>
              {summary.completeQuestions}/{summary.totalQuestions} 题
            </span>
            {total > 1 && (
              <button
                type="button"
                onClick={() => onRemoveStep(stepIndex)}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-rose-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                删除
              </button>
            )}
            <button
              type="button"
              onClick={() => onToggleExpand(stepIndex)}
              className={`rounded-lg border ${theme.chevronBorder} bg-white/60 p-1.5 ${theme.chevronText} transition hover:bg-white`}
            >
              {step.expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── 展开区域：只有题目 ── */}
      {step.expanded && (
        <div className="px-5 pb-5 pt-4 space-y-3">
          {/* 分割线 */}
          <div className="flex items-center gap-2 -mx-1">
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-xs font-semibold text-slate-500">节点题目</span>
            <div className="flex-1 border-t border-slate-200" />
          </div>

          {/* 题目列表 */}
          <div className="space-y-3">
            {step.questions.map((question, questionIndex) => (
              <div key={question.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                {/* 单行：类型下拉 + 题目内容输入 + 必填开关 + 删除 */}
                <div className="flex items-center gap-2">
                  {/* 序号 */}
                  <span className="shrink-0 text-xs font-bold text-slate-400 w-5 text-center">{questionIndex + 1}</span>

                  {/* 类型下拉 */}
                  <select
                    value={question.itemType}
                    onChange={(e) => {
                      const val = e.target.value as WorkflowTaskQuestionType;
                      onUpdateQuestion(stepIndex, question.id, {
                        itemType: val,
                        options: ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(val) ? ["", ""] : [],
                        linkUrl: "",
                      });
                    }}
                    className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-feishu-blue w-20"
                  >
                    {questionTypeOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>

                  {/* 题目内容 */}
                  <input
                    value={question.title}
                    onChange={(e) => onUpdateQuestion(stepIndex, question.id, { title: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                    placeholder="输入题目内容…"
                  />

                  {/* 必填开关 */}
                  <button
                    type="button"
                    onClick={() => onUpdateQuestion(stepIndex, question.id, { isRequired: !question.isRequired })}
                    className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                      question.isRequired
                        ? "bg-feishu-blue/10 text-feishu-blue"
                        : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                    }`}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full transition ${question.isRequired ? "bg-feishu-blue" : "bg-slate-300"}`} />
                    必填
                  </button>

                  {/* 删除 */}
                  {step.questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveQuestion(stepIndex, question.id)}
                      className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-400 transition"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {/* LINK 题型：链接 URL 输入 */}
                {question.itemType === "LINK" && (
                  <div className="mt-2.5 grid gap-1">
                    <span className="text-[11px] text-slate-400">链接地址 <span className="text-rose-400">*</span></span>
                    <input
                      value={question.linkUrl ?? ""}
                      onChange={(e) => onUpdateQuestion(stepIndex, question.id, { linkUrl: e.target.value })}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                      placeholder="https://example.com/学习材料"
                      type="url"
                    />
                    {question.linkUrl && !/^https?:\/\/.+/.test(question.linkUrl.trim()) && (
                      <span className="text-[11px] text-amber-500">请输入以 http:// 或 https:// 开头的有效链接</span>
                    )}
                  </div>
                )}

                {/* 选项配置 */}
                {(question.itemType === "SINGLE_CHOICE" || question.itemType === "MULTI_CHOICE") && (
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11px] font-medium text-slate-500">选项配置</span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuestion(stepIndex, question.id, { options: [...(question.options ?? []), ""] })}
                        className="text-[11px] font-medium text-feishu-blue hover:opacity-75 transition"
                      >
                        + 添加选项
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(question.options ?? []).map((option, optionIndex) => (
                        <div key={`${question.id}-${optionIndex}`} className="flex items-center gap-1.5">
                          <input
                            value={option}
                            onChange={(e) => {
                              const next = [...(question.options ?? [])];
                              next[optionIndex] = e.target.value;
                              onUpdateQuestion(stepIndex, question.id, { options: next });
                            }}
                            className="flex-1 min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-feishu-blue focus:ring-2 focus:ring-feishu-blue/10"
                            placeholder={`选项 ${optionIndex + 1}`}
                          />
                          {(question.options ?? []).length > 2 && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateQuestion(stepIndex, question.id, {
                                  options: (question.options ?? []).filter((_, idx) => idx !== optionIndex),
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
          </div>

          {/* 新增题目按钮 */}
          <button
            type="button"
            onClick={() => onAddQuestion(stepIndex)}
            className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 transition hover:border-feishu-blue hover:text-feishu-blue"
          >
            <Plus size={13} className="inline mr-1" />新增题目
          </button>
        </div>
      )}
    </div>
  );
}
