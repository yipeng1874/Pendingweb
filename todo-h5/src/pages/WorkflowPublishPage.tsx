import { PublishHeader } from "../components/PublishHeader";
import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { GitBranch, Plus, Search, UserRound, Trash2 } from "lucide-react";
import { MobileBottomNav } from "../components/MobileBottomNav";
import { MobileDateTimePicker } from "../components/MobileDateTimePicker";
import { PublishFeedback } from "../components/PublishFeedback";
import { WorkflowCard } from "../components/CollaborationTaskCards";
import { useAuthStore } from "../stores/auth";
import { canPublishWorkflow, validateWorkflow, workflowPublishApi, type Assignee, type PublishBootstrap, type PublishInput, type PublishQuestion } from "../services/workflowPublish";
import type { CollaborationQuestionType, WorkflowTask } from "../types";
import "./workflowPublish.css";

const types: [CollaborationQuestionType, string][] = [["QA", "问答"], ["FILL_BLANK", "待办"], ["SINGLE_CHOICE", "单选"], ["MULTI_CHOICE", "多选"], ["LINK", "链接确认"], ["ATTACHMENT", "附件上传"]];
const question = (itemType: CollaborationQuestionType = "QA"): PublishQuestion => ({ title: "", itemType, isRequired: true, options: [] });
type DraftStep = { key: string; assignee?: Assignee; questions: PublishQuestion[] };
let nextStepKey = 0;
const step = (): DraftStep => ({ key: `step-${++nextStepKey}`, questions: [question()] });

export function WorkflowPublishPage() {
  const identity = useAuthStore(s => s.currentIdentity);
  if (!canPublishWorkflow(identity)) return <Navigate to="/todos" replace />;
  return <Publisher key={identity!.id} identityId={identity!.id} />;
}

function Publisher({ identityId }: { identityId: string }) {
  const [bootstrap, setBootstrap] = useState<PublishBootstrap | null>(null);
  const [deleteQuestion, setDeleteQuestion] = useState<{ nodeKey: string; index: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"new" | "issued">("new");
  const [phase, setPhase] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [issuedStatus, setIssuedStatus] = useState<"in_progress" | "completed" | "ended">("in_progress");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<Assignee[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const pickerPanel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const loadVersion = useRef(0);
  const alive = useRef(true);
  const current = () => alive.current && useAuthStore.getState().currentIdentity?.id === identityId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load(append = false) {
    const version = ++loadVersion.current;
    const valid = () => current() && version === loadVersion.current;
    setLoading(true); setError("");
    try {
      if (tab === "new") { const identity = useAuthStore.getState().currentIdentity; if (valid() && identity) setBootstrap({ enabled: canPublishWorkflow(identity), operator: { identityId: identity.id, orgName: identity.org?.name } }); }
      else {
        if (!append) { setTasks([]); setNextCursor(null); }
        const data = await workflowPublishApi.issued(issuedStatus, append ? nextCursor ?? undefined : undefined);
        if (valid()) { setTasks(old => append ? [...old, ...data.items.filter(item => !old.some(previous => previous.id === item.id))] : data.items); setNextCursor(data.nextCursor); }
      }
    } catch (e) { if (valid()) setError(e instanceof Error ? e.message : "加载失败"); }
    finally { if (valid()) setLoading(false); }
  }
  useEffect(() => { void load(); }, [tab, issuedStatus]);
  useEffect(() => {
    if (phase !== 2) return;
    setCountdown(5);
    const timer = window.setInterval(() => setCountdown(n => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (!picker) return;
    let cancelled = false;
    setSearchError(""); setResults([]);
    const term = keyword.trim();
    if ((/^\d+$/.test(term) ? term.length < 5 : term.length < 2)) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try { const data = await workflowPublishApi.search(keyword.trim()); if (!cancelled) setResults(data); }
      catch (e) { if (!cancelled) setSearchError(e instanceof Error ? e.message : "搜索失败"); }
      finally { if (!cancelled) setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [picker, keyword]);
  useEffect(() => {
    if (!picker) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    pickerPanel.current?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [picker]);
  const payload = (): PublishInput => ({ title: title.trim(), description: description.trim(), dueAt, steps: steps.map((s, i) => ({ title: `节点${i + 1}`, assigneeUserId: s.assignee?.userId ?? "", requirement: s.questions.map(q => q.title.trim()).filter(Boolean).join("；"), questions: s.questions.map(q => ({ ...q, title: q.title.trim(), options: q.options.map(o => o.trim()).filter(Boolean), linkUrl: q.itemType === "LINK" ? q.linkUrl?.trim() : undefined })) })) });
  const updateStep = (key: string, patch: Partial<DraftStep>) => setSteps(old => old.map(s => s.key === key ? { ...s, ...patch } : s));
  function next() {
    setError("");
    if (phase === 0 && (!title.trim() || !dueAt)) { setError("请填写任务标题和截止时间"); return; }
    if (phase === 1) { const message = validateWorkflow(payload()); if (message) { setError(message); return; } }
    if (phase === 0 && !steps.length) { setKeyword(""); setPicker("new"); }
    setPhase(n => n + 1);
  }
  async function publish() {
    if (busy.current || !current() || countdown > 0) return;
    const input = payload(); const message = validateWorkflow(input);
    if (message) { setError(message); return; }
    busy.current = true; setSaving(true); setError("");
    try {
      const task = await workflowPublishApi.create(input);
      if (!current()) return;
      setTasks(old => [task, ...old]); setNotice("流转任务发布成功，可展开查看节点和执行结果。");
      setTitle(""); setDescription(""); setDueAt(""); setSteps([]); setPhase(0); setIssuedStatus("in_progress"); setTab("issued");
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : "发布失败，请重试"); }
    finally { busy.current = false; if (current()) setSaving(false); }
  }
  const pickerNodeIndex = picker === "new" ? steps.length + 1 : steps.findIndex(s => s.key === picker) + 1;
  const pickerAssignee = steps.find(s => s.key === picker)?.assignee;
  return <div className="page-shell"><div className="mobile-page bottom-safe wp-page">
    <PublishHeader title="流转任务" icon={<GitBranch size={19} />} back disabled={loading || saving} onRefresh={() => void load()} />
    <main className="wp-content">
      <div className="wp-tabs">{(["new", "issued"] as const).map(value => <button key={value} aria-pressed={tab === value} disabled={saving} onClick={() => { setTab(value); setError(""); }}>{value === "new" ? "新建流转任务" : "我发布的"}</button>)}</div>
      {(error || searchError || notice) && <PublishFeedback key={error || searchError || notice} message={error || searchError || notice} success={!error && !searchError && Boolean(notice)} onClose={() => { if (error) setError(""); else if (searchError) setSearchError(""); else setNotice(""); }} />}
      {loading && <p role="status">加载中…</p>}
      {tab === "issued" ? <div className="list"><div className="wp-issued-filters">{([["in_progress", "进行中"], ["completed", "已完成"], ["ended", "已结束"]] as const).map(([status, label]) => <button type="button" key={status} aria-pressed={issuedStatus === status} onClick={() => { if (issuedStatus !== status) { setTasks([]); setNextCursor(null); setIssuedStatus(status); } }}>{label}</button>)}</div>{!loading && !error && !tasks.length && <p className="wp-empty">当前分类暂无任务</p>}{tasks.map(task => <section key={task.id}><WorkflowCard task={task} readOnly onUpdate={() => {}} /></section>)}{nextCursor && <button className="btn btn-ghost" disabled={loading} onClick={() => void load(true)}>{loading ? "加载中…" : "加载更多（10条）"}</button>}{!loading && tasks.length > 0 && !nextCursor && <p className="section-note">本分类已全部加载</p>}</div> : bootstrap?.enabled ? <>
        <ol className="wp-phases">{["基本信息", "配置节点", "预览发布"].map((label, i) => <li key={label} aria-current={i === phase ? "step" : undefined}>{i + 1} {label}</li>)}</ol>
        <fieldset disabled={saving} className="wp-form">
        {phase === 0 && <section className="wp-panel">
          <label>任务标题 <em>*</em><input value={title} onChange={e => setTitle(e.target.value)} placeholder="请输入任务标题" /></label>
          <label>任务说明<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="说明任务背景和要求" rows={3} /></label>
          <label>截止时间 <em>*</em><MobileDateTimePicker value={dueAt} onChange={setDueAt} /></label>
        </section>}
        {phase === 1 && <div className="list">{steps.map((s, i) => <details className="wp-panel" key={s.key} open={s.key === expandedNode}>
          <summary className="wp-node-header" onClick={event => { event.preventDefault(); setExpandedNode(expandedNode === s.key ? null : s.key); }}><span className="wp-node-heading"><span>{expandedNode === s.key ? "▾" : "▸"} 节点 {i + 1} · {s.assignee?.nickname}</span><small>{s.assignee?.orgName} · {s.questions.length ? `${s.questions.length} 题` : "请选择题型"}</small></span><button type="button" className="wp-change-person" aria-label={`更换节点${i + 1}执行人`} onClick={event => { event.preventDefault(); event.stopPropagation(); setPicker(s.key); setKeyword(""); }}>更换执行人</button></summary>
          {s.questions.map((q, qi) => { const change = (patch: Partial<PublishQuestion>) => updateStep(s.key, { questions: s.questions.map((old, index) => index === qi ? { ...old, ...patch } : old) }); return <section className="wp-question" key={qi}>
            <div className="wp-row wp-question-header"><strong>题目 {qi + 1}</strong><select aria-label={`题目${qi + 1}类型`} value={q.itemType} onChange={e => change({ itemType: e.target.value as CollaborationQuestionType, options: ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(e.target.value) ? (q.options.length >= 2 ? q.options : ["", ""]) : [], linkUrl: "" })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="wp-required"><input type="checkbox" checked={q.isRequired} onChange={e => change({ isRequired: e.target.checked })} />必填</label><button type="button" className="wp-delete-question" aria-label={`删除题目${qi + 1}`} title="删除题目" onClick={() => setDeleteQuestion({ nodeKey: s.key, index: qi })}><Trash2 size={18} /></button></div>
            <label>题目标题 <em>*</em><input value={q.title} onChange={e => change({ title: e.target.value })} placeholder="请输入题目内容" /></label>
            {["SINGLE_CHOICE", "MULTI_CHOICE"].includes(q.itemType) && <div className="wp-options"><div className="wp-row"><strong>{q.itemType === "SINGLE_CHOICE" ? "单选选项" : "多选选项"}</strong><small>至少填写两个选项</small></div>{q.options.map((option, oi) => <div className="wp-option-row" key={oi}><span className={`wp-option-marker ${q.itemType === "MULTI_CHOICE" ? "square" : ""}`} aria-hidden="true" /><input aria-label={`题目${qi + 1}选项${oi + 1}`} placeholder={`选项${oi + 1}`} value={option} onChange={e => change({ options: q.options.map((old, index) => index === oi ? e.target.value : old) })} /><button type="button" aria-label={`删除选项${oi + 1}`} disabled={q.options.length <= 2} onClick={() => change({ options: q.options.filter((_, index) => index !== oi) })}><Trash2 size={16} /></button></div>)}<button type="button" className="btn btn-ghost wp-add-option" onClick={() => change({ options: [...q.options, ""] })}><Plus size={15} />添加选项</button></div>}
            {q.itemType === "LINK" && <label>链接地址 <em>*</em><input type="url" value={q.linkUrl || ""} onChange={e => change({ linkUrl: e.target.value })} placeholder="https://" /></label>}
            {q.itemType === "ATTACHMENT" && <p className="section-note">由执行人上传图片或文件，与 PC 端使用同一附件规则。</p>}
          </section>; })}
          <div className="wp-row"><button className="btn btn-ghost" onClick={() => updateStep(s.key, { questions: [...s.questions, question()] })}>＋ 添加题目</button><button onClick={() => setSteps(old => old.filter(item => item.key !== s.key))}>删除节点</button></div>
        </details>)}<button className="btn wp-add-node" onClick={() => { setKeyword(""); setPicker("new"); }}><Plus size={16} />添加下一节点</button></div>}
        {phase === 2 && <section className="wp-panel wp-preview">
          <div className="wp-preview-heading"><h2>{title}</h2><span>截止 {dueAt.replace("T", " ")}</span></div>
          {description.trim() && <p className="wp-preview-description">{description}</p>}
          {steps.map((s, i) => <section className="wp-preview-node" key={s.key}>
            <div className="wp-preview-node-header"><strong>节点{i + 1} · {s.assignee?.nickname}</strong><span>{s.questions.length} 题</span></div>
            <p className="section-note">{s.assignee?.orgName} · {s.assignee?.phone}</p>
            {s.questions.map((q, qi) => <div className="wp-preview-question" key={qi}>
              <div className="wp-preview-question-heading"><span className="wp-preview-kind">{qi + 1}. {types.find(t => t[0] === q.itemType)?.[1]}</span><span className={q.isRequired ? "wp-preview-required" : "section-note"}>{q.isRequired ? "必填" : "选填"}</span></div>
              <p className="wp-preview-question-title">{q.title}</p>
              {["SINGLE_CHOICE", "MULTI_CHOICE"].includes(q.itemType) && <ul className="wp-preview-options">{q.options.filter(o => o.trim()).map((option, oi) => <li key={oi}><span className={q.itemType === "MULTI_CHOICE" ? "square" : ""} aria-hidden="true" />{option}</li>)}</ul>}
              {q.itemType === "QA" && <div className="wp-preview-answer">执行人填写文字回答</div>}
              {q.itemType === "FILL_BLANK" && <div className="wp-preview-answer">执行人填写完成情况并确认</div>}
              {q.itemType === "LINK" && <div className="wp-preview-answer">链接：{q.linkUrl}<small>执行人查看后确认</small></div>}
              {q.itemType === "ATTACHMENT" && <div className="wp-preview-answer">执行人上传图片或文件<small>单个附件上限 20MB</small></div>}
            </div>)}
          </section>)}
          <div className="wp-publish-check"><strong>{countdown > 0 ? `发布前核对 · ${countdown}s` : "请确认节点执行人"}</strong><div>{steps.map((s, i) => <span key={s.key}>节点{i + 1}：{s.assignee?.nickname}</span>)}</div><small>倒计时结束后，点击确认发布</small></div>
        </section>}
        <div className="wp-actions">{phase > 0 && <button className="btn btn-ghost" onClick={() => { setPhase(n => n - 1); setError(""); }}>上一步</button>}{phase < 2 ? <button className="btn btn-primary" onClick={next}>{phase === 0 ? "下一步：配置节点" : "预览任务"}</button> : <button className="btn btn-primary" disabled={saving || countdown > 0} onClick={() => void publish()}>{saving ? "正在发布…" : countdown > 0 ? `确认发布（${countdown}s）` : "确认发布"}</button>}</div>
        </fieldset>
      </> : !loading && <button className="btn btn-ghost" onClick={() => void load()}>重新加载发布权限</button>}
    </main><MobileBottomNav />
    {deleteQuestion && <PublishFeedback success={false} message={`将删除节点${steps.findIndex(s => s.key === deleteQuestion.nodeKey) + 1}的题目${deleteQuestion.index + 1}及其配置内容，其他题目不受影响。`} onClose={() => setDeleteQuestion(null)} onConfirm={() => { setSteps(old => old.map(s => s.key === deleteQuestion.nodeKey ? { ...s, questions: s.questions.filter((_, index) => index !== deleteQuestion.index) } : s)); setDeleteQuestion(null); }} />}
    {picker && <div className="wp-picker" onClick={event => { if (event.target === event.currentTarget) setPicker(null); }}><div ref={pickerPanel} tabIndex={-1} className="wp-picker-body" role="dialog" aria-modal="true" aria-label="选择执行人" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setPicker(null); } if (event.key === "Tab") { const items = Array.from(pickerPanel.current!.querySelectorAll<HTMLElement>("button,input")); const first = items[0], last = items[items.length - 1]; if (event.shiftKey && (document.activeElement === first || document.activeElement === pickerPanel.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}><div className="wp-picker-handle" /><div className="wp-picker-header"><div><span className="wp-picker-node">节点 {pickerNodeIndex}</span><h2>{picker === "new" ? "选择执行人" : "更换执行人"}</h2></div><button className="btn btn-ghost" onClick={() => setPicker(null)}>取消</button></div><p className="wp-picker-context">{picker === "new" ? "选中执行人后，继续配置该节点的题型与内容" : `当前执行人：${pickerAssignee?.nickname || "未选择"}，更换后保留已配置题目`}</p><label className="wp-picker-search"><Search size={18} /><input aria-label="搜索执行人" placeholder="搜索姓名、手机号或抖音号" value={keyword} onChange={e => setKeyword(e.target.value)} /></label>{searching ? <p>搜索中…</p> : <div className="list">{results.map(person => <button className="wp-person wp-person-result" key={person.userId} onClick={() => { if (picker === "new") { const node = { ...step(), assignee: person }; setSteps(old => [...old, node]); setExpandedNode(node.key); } else { updateStep(picker, { assignee: person }); } setPicker(null); }}><span className="wp-person-avatar"><UserRound size={21} /></span><span className="wp-person-info"><strong>{person.nickname}</strong><small>{person.orgName || "未标注组织"} · {person.primaryCategory === "subordinate_anchor" ? "名下主播" : person.primaryCategory === "peer_manager" ? "同级管理" : "名下管理"}</small><small>{person.phone}</small></span><span className="wp-person-select">{pickerAssignee?.userId === person.userId ? "当前" : "选择"}</span></button>)}{!results.length && !searchError && <p className="section-note">{!keyword.trim() ? "输入姓名、手机号或抖音号后搜索" : (/^\d+$/.test(keyword.trim()) ? keyword.trim().length < 5 : keyword.trim().length < 2) ? "文字至少输入2个字，纯数字至少输入5位" : "没有匹配的执行人，请调整关键词"}</p>}{results.length >= 20 && <p className="section-note">最多展示20人，请补充关键词缩小范围</p>}</div>}</div></div>}
  </div></div>;
}
