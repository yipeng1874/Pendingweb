import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlignLeft, CheckSquare, Circle, ExternalLink, FileImage, GripVertical, Plus, Trash2, X } from "lucide-react";
import type { TaskItemType, TaskTemplate } from "../../../../types";
import { templateApi } from "../../../../services/task";
import { isLearningLinkValid, normalizeLearningLink } from "../../../../shared/utils/learningLink";


type TaskCategory = "DAILY" | "TEMPORARY";

type DraftItem = {
  id: string;
  sortOrder: number;
  itemType: TaskItemType;
  title: string;
  isRequired: boolean;
  linkUrl?: string;
  options: { sortOrder: number; label: string }[];
};

type Props = {
  open: boolean;
  category: TaskCategory;
  currentOrgId: string;
  scopeOrgId?: string;
  template?: TaskTemplate | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (template: TaskTemplate) => void | Promise<void>;
  onSavedAndNext?: (template: TaskTemplate) => void | Promise<void>;
};

const itemTypeOptions: { value: TaskItemType; label: string; icon: ReactNode; desc: string }[] = [
  { value: "QA", label: "问答", icon: <AlignLeft size={14} />, desc: "填写执行说明、结果或备注" },
  { value: "FILL_BLANK", label: "待办确认", icon: <CheckSquare size={14} />, desc: "主播勾选确认即可" },
  { value: "SINGLE_CHOICE", label: "单选", icon: <Circle size={14} />, desc: "从选项中选择一个答案" },
  { value: "MULTI_CHOICE", label: "多选", icon: <CheckSquare size={14} />, desc: "从选项中选择多个答案" },
  { value: "LINK", label: "学习链接", icon: <ExternalLink size={14} />, desc: "跳转学习资料后确认完成" },
  { value: "ATTACHMENT", label: "图片上传", icon: <FileImage size={14} />, desc: "上传现场截图或结果图片" },
];

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function ItemEditor({ item, readOnly = false, onChange, onDelete }: { item: DraftItem; readOnly?: boolean; onChange: (value: DraftItem) => void; onDelete: () => void }) {
  const itemMeta = itemTypeOptions.find((option) => option.value === item.itemType);
  const isChoiceType = item.itemType === "SINGLE_CHOICE" || item.itemType === "MULTI_CHOICE";
  const hasEmptyOptions = isChoiceType && item.options.filter((o) => o.label.trim()).length === 0;
  const hasEmptyLinkUrl = item.itemType === "LINK" && !item.linkUrl?.trim();
  const hasInvalidLinkUrl = item.itemType === "LINK" && Boolean(item.linkUrl?.trim()) && !isLearningLinkValid(item.linkUrl);
  const hasError = !item.title.trim() || hasEmptyOptions || hasEmptyLinkUrl || hasInvalidLinkUrl;

  return (
    <div className={`rounded-3xl border bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)] ${hasError ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex items-start gap-3">
        <GripVertical size={16} className="mt-1 shrink-0 text-slate-300" />
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">{itemMeta?.label}</span>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={item.isRequired}
                onChange={(event) => onChange({ ...item, isRequired: event.target.checked })}
                disabled={readOnly}
                className="rounded"
              />
              必填
            </label>
          </div>
          <input
            className={`w-full rounded-2xl border bg-slate-50 px-3 py-2.5 text-sm focus:outline-none ${!item.title.trim() ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
            placeholder="例如：完成今日直播前设备自检并截图上传"
            value={item.title}
            onChange={(event) => onChange({ ...item, title: event.target.value })}
          />
          {!item.title.trim() && <p className="text-xs text-red-500">标题不能为空</p>}
          {item.itemType === "LINK" && (
            <>
              <input
                className={`w-full rounded-2xl border bg-slate-50 px-3 py-2.5 text-sm focus:outline-none ${hasEmptyLinkUrl || hasInvalidLinkUrl ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"}`}
                placeholder="例如：https://company.example.com/live-playbook 或 www.example.com/playbook"
                value={item.linkUrl ?? ""}
                onChange={(event) => onChange({ ...item, linkUrl: event.target.value })}
              />
              {hasEmptyLinkUrl && <p className="text-xs text-red-500">请填写跳转 URL，否则主播无法打开学习链接</p>}
              {!hasEmptyLinkUrl && hasInvalidLinkUrl && <p className="text-xs text-red-500">链接格式无效，请填写完整网址；未写协议时系统会自动补全 https://</p>}

            </>
          )}
          {isChoiceType && (
            <div className="space-y-2">
              {item.options.map((option, index) => (
                <div key={`${item.id}-${index}`} className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-slate-400">{index + 1}.</span>
                  <input
                    className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder={`例如：${index === 0 ? "已完成" : "待补充"}`}
                    value={option.label}
                    onChange={(event) => {
                      const nextOptions = [...item.options];
                      nextOptions[index] = { ...nextOptions[index], label: event.target.value };
                      onChange({ ...item, options: nextOptions });
                    }}
                  />
                  <button type="button" onClick={() => onChange({ ...item, options: item.options.filter((_, optionIndex) => optionIndex !== index) })} className="rounded-xl p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ))}
              {hasEmptyOptions && <p className="text-xs text-red-500">至少需要一个选项，否则主播无法完成该题</p>}
              <button
                type="button"
                onClick={() => onChange({ ...item, options: [...item.options, { sortOrder: item.options.length, label: "" }] })}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
              >
                <Plus size={12} />添加选项
              </button>
            </div>
          )}
        </div>
        <button type="button" onClick={onDelete} className="rounded-2xl p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

export function TaskTemplateDrawer({ open, category, currentOrgId, scopeOrgId, template, readOnly = false, onClose, onSaved, onSavedAndNext }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);

  const resolvedTemplateOrgId = scopeOrgId || currentOrgId;

  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? "");
    setDescription(template?.description ?? "");
    setItems(
      (template?.items ?? []).map((item, index) => ({
        id: item.id,
        sortOrder: index,
        itemType: item.itemType,
        title: item.title,
        isRequired: item.isRequired,
        linkUrl: item.linkUrl ?? undefined,
        options: (item.options ?? []).map((option) => ({ sortOrder: option.sortOrder, label: option.label })),
      }))
    );
  }, [open, template]);

  const drawerTitle = useMemo(() => {
    if (readOnly) return "查看表单内容";
    if (template?.status === "draft") return "编辑表单草稿";
    if (template) return "基于当前表单改版";
    return "新建表单草稿";
  }, [readOnly, template]);

  async function handleSave(proceedToNext = false) {
    if (readOnly) return;
    if (!title.trim() || !resolvedTemplateOrgId) return;
    const normalizedItems = items.map((item, index) => ({
      sortOrder: index,
      itemType: item.itemType,
      title: item.title.trim(),
      isRequired: item.isRequired,
      linkUrl: item.itemType === "LINK" ? normalizeLearningLink(item.linkUrl) : undefined,
      options: item.options.map((option, optionIndex) => ({ sortOrder: optionIndex, label: option.label.trim() })).filter((option) => option.label),
    }));

    if (normalizedItems.length === 0) {
      alert("请至少添加一个子任务");
      return;
    }
    if (normalizedItems.some((item) => !item.title)) {
      alert("请填写每个子任务的标题，空标题不会被正常执行");
      return;
    }
    const emptyLink = items.find((item) => item.itemType === "LINK" && !item.linkUrl?.trim());
    if (emptyLink) {
      alert(`学习链接类型的子任务「${emptyLink.title || "未命名"}」需要填写跳转 URL`);
      return;
    }
    const invalidLink = items.find((item) => item.itemType === "LINK" && item.linkUrl?.trim() && !isLearningLinkValid(item.linkUrl));
    if (invalidLink) {
      alert(`学习链接类型的子任务「${invalidLink.title || "未命名"}」链接格式无效，请填写完整网址`);
      return;
    }
    const invalidChoice = normalizedItems.find((item) => (item.itemType === "SINGLE_CHOICE" || item.itemType === "MULTI_CHOICE") && item.options.length === 0);

    if (invalidChoice) {
      alert("单选/多选子任务至少需要一个选项");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      items: normalizedItems,
    };
    try {
      const saved = template?.status === "draft"
        ? await templateApi.update(template.id, payload, scopeOrgId ? { scopeOrgId } : undefined)
        : await templateApi.create({ ...payload, category, orgId: resolvedTemplateOrgId, scopeOrgId });
      if (proceedToNext && onSavedAndNext) {
        await onSavedAndNext(saved);
      } else {
        await onSaved(saved);
      }
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-slate-950/25 backdrop-blur-sm" onClick={onClose} />
      <div className="flex h-full w-[620px] flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{drawerTitle}</h3>
            <p className="mt-1 text-xs text-slate-400">{category === "DAILY" ? "用于主播日常任务三步向导的表单草稿。" : "用于临时任务发放的表单草稿。"}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl p-2 text-slate-400 transition hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">表单标题</label>
              <input className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：主播日常直播工作手册" disabled={readOnly} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">表单说明</label>
              <textarea className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：覆盖直播前准备、直播中配合和直播后复盘三段动作。" disabled={readOnly} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-slate-900">表单题目</p>
                <p className="text-xs text-slate-400">请尽量让主播在同一张任务表里完成完整的工作手册动作。</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">{items.length} 项</span>
            </div>
            {items.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">先添加一项工作手册内容，例如“开播前检查封面与标题”。</div>
            ) : (
              <div className="space-y-3">{items.map((item) => <ItemEditor key={item.id} item={item} readOnly={readOnly} onChange={(value) => setItems((current) => current.map((entry) => (entry.id === item.id ? value : entry)))} onDelete={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} />)}</div>
            )}
            {!readOnly && (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-sm font-medium text-slate-700">添加题型</p>
                <div className="grid grid-cols-2 gap-2">{itemTypeOptions.map((option) => <button key={option.value} type="button" onClick={() => setItems((current) => [...current, { id: genId(), sortOrder: current.length, itemType: option.value, title: "", isRequired: true, options: [] }])} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left text-xs text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"><div className="flex items-start gap-2"><span className="mt-0.5">{option.icon}</span><span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-slate-400">{option.desc}</span></span></div></button>)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 p-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">{readOnly ? "关闭" : "取消"}</button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => void handleSave(false)}
                disabled={!title.trim() || saving || !resolvedTemplateOrgId}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "保存中..." : template?.status === "draft" ? "保存表单草稿" : "创建表单草稿"}
              </button>
              {!template && onSavedAndNext && (
                <button
                  type="button"
                  onClick={() => void handleSave(true)}
                  disabled={!title.trim() || saving || !resolvedTemplateOrgId}
                  className="flex-1 rounded-2xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "保存中..." : "直接进入下一步 →"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
