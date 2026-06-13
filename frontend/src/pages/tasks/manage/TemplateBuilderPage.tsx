import { useEffect, useMemo, useState } from "react";
import {
  AlignLeft, CheckSquare, Circle, Copy,
  ExternalLink, Eye, FileImage, GripVertical, Plus, PowerOff, Trash2, X
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { Identity, OrgUnit, TaskAssignment, TaskCategory, TaskItem, TaskItemType, TaskTemplate } from "../../../types";
import { assignmentApi, templateApi } from "../../../services/task";
import { fetchOrgTree } from "../../../services/organization";
import { isLearningLinkValid, normalizeLearningLink } from "../../../shared/utils/learningLink";
import { useIdentityStore } from "../../../stores/identityStore";



const itemTypeOptions: { value: TaskItemType; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: "QA", label: "问答", icon: <AlignLeft size={14} />, desc: "填写说明、结果或备注" },
  { value: "FILL_BLANK", label: "待办", icon: <CheckSquare size={14} />, desc: "下级勾选确认即可" },
  { value: "SINGLE_CHOICE", label: "单选", icon: <Circle size={14} />, desc: "从选项中选一" },
  { value: "MULTI_CHOICE", label: "多选", icon: <CheckSquare size={14} />, desc: "从选项中选多个" },
  { value: "LINK", label: "学习链接", icon: <ExternalLink size={14} />, desc: "跳转学习后确认" },
  { value: "ATTACHMENT", label: "图片上传", icon: <FileImage size={14} />, desc: "提交图片附件" },
];

type DraftItem = {
  id: string;
  sortOrder: number;
  itemType: TaskItemType;
  title: string;
  isRequired: boolean;
  linkUrl?: string;
  options: { sortOrder: number; label: string }[];
};

function genId() { return Math.random().toString(36).slice(2, 10); }

function isOrgWithinScope(org: OrgUnit, scopePath?: string) {
  if (!scopePath) return true;
  return org.path === scopePath || org.path.startsWith(`${scopePath}/`);
}

function findBaseByOrgId(orgs: OrgUnit[], orgId?: string) {
  if (!orgId) return null;
  let current = orgs.find((org) => org.id === orgId) ?? null;
  while (current && current.orgType !== "BASE") {
    const parentId = current.parentId;
    current = parentId ? orgs.find((org) => org.id === parentId) ?? null : null;
  }
  return current;
}

function getAvailableBaseOrgs(orgs: OrgUnit[], identity?: Identity) {
  return orgs
    .filter((org) => org.status === "active" && org.orgType === "BASE" && isOrgWithinScope(org, identity?.scopePath))
    .sort((left, right) => left.path.localeCompare(right.path));
}

const templateCategoryMeta: Record<TaskCategory, {
  route: string;
  pageTitle: string;
  pageDesc: string;
  switchTitle: string;
  switchDesc: string;
  createLabel: string;
  emptyText: string;
  fixedTypeLabel: string;
  fixedTypeDesc: string;
}> = {
  DAILY: {
    route: "/tasks/templates/daily",
    pageTitle: "日常任务库",
    pageDesc: "统一管理基地的日常任务草稿、待生效任务、生效中任务与历史结束任务。",
    switchTitle: "日常任务（融通版）",
    switchDesc: "面向基地融通版日常协同，适合长期复用的标准化任务。",
    createLabel: "新建日常模板",
    emptyText: "当前还没有日常任务模板，点击右上角新建即可开始维护。",
    fixedTypeLabel: "日常任务（融通版）",
    fixedTypeDesc: "当前模板库只维护融通版日常任务模板；模板内容始终按草稿维护，真正投放以任务发放为准。",
  },
  TEMPORARY: {
    route: "/tasks/templates/temporary",
    pageTitle: "临时任务模板库",
    pageDesc: "按个人鉴权场景维护模板；这里沉淀的是临时协同与专项通知的标准模板。",
    switchTitle: "临时任务（个人鉴权）",
    switchDesc: "面向个人鉴权的临时协同任务，适合专项通知、活动安排和临时收口。",
    createLabel: "新建临时模板",
    emptyText: "当前还没有临时任务模板，点击右上角新建即可开始维护。",
    fixedTypeLabel: "临时任务（个人鉴权）",
    fixedTypeDesc: "当前模板库只维护个人鉴权临时任务模板；模板内容始终按草稿维护，真正投放以任务发放为准。",
  },
};

function ItemEditor({ item, onChange, onDelete }: { item: DraftItem; onChange: (v: DraftItem) => void; onDelete: () => void }) {
  const isChoiceType = item.itemType === "SINGLE_CHOICE" || item.itemType === "MULTI_CHOICE";
  const hasEmptyOptions = isChoiceType && item.options.filter((o) => o.label.trim()).length === 0;
  const hasEmptyLinkUrl = item.itemType === "LINK" && !item.linkUrl?.trim();
  const hasInvalidLinkUrl = item.itemType === "LINK" && Boolean(item.linkUrl?.trim()) && !isLearningLinkValid(item.linkUrl);
  const hasError = !item.title.trim() || hasEmptyOptions || hasEmptyLinkUrl || hasInvalidLinkUrl;

  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${hasError ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex items-start gap-3">
        <GripVertical size={16} className="mt-0.5 shrink-0 text-slate-300 cursor-grab" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
              {itemTypeOptions.find((o) => o.value === item.itemType)?.label}
            </span>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input type="checkbox" checked={item.isRequired} onChange={(e) => onChange({ ...item, isRequired: e.target.checked })} className="rounded" />
              必填
            </label>
          </div>
          <input
            className={`w-full rounded-lg border bg-slate-50 px-3 py-2 text-sm focus:outline-none ${!item.title.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
            placeholder="输入题目标题..."
            value={item.title}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
          />
          {!item.title.trim() && <p className="text-xs text-red-500">标题不能为空</p>}
          {item.itemType === "LINK" && (
            <>
              <input
                className={`w-full rounded-lg border bg-slate-50 px-3 py-2 text-sm focus:outline-none ${hasEmptyLinkUrl || hasInvalidLinkUrl ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
                placeholder="学习链接 URL（支持填写 https://... 或 www.example.com）"
                value={item.linkUrl ?? ""}
                onChange={(e) => onChange({ ...item, linkUrl: e.target.value })}
              />
              {hasEmptyLinkUrl && <p className="text-xs text-red-500">请填写跳转 URL，否则主播无法打开学习链接</p>}
              {!hasEmptyLinkUrl && hasInvalidLinkUrl && <p className="text-xs text-red-500">链接格式无效，请填写完整网址；未写协议时系统会自动补全 https://</p>}

            </>
          )}
          {isChoiceType && (
            <div className="space-y-2">
              {item.options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-slate-400">{idx + 1}.</span>
                  <input
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder={`选项 ${idx + 1}`}
                    value={opt.label}
                    onChange={(e) => {
                      const opts = [...item.options];
                      opts[idx] = { ...opts[idx], label: e.target.value };
                      onChange({ ...item, options: opts });
                    }}
                  />
                  <button onClick={() => { const opts = item.options.filter((_, i) => i !== idx); onChange({ ...item, options: opts }); }}
                    className="shrink-0 text-slate-300 hover:text-red-400 transition"><X size={14} /></button>
                </div>
              ))}
              {hasEmptyOptions && <p className="text-xs text-red-500">至少需要一个选项，否则主播无法完成该题</p>}
              <button
                onClick={() => onChange({ ...item, options: [...item.options, { sortOrder: item.options.length, label: "" }] })}
                className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 transition"
              ><Plus size={12} />添加选项</button>
            </div>
          )}
        </div>
        <button onClick={onDelete} className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-400 transition"><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

export function TemplateBuilderPage({ category }: { category: TaskCategory }) {
  const [searchParams] = useSearchParams();
  const currentIdentity = useIdentityStore((s) => s.currentIdentity);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyAssignments, setDailyAssignments] = useState<TaskAssignment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [viewingTemplate, setViewingTemplate] = useState<TaskTemplate | null>(null);
  const [form, setForm] = useState({ title: "", description: "", category });
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedScopeOrgId, setSelectedScopeOrgId] = useState(searchParams.get("scopeOrgId") ?? "");

  const categoryMeta = templateCategoryMeta[category];
  const availableBaseOrgs = useMemo(() => getAvailableBaseOrgs(orgs, currentIdentity), [orgs, currentIdentity]);
  const selectedScopeOrg = useMemo(() => orgs.find((org) => org.id === selectedScopeOrgId) ?? null, [orgs, selectedScopeOrgId]);
  const requiresBaseSelection = category === "DAILY";
  const categoryTemplates = useMemo(
    () => templates.filter((template) => template.category === category),
    [category, templates],
  );
  const draftTemplates = useMemo(
    () => categoryTemplates.filter((template) => (template._count?.assignments ?? 0) === 0),
    [categoryTemplates],
  );
  const publishedTemplates = useMemo(
    () => categoryTemplates.filter((template) => (template._count?.assignments ?? 0) > 0),
    [categoryTemplates],
  );
  const scheduledAssignments = useMemo(
    () => dailyAssignments.filter((assignment) => assignment.status === "scheduled"),
    [dailyAssignments],
  );
  const activeAssignments = useMemo(
    () => dailyAssignments.filter((assignment) => assignment.status === "active"),
    [dailyAssignments],
  );
  const endedAssignments = useMemo(
    () => dailyAssignments.filter((assignment) => assignment.status === "ended" || assignment.status === "deleted"),
    [dailyAssignments],
  );

  const load = async () => {
    setLoading(true);
    const [orgTree, data, assignmentRows] = await Promise.all([
      fetchOrgTree().catch(() => [] as OrgUnit[]),
      category === "DAILY"
        ? selectedScopeOrgId
          ? templateApi.list({ category: "DAILY", orgId: selectedScopeOrgId, scopeOrgId: selectedScopeOrgId }).catch(() => [] as TaskTemplate[])
          : Promise.resolve([] as TaskTemplate[])
        : templateApi.list({ category: "TEMPORARY" }).catch(() => [] as TaskTemplate[]),
      category === "DAILY"
        ? selectedScopeOrgId
          ? assignmentApi.list({ scopeOrgId: selectedScopeOrgId, status: "scheduled,active,ended,deleted" }).catch(() => [] as TaskAssignment[])
          : Promise.resolve([] as TaskAssignment[])
        : Promise.resolve([] as TaskAssignment[]),
    ]);
    setOrgs(orgTree);
    setTemplates(data);
    setDailyAssignments(assignmentRows.filter((assignment) => assignment.category === "DAILY"));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [category, selectedScopeOrgId]);

  useEffect(() => {
    if (!editingId) {
      setForm((prev) => (prev.category === category ? prev : { ...prev, category }));
    }
  }, [category, editingId]);

  useEffect(() => {
    const validIds = new Set(availableBaseOrgs.map((org) => org.id));
    if (category !== "DAILY") {
      if (selectedScopeOrgId) setSelectedScopeOrgId("");
      return;
    }
    if (selectedScopeOrgId && validIds.has(selectedScopeOrgId)) return;
    const fallbackCandidates = [
      searchParams.get("scopeOrgId") ?? "",
      findBaseByOrgId(orgs, currentIdentity?.orgId)?.id ?? "",
      availableBaseOrgs.length === 1 ? availableBaseOrgs[0].id : "",
    ].filter((value): value is string => Boolean(value));
    const nextScopeOrgId = fallbackCandidates.find((value) => validIds.has(value)) ?? "";
    if (nextScopeOrgId !== selectedScopeOrgId) setSelectedScopeOrgId(nextScopeOrgId);
  }, [availableBaseOrgs, category, currentIdentity?.orgId, orgs, searchParams, selectedScopeOrgId]);

  function addItem(type: TaskItemType) {
    setDraftItems((prev) => [...prev, {
      id: genId(), sortOrder: prev.length, itemType: type,
      title: "", isRequired: true, options: [],
    }]);
  }

  async function handleSave() {
    if (!form.title.trim() || !currentIdentity?.orgId) return;
    if (draftItems.length === 0) {
      window.alert("请至少添加一个子任务");
      return;
    }
    const emptyTitle = draftItems.find((item) => !item.title.trim());
    if (emptyTitle) {
      window.alert("存在未填写标题的子任务，请补全后再保存");
      return;
    }
    const emptyLink = draftItems.find((item) => item.itemType === "LINK" && !item.linkUrl?.trim());
    if (emptyLink) {
      window.alert(`学习链接类型的子任务「${emptyLink.title || "未命名"}」需要填写跳转 URL`);
      return;
    }
    const invalidLink = draftItems.find((item) => item.itemType === "LINK" && item.linkUrl?.trim() && !isLearningLinkValid(item.linkUrl));
    if (invalidLink) {
      window.alert(`学习链接类型的子任务「${invalidLink.title || "未命名"}」链接格式无效，请填写完整网址`);
      return;
    }
    const emptyOptions = draftItems.find(
      (item) => (item.itemType === "SINGLE_CHOICE" || item.itemType === "MULTI_CHOICE")
        && item.options.filter((o) => o.label.trim()).length === 0,
    );
    if (emptyOptions) {
      window.alert(`单选/多选类型的子任务「${emptyOptions.title || "未命名"}」至少需要一个选项`);
      return;
    }
    setSaving(true);
    const items = draftItems.map((item, i) => ({
      sortOrder: i,
      itemType: item.itemType,
      title: item.title.trim(),
      isRequired: item.isRequired,
      linkUrl: item.itemType === "LINK" ? normalizeLearningLink(item.linkUrl) : undefined,
      options: item.options.filter((o) => o.label.trim()).map((o, oi) => ({ sortOrder: oi, label: o.label.trim() })),
    }));

    try {
      if (editingId) {
        await templateApi.update(editingId, { title: form.title, description: form.description, items }, category === "DAILY" ? { scopeOrgId: selectedScopeOrgId } : undefined);
      } else {
        const targetOrgId = category === "DAILY" ? selectedScopeOrgId : currentIdentity.orgId;
        if (!targetOrgId) {
          window.alert("请先选择基地后再维护日常模板");
          setSaving(false);
          return;
        }
        await templateApi.create({ ...form, category, orgId: targetOrgId, scopeOrgId: category === "DAILY" ? selectedScopeOrgId : undefined, items });
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "保存失败");
      setSaving(false);
      return;
    }
    setSaving(false);
    setShowNew(false);
    setEditingId(null);
    setDraftItems([]);
    setForm({ title: "", description: "", category });
    void load();
  }

  function openCreatePanel() {
    if (category === "DAILY" && !selectedScopeOrgId) {
      window.alert("请先选择基地后再新建日常模板");
      return;
    }
    setEditingId(null);
    setDraftItems([]);
    setForm({ title: "", description: "", category });
    setShowNew(true);
  }

  function openEdit(t: TaskTemplate) {
    setEditingId(t.id);
    setForm({ title: t.title, description: t.description ?? "", category: t.category });
    setDraftItems((t.items ?? []).map((item: TaskItem, i: number) => ({
      id: item.id, sortOrder: i, itemType: item.itemType, title: item.title,
      isRequired: item.isRequired, linkUrl: item.linkUrl ?? undefined,
      options: (item.options ?? []).map((o) => ({ sortOrder: o.sortOrder, label: o.label })),
    })));
    setShowNew(true);
  }

  async function handleDeleteTemplate(template: TaskTemplate) {
    const confirmed = window.confirm("确认删除这份草稿模板？未正式发放的关联草稿也会一并清理。");
    if (!confirmed) return;
    const result = await templateApi.delete(template.id, category === "DAILY" ? { scopeOrgId: selectedScopeOrgId } : undefined).catch((error) => {
      window.alert(error instanceof Error ? error.message : "删除模板失败");
      return null;
    });
    if (!result) return;
    void load();
  }

  async function handleCopyTemplate(template: TaskTemplate) {
    const result = await templateApi.copy(template.id, category === "DAILY" ? { scopeOrgId: selectedScopeOrgId } : undefined).catch((error) => {
      window.alert(error instanceof Error ? error.message : "复制模板失败");
      return null;
    });
    if (!result) return;
    window.alert(`已复制「${template.title}」为新的模板草稿，可继续编辑。`);
    void load();
  }

  async function handleViewTemplate(templateId: string) {
    const result = await templateApi.getById(templateId, category === "DAILY" ? { scopeOrgId: selectedScopeOrgId } : undefined).catch((error) => {
      window.alert(error instanceof Error ? error.message : "加载表单详情失败");
      return null;
    });
    if (!result) return;
    setViewingTemplate(result);
  }

  async function handleEndAssignment(assignment: TaskAssignment) {
    if (assignment.status !== "active" && assignment.status !== "scheduled") return;
    const confirmed = window.confirm(`确认结束任务「${assignment.template?.title ?? "未命名日常任务"}」吗？结束后将不再作为当前日常任务生效。`);
    if (!confirmed) return;
    const result = await assignmentApi.close(assignment.id, selectedScopeOrgId || undefined).catch((error) => {
      window.alert(error instanceof Error ? error.message : "结束任务失败");
      return null;
    });
    if (!result) return;
    void load();
  }

  const statusMeta: Record<string, { cls: string; text: string }> = {
    draft: { cls: "bg-yellow-50 text-yellow-600", text: "草稿" },
    published: { cls: "bg-emerald-50 text-emerald-600", text: "已发布" },
  };

  const assignmentStatusMeta: Record<string, { cls: string; text: string }> = {
    scheduled: { cls: "bg-cyan-50 text-cyan-600", text: "待生效" },
    active: { cls: "bg-emerald-50 text-emerald-600", text: "生效中" },
    ended: { cls: "bg-slate-100 text-slate-500", text: "已结束" },
    deleted: { cls: "bg-rose-50 text-rose-600", text: "已删除" },
  };

  return (
    <div className="space-y-6">
      {category === "DAILY" && (
        <section className="rounded-3xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">选择基地模板库</h2>
              <p className="mt-1 text-sm text-slate-500">日常模板属于基地资产。先切到基地，再查看该基地历史模板，并由多个基地管理共同维护。</p>
            </div>
            <div className="min-w-[280px]">
              <label className="text-xs font-medium text-slate-500">当前管理基地</label>
              <select
                value={selectedScopeOrgId}
                onChange={(event) => setSelectedScopeOrgId(event.target.value)}
                disabled={availableBaseOrgs.length <= 1 && Boolean(selectedScopeOrgId)}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{availableBaseOrgs.length ? "请选择基地" : "当前身份下暂无可管理基地"}</option>
                {availableBaseOrgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}（{org.orgCode}）
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={`mt-4 rounded-2xl px-4 py-3 text-sm ${selectedScopeOrg ? "border border-blue-100 bg-blue-50 text-blue-700" : "border border-amber-100 bg-amber-50 text-amber-700"}`}>
            {selectedScopeOrg
              ? `当前已切换到“${selectedScopeOrg.name}”基地模板库，下面展示的是该基地的历史日常模板。`
              : "请先选择基地，再查看并维护该基地的日常模板。"}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{categoryMeta.pageTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">{categoryMeta.pageDesc}</p>
        </div>
        <button
          onClick={openCreatePanel}
          disabled={requiresBaseSelection && !selectedScopeOrgId}
          className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-blue-100 transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={15} />{categoryMeta.createLabel}
        </button>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        {category === "DAILY"
          ? <>当前页面已升级为独立的 <span className="font-medium">日常任务库</span>；同一页面内统一查看 <span className="font-medium">草稿</span>、<span className="font-medium">待生效</span>、<span className="font-medium">生效中</span>、<span className="font-medium">已结束</span> 四类日常任务资产，其中草稿仅展示从未发布过的任务。</>
          : <>当前页面已是独立的 <span className="font-medium">{categoryMeta.fixedTypeLabel}</span> 模板库；左侧菜单负责切换“日常任务”和“临时任务”。模板会按使用情况分成两类：<span className="font-medium">草稿</span> 表示从未被发放使用，<span className="font-medium">已发布</span> 表示至少被正式发放过一次。</>}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">加载中...</div>
      ) : requiresBaseSelection && !selectedScopeOrgId ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-amber-200 bg-amber-50 py-16 text-amber-700">
          <p className="text-sm">请先选择基地，再查看该基地的日常模板库。</p>
        </div>
      ) : category === "DAILY" ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-900">草稿</h2>
              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">{draftTemplates.length}</span>
              <p className="text-sm text-slate-500">未发布过的模板，适合继续打磨内容后再正式发放。</p>
            </div>
            {draftTemplates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-400">暂无未发布模板。</div>
            ) : (
              <div className="space-y-3">
                {draftTemplates.map((t) => {
                  const sm = statusMeta[t.status] ?? statusMeta.draft;
                  return (
                    <div key={t.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                      <div className="flex items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sm.cls}`}>{sm.text}</span>
                            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">草稿</span>
                            <span className="text-xs text-slate-400">v{t.version}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">日常任务</span>
                          </div>
                          <p className="font-semibold text-slate-900">{t.title}</p>
                          {t.description && <p className="mt-1 truncate text-sm text-slate-500">{t.description}</p>}
                          <p className="mt-1 text-xs text-slate-400">{(t.items?.length ?? 0)} 个子任务 · 尚未正式发放</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => void handleViewTemplate(t.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"><Eye size={12} />表单详情</button>
                          <button onClick={() => openEdit(t)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50">编辑草稿</button>
                          <button onClick={() => void handleDeleteTemplate(t)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50">删除草稿</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {[
            { key: "scheduled", title: "待生效", desc: "已确认发放，等待次日 00:00 自动接管。", rows: scheduledAssignments },
            { key: "active", title: "生效中", desc: "当前正在执行的日常任务。", rows: activeAssignments },
            { key: "ended", title: "已结束", desc: "已结束或已删除的历史日常任务。", rows: endedAssignments },
          ].map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{group.title}</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{group.rows.length}</span>
                <p className="text-sm text-slate-500">{group.desc}</p>
              </div>
              {group.rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-400">当前没有{group.title}任务。</div>
              ) : (
                <div className="space-y-3">
                  {group.rows.map((assignment) => {
                    const sm = assignmentStatusMeta[assignment.status] ?? assignmentStatusMeta.ended;
                    return (
                      <div key={assignment.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                        <div className="flex items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sm.cls}`}>{sm.text}</span>
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">{assignment.effectMode === "immediate" ? "立即生效" : "次日凌晨生效"}</span>
                              <span className="text-xs text-slate-400">v{assignment.templateVersion ?? assignment.template?.version ?? 1}</span>
                            </div>
                            <p className="font-semibold text-slate-900">{assignment.template?.title ?? "未命名日常任务"}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                              <span>正式发放：{assignment.publishedAt ? new Date(assignment.publishedAt).toLocaleString("zh-CN") : "未记录"}</span>
                              <span>生效时间：{assignment.effectiveAt ? new Date(assignment.effectiveAt).toLocaleString("zh-CN") : "未记录"}</span>
                              <span>已提交记录：{assignment._count?.records ?? 0} 条</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => void handleViewTemplate(assignment.templateId ?? assignment.template?.id ?? "")} disabled={!(assignment.templateId ?? assignment.template?.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"><Eye size={12} />表单详情</button>
                            {(assignment.status === "active" || assignment.status === "scheduled") && <button type="button" onClick={() => void handleEndAssignment(assignment)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"><PowerOff size={12} />{assignment.status === "scheduled" ? "取消待生效" : "结束任务"}</button>}
                            {assignment.status !== "active" && assignment.status !== "scheduled" && <button type="button" onClick={() => void handleCopyTemplate({ ...(assignment.template as TaskTemplate), id: assignment.templateId ?? assignment.template?.id ?? "" })} disabled={!(assignment.templateId ?? assignment.template?.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"><Copy size={12} />复制为草稿</button>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : categoryTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-slate-400">
          <p className="text-sm">{categoryMeta.emptyText}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {[
            {
              key: "draft",
              title: "草稿",
              desc: "未发布过的模板，适合继续打磨内容后再正式发放。",
              items: draftTemplates,
              badgeCls: "bg-yellow-100 text-yellow-700",
            },
            {
              key: "published",
              title: "已发布",
              desc: "至少被正式发放使用过一次的模板，适合复用历史成熟方案。",
              items: publishedTemplates,
              badgeCls: "bg-emerald-100 text-emerald-700",
            },
          ].map((group) => (
            <section key={group.key} className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">{group.title}</h2>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${group.badgeCls}`}>{group.items.length}</span>
                <p className="text-sm text-slate-500">{group.desc}</p>
              </div>

              {group.items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-400">
                  暂无{group.title === "草稿" ? "未发布模板" : "已发布模板"}。
                </div>
              ) : (
                <div className="space-y-3">
                  {group.items.map((t) => {
                    const sm = ((t._count?.assignments ?? 0) > 0 ? statusMeta.published : statusMeta[t.status]) ?? statusMeta.draft;
                    return (
                      <div key={t.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
                        <div className="flex items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sm.cls}`}>{sm.text}</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${group.badgeCls}`}>{group.title}</span>
                              <span className="text-xs text-slate-400">v{t.version}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{categoryMeta.fixedTypeLabel}</span>
                            </div>
                            <p className="font-semibold text-slate-900">{t.title}</p>
                            {t.description && <p className="mt-1 truncate text-sm text-slate-500">{t.description}</p>}
                            <p className="mt-1 text-xs text-slate-400">{(t.items?.length ?? 0)} 个子任务 · 已用于任务发放 {t._count?.assignments ?? 0} 次</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <>
                              <button onClick={() => openEdit(t)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50">编辑</button>
                              <button onClick={() => void handleCopyTemplate(t)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                                <Copy size={12} />复制
                              </button>
                              <button onClick={() => void handleDeleteTemplate(t)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50">删除</button>
                            </>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {viewingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">表单详情</h3>
                <p className="mt-1 text-xs text-slate-400">查看当前日常任务表单的标题、说明与子任务结构</p>
              </div>
              <button type="button" onClick={() => setViewingTemplate(null)} className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"><X size={18} /></button>
            </div>
            <div className="max-h-[calc(85vh-72px)] overflow-y-auto px-6 py-5">
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <h4 className="text-base font-semibold text-slate-900">{viewingTemplate.title}</h4>
                {viewingTemplate.description && <p className="mt-2 text-sm text-slate-500">{viewingTemplate.description}</p>}
                <p className="mt-2 text-xs text-slate-400">版本 v{viewingTemplate.version} · 共 {(viewingTemplate.items?.length ?? 0)} 个子任务</p>
              </div>
              <div className="mt-4 space-y-3">
                {(viewingTemplate.items ?? []).map((item, index) => (
                  <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{index + 1}. {item.title}</p>
                        <p className="mt-1 text-xs text-slate-400">{item.isRequired ? "必做项" : "选做项"} · {item.itemType}</p>
                      </div>
                    </div>
                    {item.linkUrl && <p className="mt-2 text-xs text-slate-500">学习链接：{item.linkUrl}</p>}
                    {item.options?.length ? <p className="mt-2 text-xs text-slate-500">选项：{item.options.map((option) => option.label).join("、")}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20 backdrop-blur-sm" onClick={() => setShowNew(false)} />
          <div className="flex w-[560px] flex-col overflow-hidden bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-900">{editingId ? "编辑模板" : categoryMeta.createLabel}</h3>
              <button onClick={() => setShowNew(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">模板标题 *</label>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder="输入模板标题..."
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">模板类型</label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">{categoryMeta.fixedTypeLabel}</div>
                    <p className="mt-2 text-xs leading-6 text-slate-500">{categoryMeta.fixedTypeDesc}</p>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">说明</label>
                  <textarea
                    className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none"
                    rows={2}
                    placeholder="任务说明（可选）..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold text-slate-800">子任务（{draftItems.length}项）</p>
                </div>
                <div className="space-y-3">
                  {draftItems.map((item) => (
                    <ItemEditor
                      key={item.id}
                      item={item}
                      onChange={(v) => setDraftItems((prev) => prev.map((i) => i.id === item.id ? v : i))}
                      onDelete={() => setDraftItems((prev) => prev.filter((i) => i.id !== item.id))}
                    />
                  ))}
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-slate-500">添加题型</p>
                  <div className="grid grid-cols-3 gap-2">
                    {itemTypeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => addItem(opt.value)}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        {opt.icon}<span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-slate-100 p-4">
              <button
                onClick={handleSave}
                disabled={!form.title.trim() || saving}
                className="w-full rounded-xl bg-blue-500 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-40"
              >{saving ? "保存中..." : "保存草稿"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

