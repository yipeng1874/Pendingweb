import { PublishHeader } from "../components/PublishHeader";
import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { Trash2, ChevronDown, ChevronUp, Send } from "lucide-react";
import { useAuthStore } from "../stores/auth";
import { MobileBottomNav } from "../components/MobileBottomNav";
import { MobileDateTimePicker } from "../components/MobileDateTimePicker";
import { PublishFeedback } from "../components/PublishFeedback";
import { broadcastPublishApi as service, type Recipient, type RecipientType, type BroadcastSummary, type RecipientRecord } from "../services/broadcastPublish";
import type { PublishQuestion } from "../services/workflowPublish";
import "./workflowPublish.css";
import "./broadcastPublish.css";

const kinds = { QA: "问答", FILL_BLANK: "待办", SINGLE_CHOICE: "单选", MULTI_CHOICE: "多选", LINK: "链接确认", ATTACHMENT: "附件上传" };
const blank = (): PublishQuestion => ({ title: "", itemType: "QA", isRequired: true, options: [] });
const message = (e: unknown) => e instanceof Error ? e.message : "请求失败，请重试";

function HallAnchors({ selected, onChange }: { selected: Recipient[]; onChange: (people: Recipient[]) => void }) {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true), busy = useRef(false);
  async function load(offset = 0) {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError("");
    try { const data = await service.search("ANCHOR", "", offset); if (alive.current) { setRows(old => offset ? [...old, ...data.anchors.filter(p => !old.some(r => r.userId === p.userId))] : data.anchors); setNext(data.nextOffset); } }
    catch (e) { if (alive.current) setError(message(e)); }
    finally { busy.current = false; if (alive.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  return <div><div className="bp-line"><strong>本厅主播 · 已选 {selected.length} 人</strong>{rows.length > 0 && <button className="btn btn-ghost" onClick={() => onChange([...selected, ...rows.filter(p => !selected.some(s => s.userId === p.userId))])}>全选已加载</button>}</div>
    <div className="bp-anchor-list">{rows.map(p => <label className="bp-person" key={p.userId}><input type="checkbox" checked={selected.some(s => s.userId === p.userId)} onChange={e => onChange(e.target.checked ? [...selected, p] : selected.filter(s => s.userId !== p.userId))} /><span><strong>{p.nickname}</strong><small>{p.phone}{p.douyinNo ? ` · ${p.douyinNo}` : ""}</small></span></label>)}</div>
    {loading && <p role="status">加载本厅主播…</p>}{error && <p role="alert">{error}<button className="btn btn-ghost" onClick={() => void load(next ?? 0)}>重试</button></p>}{!loading && !error && !rows.length && <p className="section-note">本厅暂无可选主播</p>}{next !== null && <button disabled={loading} className="btn btn-ghost" onClick={() => void load(next)}>加载更多主播（20人）</button>}
  </div>;
}

function PeoplePicker({ type, selected, onClose, onConfirm }: { type: RecipientType; selected: Recipient[]; onClose: () => void; onConfirm: (people: Recipient[]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState(selected);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Recipient[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  useEffect(() => { dialog.current?.showModal(); const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { version.current++; document.body.style.overflow = overflow; }; }, []);
  async function search(offset: number, requestVersion: number) {
    setBusy(true); setError("");
    try { const data = await service.search(type, q.trim(), offset); if (version.current !== requestVersion) return;
      const rows = type === "ANCHOR" ? data.anchors : data.hallManagers;
      setPeople(old => offset ? [...old, ...rows.filter(p => !old.some(v => v.userId === p.userId))] : rows); setNext(data.nextOffset);
    } catch (e) { if (version.current === requestVersion) setError(message(e)); }
    finally { if (version.current === requestVersion) setBusy(false); }
  }
  useEffect(() => { const v = ++version.current; setPeople([]); setNext(null); setBusy(false); setError("");
    if (q.trim().length < (/^\d+$/.test(q.trim()) ? 5 : 2)) return;
    const timer = setTimeout(() => void search(0, v), 300); return () => clearTimeout(timer);
  }, [q, type]);
  return <dialog ref={dialog} className="bp-picker" onCancel={onClose}>
    <div className="bp-line"><strong>选择{type === "ANCHOR" ? "主播" : "厅管"}</strong><button className="btn btn-ghost" onClick={onClose}>取消</button></div>
    <input className="input" maxLength={80} value={q} onChange={e => setQ(e.target.value)} placeholder={type === "ANCHOR" ? "搜索姓名、手机号或抖音号" : "搜索姓名、手机号或厅名称"} aria-label="搜索接收人" />
    <p className="section-note">输入至少2个字或5位数字后搜索 · 已选 {chosen.length} 人</p>
    {chosen.length > 0 && <section className="bp-selected" aria-label="已选接收人"><strong>已选人员（{chosen.length}）</strong><div className="bp-chips">{chosen.map(p => <button key={p.userId} aria-label={`取消选择${p.nickname}`} onClick={() => setChosen(old => old.filter(s => s.userId !== p.userId))}>{p.nickname}{p.orgName ? ` · ${p.orgName}` : ""} ×</button>)}</div></section>}
    <div className="bp-results">
      {people.map(p => <label className="bp-person" key={p.userId}><input type="checkbox" checked={chosen.some(c => c.userId === p.userId)} onChange={e => setChosen(old => e.target.checked ? [...old, p] : old.filter(c => c.userId !== p.userId))} /><span><strong>{p.nickname}</strong><small>{p.orgName} · {p.phone}</small></span></label>)}
      {error && <p role="alert">{error}<button className="btn btn-ghost" onClick={() => void search(0, version.current)}>重试</button></p>}
      {busy && <p role="status">搜索中…</p>}{!busy && !error && q.trim().length >= (/^\d+$/.test(q.trim()) ? 5 : 2) && !people.length && <p className="section-note">暂无结果，请调整搜索词</p>}
      {next !== null && <button className="btn btn-ghost" disabled={busy} onClick={() => void search(next, version.current)}>加载更多</button>}
    </div>
    <button className="btn btn-primary" onClick={() => onConfirm(chosen)}>确定（{chosen.length}人）</button>
  </dialog>;
}

function IssuedCard({ task }: { task: BroadcastSummary }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RecipientRecord[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    if (pending.current) return; pending.current = true; setBusy(true); setError("");
    try { const data = await service.recipients(task.id, page + 1); if (alive.current) { setRows(old => [...old, ...data.items]); setPage(p => p + 1); setMore(data.hasMore); } }
    catch (e) { if (alive.current) setError(message(e)); } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const completed = task._count.anchorRecords > 0 && task.completedCount === task._count.anchorRecords;
  const ended = task.status === "ended" || Boolean(task.dueAt && new Date(task.dueAt).getTime() < Date.now());
  return <section className={`dashboard-task-card wp-issued-card bp-record${!completed && !ended ? " dashboard-task-active" : ""}`}>
    <button className="dashboard-card-toggle" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !page) void load(); }}>
      <div className="dashboard-card-main"><div className="dashboard-card-topline"><strong className="wp-issued-title">{task.title}</strong><span className="wp-issued-progress">完成 {task.completedCount}/{task._count.anchorRecords}</span><span className={`tag ${completed ? "tag-green" : ended ? "tag-slate" : "task-status-active"}`}>{completed ? "已完成" : ended ? "已结束" : "进行中"}</span></div>
      <div className="dashboard-meta">{(task.createdByName || task.hallOrgName) && <span>{[task.createdByName, task.hallOrgName].filter(Boolean).join(" · ")}</span>}<span>截止 {task.dueAt ? new Date(task.dueAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "不限"}</span></div></div>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </button>
    {open && <div className="dashboard-expanded">{task.description && <p className="dashboard-description dashboard-description-full">{task.description}</p>}
      {rows.map(r => <section key={r.id} className="collaboration-step"><div className="dashboard-card-topline"><div className="bp-recipient-heading"><strong>{r.anchorNickname}</strong>{r.anchorOrgName && <span>{r.anchorOrgName}</span>}</div><span className={`tag ${r.status === "submitted" ? "tag-green" : ended || r.status === "overdue" ? "tag-slate" : "tag-blue"}`}>{r.status === "submitted" ? "已完成" : ended || r.status === "overdue" ? "未完成" : r.status === "in_progress" ? "进行中" : "未填写"}</span></div>
        <div className="list">{task.questions.map((q, i) => { const a = r.answers.find(a => a.questionId === q.id); return <div className="detail-item collaboration-question" key={q.id}>
          <div className="collaboration-question-title"><span className="detail-item-kind"><span className="detail-item-order">{i + 1}</span><span>{kinds[q.itemType]}</span></span><strong>{q.isRequired && <span className="detail-item-required" aria-label="必填">*</span>}{q.title}</strong>{a && <span className="tag tag-green">已确认</span>}</div>
          <div className="collaboration-readonly">{a ? q.itemType === "ATTACHMENT" ? (a.attachmentUrls || []).map((url, n) => <a key={url} href={url.startsWith("/uploads/") ? `/api${url}` : url} target="_blank" rel="noreferrer">查看附件 {n + 1}</a>) : q.itemType === "LINK" ? a.isLinkConfirmed ? "已确认" : "未确认" : q.itemType.includes("CHOICE") ? (a.answerOptions || []).join("、") || "未填写" : a.answerText || "未填写" : "未填写"}</div>
        </div>; })}</div>
      </section>)}
      {error && <p role="alert">{error}<button className="btn btn-ghost" onClick={() => void load()}>重试</button></p>}{busy && <p role="status">加载中…</p>}{more && <button disabled={busy} className="btn btn-ghost" onClick={() => void load()}>加载更多接收人（10人）</button>}
    </div>}
  </section>;
}

export function BroadcastPublishPage() {
  const identity = useAuthStore(s => s.currentIdentity);
  if (!identity || !["HALL_MANAGER", "TEAM_ADMIN"].includes(identity.roleCode)) return <Navigate to="/publish" replace />;
  return <Publisher key={identity.id} identityId={identity.id} isTeam={identity.roleCode === "TEAM_ADMIN"} />;
}

function Publisher({ identityId, isTeam }: { identityId: string; isTeam: boolean }) {
  const [tab, setTab] = useState("new"), [phase, setPhase] = useState(0);
  const [title, setTitle] = useState(""), [description, setDescription] = useState(""), [dueAt, setDueAt] = useState("");
  const [type, setType] = useState<RecipientType>(isTeam ? "HALL_MANAGER" : "ANCHOR");
  const [people, setPeople] = useState<Recipient[]>([]), [picker, setPicker] = useState(false);
  const [questions, setQuestions] = useState<PublishQuestion[]>([blank()]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [countdown, setCountdown] = useState(5), [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("active"), [tasks, setTasks] = useState<BroadcastSummary[]>([]);
  const [page, setPage] = useState(0), [more, setMore] = useState(false), [loading, setLoading] = useState(false);
  const alive = useRef(true), busy = useRef(false), version = useRef(0);
  const valid = () => alive.current && useAuthStore.getState().currentIdentity?.id === identityId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; version.current++; }; }, []);
  useEffect(() => { if (phase !== 3) return; setCountdown(5); const timer = setInterval(() => setCountdown(n => Math.max(0, n - 1)), 1000); return () => clearInterval(timer); }, [phase]);
  async function load(nextPage: number) {
    const v = ++version.current; setLoading(true); setError("");
    try { const data = await service.issued(status, nextPage); if (valid() && v === version.current) { setTasks(old => nextPage === 1 ? data.tasks : [...old, ...data.tasks]); setPage(nextPage); setMore(data.hasMore); } }
    catch (e) { if (valid() && v === version.current) setError(message(e)); } finally { if (valid() && v === version.current) setLoading(false); }
  }
  useEffect(() => { version.current++; setTasks([]); setPage(0); setMore(false); if (tab === "issued") void load(1); }, [tab, status]);
  function update(i: number, patch: Partial<PublishQuestion>) { setQuestions(old => old.map((q, j) => j === i ? { ...q, ...patch } : q)); }
  function validate() {
    if (!title.trim()) return "请填写任务标题";
    if (!dueAt || !Number.isFinite(new Date(dueAt).getTime())) return "请选择截止时间";
    if (!people.length) return "请选择至少一位接收人";
    if (!questions.length) return "请至少添加一道题目";
    for (const q of questions) {
      if (!q.title.trim()) return "请填写题目标题";
      if (q.itemType.includes("CHOICE") && q.options.filter(o => o.trim()).length < 2) return "选择题至少填写两个选项";
      if (q.itemType === "LINK" && !/^https?:\/\//i.test(q.linkUrl || "")) return "请填写以 http:// 或 https:// 开头的学习链接";
    }
    return "";
  }
  async function publish() {
    if (busy.current || countdown || !valid()) return;
    const problem = validate(); if (problem) { setError(problem); return; }
    busy.current = true; setSaving(true);
    try { await service.create({ title: title.trim(), description: description.trim(), ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}), recipientType: type, selectedRecipientUserIds: people.map(p => p.userId), questions: questions.map(q => ({ ...q, title: q.title.trim(), options: q.options.map(o => o.trim()).filter(Boolean) })) });
      if (valid()) { setNotice(`群发任务已发布，共 ${people.length} 位接收人`); setTitle(""); setDescription(""); setDueAt(""); setPeople([]); setQuestions([blank()]); setPhase(0); setStatus("active"); setTab("issued"); }
    } catch (e) { if (valid()) setError(message(e)); } finally { busy.current = false; if (valid()) setSaving(false); }
  }
  return <div className="page-shell"><div className="mobile-page bottom-safe wp-page bp-page">
    <PublishHeader title="群发任务" icon={<Send size={19} />} back disabled={saving} />
    <main className="wp-content"><div className="wp-tabs">{["new", "issued"].map(t => <button key={t} disabled={saving} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === "new" ? "新建群发任务" : "我发布的"}</button>)}</div>
    {tab === "issued" ? <div className="list"><div className="wp-issued-filters">{[["active", "进行中"], ["completed", "已完成"], ["ended", "已结束"]].map(([s, label]) => <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>{label}</button>)}</div>{tasks.map(t => <IssuedCard key={t.id} task={t} />)}{loading ? <p role="status">加载中…</p> : !tasks.length ? <p className="section-note">当前分类暂无任务</p> : null}{more && <button className="btn btn-ghost" disabled={loading} onClick={() => void load(page + 1)}>加载更多（10条）</button>}<button className="btn btn-ghost" disabled={loading} onClick={() => void load(1)}>刷新</button></div> : <>
      <ol className="wp-phases">{["基本信息", "接收人", "配置题目", "预览发布"].map((t, i) => <li key={t} aria-current={phase === i ? "step" : undefined}>{i + 1} {t}</li>)}</ol>
      {phase === 0 && <section className="wp-panel bp-form"><label>任务标题 *<input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="请输入任务标题" /></label><label>任务说明<textarea className="input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="说明任务背景和要求" /></label><div><strong>截止时间 *</strong><MobileDateTimePicker value={dueAt} onChange={setDueAt} />{dueAt && <button className="btn btn-ghost" onClick={() => setDueAt("")}>清除截止时间</button>}</div></section>}
      {phase === 1 && <><section className="wp-panel bp-form"><label>接收对象<select className="input" value={type} onChange={e => { setType(e.target.value as RecipientType); setPeople([]); }}>{!isTeam && <option value="ANCHOR">本厅主播</option>}<option value="HALL_MANAGER">同基地厅管</option></select></label>{type === "ANCHOR" ? <HallAnchors selected={people} onChange={setPeople} /> : <><button className="btn wp-add-node" onClick={() => setPicker(true)}>搜索选择接收人 · 已选 {people.length} 人</button><div className="bp-chips">{people.map(p => <button key={p.userId} onClick={() => setPeople(old => old.filter(c => c.userId !== p.userId))} aria-label={`移除${p.nickname}`}>{p.nickname} ×</button>)}</div></>}</section></>}
      {phase === 2 && <><div className="bp-recipient-summary"><span>已选{type === "ANCHOR" ? "主播" : "厅管"} {people.length} 人</span><button className="btn btn-ghost" onClick={() => setPhase(1)}>修改接收人</button></div>{questions.map((q, i) => <section key={i} className="wp-panel bp-form"><div className="wp-question-header"><strong>题目 {i + 1}</strong><select aria-label={`题目${i + 1}类型`} value={q.itemType} onChange={e => { const itemType = e.target.value as PublishQuestion["itemType"]; update(i, { itemType, options: itemType.includes("CHOICE") ? q.options.length >= 2 ? q.options : ["", ""] : [] }); }}>{Object.entries(kinds).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select><label className="wp-required"><input type="checkbox" checked={q.isRequired} onChange={e => update(i, { isRequired: e.target.checked })} />必填</label><button className="wp-delete-question" aria-label={`删除题目${i + 1}`} onClick={() => setDeleting(i)}><Trash2 size={16} /></button></div><input className="input" aria-label={`题目${i + 1}标题`} value={q.title} placeholder="请输入题目内容" onChange={e => update(i, { title: e.target.value })} />
      {q.itemType.includes("CHOICE") && <div>{q.options.map((o, n) => <div key={n} className="wp-option-row"><span className={`wp-option-marker ${q.itemType === "MULTI_CHOICE" ? "square" : ""}`} /><input className="input" value={o} placeholder={`选项${n + 1}`} onChange={e => update(i, { options: q.options.map((v, j) => j === n ? e.target.value : v) })} /><button disabled={q.options.length <= 2} aria-label={`删除选项${n + 1}`} onClick={() => update(i, { options: q.options.filter((_, j) => n !== j) })}><Trash2 size={16} /></button></div>)}<button className="btn btn-ghost wp-add-option" onClick={() => update(i, { options: [...q.options, ""] })}>＋添加选项</button></div>}
      {q.itemType === "LINK" && <input className="input" value={q.linkUrl || ""} placeholder="https:// 学习链接" onChange={e => update(i, { linkUrl: e.target.value })} />}{q.itemType === "ATTACHMENT" && <small>接收人上传图片或文件，单文件上限20MB</small>}</section>)}<button className="btn btn-ghost" onClick={() => setQuestions(old => [...old, blank()])}>＋添加题目</button></>}
      {phase === 3 && <section className="wp-panel"><div className="wp-preview-heading"><h2>{title}</h2><span>截止 {dueAt ? dueAt.replace("T", " ") : "不限"}</span></div>{description && <p className="wp-preview-description">{description}</p>}<div className="wp-publish-check"><strong>{type === "ANCHOR" ? "主播" : "厅管"} · 共 {people.length} 人</strong><div>{people.map(p => <span key={p.userId}>{p.nickname}（{p.orgName || "当前组织"}）</span>)}</div></div>{questions.map((q, i) => <div className="wp-preview-question" key={i}><span className="wp-preview-kind">{i + 1}. {kinds[q.itemType]} · {q.isRequired ? "必填" : "选填"}</span><p className="wp-preview-question-title">{q.title}</p>{q.itemType.includes("CHOICE") && <ul className="wp-preview-options">{q.options.filter(o => o.trim()).map((o, n) => <li key={n}><span className={q.itemType === "MULTI_CHOICE" ? "square" : ""} />{o}</li>)}</ul>}{q.itemType === "LINK" && <p className="wp-preview-answer">{q.linkUrl}</p>}{q.itemType === "ATTACHMENT" && <small>接收人上传附件，单文件上限20MB</small>}</div>)}<p className="section-note">请核对接收人和题目，倒计时结束后确认发布。</p></section>}
      <div className="bp-actions">{phase > 0 && <button className="btn btn-ghost" disabled={saving} onClick={() => setPhase(p => p - 1)}>上一步</button>}<button className="btn btn-primary" disabled={saving || (phase === 3 && countdown > 0)} onClick={() => { if (phase === 0) { if (!title.trim()) setError("请填写任务标题"); else if (!dueAt || !Number.isFinite(new Date(dueAt).getTime())) setError("请选择截止时间"); else setPhase(1); } else if (phase === 1) { if (!people.length) setError("请选择至少一位接收人"); else setPhase(2); } else if (phase === 2) { const problem = validate(); if (problem) setError(problem); else setPhase(3); } else void publish(); }}>{phase === 0 ? "下一步：选择接收人" : phase === 1 ? "下一步：配置题目" : phase === 2 ? "预览任务" : saving ? "发布中…" : countdown ? `请核对（${countdown}秒）` : "确认发布"}</button></div>
    </>}</main>{!saving && <MobileBottomNav />}
    {(error || notice) && <PublishFeedback message={error || notice} success={!error} onClose={() => { setError(""); setNotice(""); }} />}
    {deleting !== null && <PublishFeedback message={`确认删除题目 ${deleting + 1}？`} success={false} onClose={() => setDeleting(null)} onConfirm={() => { setQuestions(old => old.filter((_, i) => i !== deleting)); setDeleting(null); }} />}
    {picker && <PeoplePicker type={type} selected={people} onClose={() => setPicker(false)} onConfirm={value => { setPeople(value); setPicker(false); }} />}
  </div></div>;
}
