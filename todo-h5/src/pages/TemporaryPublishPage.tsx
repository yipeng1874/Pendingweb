import { useEffect, useRef, useState } from "react";
import { Send, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { PublishHeader } from "../components/PublishHeader";
import { MobileBottomNav } from "../components/MobileBottomNav";
import { MobileDateTimePicker } from "../components/MobileDateTimePicker";
import { PublishFeedback } from "../components/PublishFeedback";
import { useAuthStore } from "../stores/auth";
import { temporaryApi as service, type Org, type Account, type Assignment, type Preview } from "../services/temporaryPublish";
import type { PublishQuestion } from "../services/workflowPublish";
import { createPublishCache } from "../services/publishCache";
import "./workflowPublish.css";
import "./broadcastPublish.css";

const kinds = {QA:"问答",FILL_BLANK:"待办确认",SINGLE_CHOICE:"单选",MULTI_CHOICE:"多选",LINK:"学习链接",ATTACHMENT:"图片上传"};
const blank = (): PublishQuestion => ({title:"",itemType:"QA",isRequired:true,options:[]});
const msg = (e:unknown) => e instanceof Error ? e.message : "请求失败，请重试";
function QuestionHeading({index,type,required,done}:{index:number;type:string;required?:boolean;done?:boolean}) {
  return <div className="tp-question-heading"><span className="tp-question-number">{index+1}</span><span>{kinds[type as keyof typeof kinds]||type}</span>{required&&<span className="wp-preview-required">必填</span>}{done&&<span className="tag tag-green tp-confirmed">已确认</span>}</div>;
}
const allows = (p:string[], code:string) => p.includes("*") || p.includes(code);

export function TemporaryPublishPage() {
  const identity = useAuthStore(s=>s.currentIdentity);
  return <TemporaryEntry key={identity?.id} />;
}

function TemporaryEntry() {
  const identity = useAuthStore(s=>s.currentIdentity);
  const [permissions,setPermissions]=useState<string[]|null>(null),[orgs,setOrgs]=useState<Org[]>([]),[scope,setScope]=useState("");
  const [error,setError]=useState(""),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
  useEffect(()=>{let cancelled=false; setLoading(true); setError(""); (async()=>{try{
    const p=await service.permissions(); if(cancelled)return;setPermissions(p);
    if(!allows(p,"task:assignment:manage"))return;
    const data=await service.orgs();if(cancelled)return;setOrgs(data);
    if(!["DEV_ADMIN","HQ_ADMIN"].includes(identity?.roleCode||"")){
      const own=data.find(o=>o.id===identity?.orgId); const base=data.find(o=>o.orgType==="BASE" && (own?.path===o.path || own?.path.startsWith(o.path+"/") || identity?.scopePath===o.path || identity?.scopePath?.startsWith(o.path+"/")));
      if(base)setScope(base.id);
    }
  }catch(e){if(!cancelled)setError(msg(e));}finally{if(!cancelled)setLoading(false);}})();return()=>{cancelled=true;};},[retry]);
  const bases=orgs.filter(o=>o.status==="active"&&o.orgType==="BASE"&&(!identity?.scopePath||identity.roleCode==="DEV_ADMIN"||o.path===identity.scopePath||o.path.startsWith(identity.scopePath+"/")||identity.scopePath.startsWith(o.path+"/")));
  if(scope && permissions && !loading) return <Publisher key={`${identity?.id}:${scope}`} scope={scope} orgs={orgs} permissions={permissions} changeScope={()=>setScope("")} />;
  return <div className="page-shell"><div className="mobile-page bottom-safe wp-page bp-page tp-page"><PublishHeader title="临时·触达式" icon={<Send size={19}/>} back/><main className="wp-content">
    {loading?<p role="status">加载发布权限…</p>:error?<div role="alert">{error}<button className="btn btn-ghost" onClick={()=>setRetry(n=>n+1)}>重试</button></div>:permissions&&!allows(permissions,"task:assignment:manage")?<p>当前身份没有临时任务发布权限。</p>:<section className="wp-panel bp-form"><strong>选择发布基地</strong><p className="section-note">按 PC 管理范围选择基地后配置触达任务。</p>{bases.map(o=><button className="btn btn-ghost" key={o.id} onClick={()=>setScope(o.id)}>{o.name}</button>)}{!bases.length&&<p>当前身份没有可用基地。</p>}</section>}
  </main><MobileBottomNav/></div></div>;
}

type RecordPage = Awaited<ReturnType<typeof service.records>>;
function createDetailCache() {
  return {
    pages: createPublishCache<RecordPage>(),
    snapshots: createPublishCache<RecordPage>(),
    answers: createPublishCache<Awaited<ReturnType<typeof service.answers>>>(60_000, 100),
  };
}
function Results({id,ended,cache}:{id:string;ended:boolean;cache:ReturnType<typeof createDetailCache>}) {
  const initial = cache.snapshots.read(id);
  const [rows,setRows]=useState<RecordPage["items"]>(initial?.items||[]),[more,setMore]=useState(initial?.hasMore||false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [answers,setAnswers]=useState<Record<string,Awaited<ReturnType<typeof service.answers>>>>({});
  const alive=useRef(true),pending=useRef(false);
  async function load(){if(pending.current)return;pending.current=true;setBusy(true);setError("");try{const data=await cache.pages.get(`${id}:${rows.length}`,()=>service.records(id,rows.length));const items=[...rows,...data.items];cache.snapshots.write(id,{items,hasMore:data.hasMore});if(alive.current){setRows(items);setMore(data.hasMore);}}catch(e){if(alive.current)setError(msg(e));}finally{pending.current=false;if(alive.current)setBusy(false);}}
  useEffect(()=>{alive.current=true;if(!initial)void load();return()=>{alive.current=false;};},[]);
  return <div className="list">{rows.map(r=><details key={r.id} className="tp-person" onToggle={async e=>{if(!e.currentTarget.open||answers[r.id])return;try{const data=await cache.answers.get(r.id,()=>service.answers(r.id));if(alive.current)setAnswers(old=>({...old,[r.id]:data}));}catch(e){if(alive.current)setError(msg(e));}}}><summary><span className="tp-avatar">{r.subjectName.slice(0,1)}</span><strong>{r.subjectName}</strong><span className={`tag ${r.status==="submitted"?"tag-green":ended?"tag-slate":"tag-blue"}`}>{r.status==="submitted"?"已完成":ended?"未完成":r.status==="in_progress"?"进行中":"待完成"}</span><ChevronDown size={14}/></summary>{answers[r.id]?.items.map((q,i)=><div key={q.taskItemId} className="tp-answer"><QuestionHeading index={i} type={q.itemType} required={q.isRequired} done={q.done}/><strong className="tp-question-title">{q.title}</strong><p className="tp-answer-value">{q.itemType==="LINK"?q.isLinkConfirmed?"已确认":"未确认":q.itemType==="FILL_BLANK"?q.done?"已确认":"未确认":q.answerOptions?.join("、")||q.answerText||"未填写"}</p>{q.attachments?.map(a=><a key={a.id} href={a.fileUrl.startsWith("/uploads/")?`/api${a.fileUrl}`:a.fileUrl} target="_blank" rel="noreferrer">{a.fileName||"查看图片"}</a>)}</div>)}</details>)}{busy&&<p role="status">加载中…</p>}{error&&<p role="alert">{error}</p>}{(more||error)&&<button className="btn btn-ghost" disabled={busy} onClick={()=>void load()}>加载更多 / 重试</button>}</div>;
}

function Publisher({scope,orgs,permissions,changeScope}:{scope:string;orgs:Org[];permissions:string[];changeScope:()=>void}) {
  const identity=useAuthStore(s=>s.currentIdentity),identityId=identity?.id;
  const [tab,setTab]=useState("new"),[phase,setPhase]=useState(0),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [title,setTitle]=useState(""),[description,setDescription]=useState(""),[deadline,setDeadline]=useState("");
  const [questions,setQuestions]=useState<PublishQuestion[]>([blank()]),[templateId,setTemplateId]=useState(""),[editable,setEditable]=useState(allows(permissions,"task:template:manage")),[assignmentId,setAssignmentId]=useState("");
  const [selected,setSelected]=useState<Account[]>([]),[keyword,setKeyword]=useState(""),[accounts,setAccounts]=useState<Account[]>([]),[accountPage,setAccountPage]=useState(0),[accountMore,setAccountMore]=useState(false),[searching,setSearching]=useState(false);
  const [preview,setPreview]=useState<Preview|null>(null),[countdown,setCountdown]=useState(5),[busy,setBusy]=useState(false);
  const [status,setStatus]=useState("active"),[assignments,setAssignments]=useState<Assignment[]>([]),[listMore,setListMore]=useState(false),[opened,setOpened]=useState("");
  const [deleting,setDeleting]=useState<number|null>(null);
  const listCache=useRef(createPublishCache<{items:Assignment[];more:boolean}>());
  const detailCache=useRef(createDetailCache());
  function invalidateCache(){listCache.current.clear();detailCache.current=createDetailCache();setOpened("");}
  const alive=useRef(true),locked=useRef(false),searchVersion=useRef(0),listVersion=useRef(0),cachedTemplate=useRef("");
  const valid=()=>alive.current&&useAuthStore.getState().currentIdentity?.id===identityId;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;searchVersion.current++;listVersion.current++;};},[]);
  const base=orgs.find(o=>o.id===scope);
  useEffect(()=>{if(phase!==3)return;setCountdown(5);const timer=setInterval(()=>setCountdown(n=>Math.max(0,n-1)),1000);return()=>clearInterval(timer);},[phase]);
  async function search(page:number,v:number){setSearching(true);try{const data=await service.accounts(scope,keyword.trim(),page);if(valid()&&v===searchVersion.current){setAccounts(old=>page===1?data.items:[...old,...data.items]);setAccountPage(page);setAccountMore(page*20<data.total);}}catch(e){if(valid()&&v===searchVersion.current)setError(msg(e));}finally{if(valid()&&v===searchVersion.current)setSearching(false);}}
  useEffect(()=>{const v=++searchVersion.current;setAccounts([]);setAccountMore(false);setSearching(false);if(keyword.trim().length<2)return;const timer=setTimeout(()=>void search(1,v),300);return()=>clearTimeout(timer);},[keyword]);
  async function loadList(offset=0){
    const v=++listVersion.current;setBusy(true);setError("");
    try{const data=await service.list(scope,status,offset);if(valid()&&v===listVersion.current){
      const items=offset?[...assignments,...data]:data;
      listCache.current.write(status,{items,more:data.length===10});
      setAssignments(items);setListMore(data.length===10);
    }}catch(e){if(valid()&&v===listVersion.current)setError(msg(e));}
    finally{if(valid()&&v===listVersion.current)setBusy(false);}
  }
  useEffect(()=>{
    listVersion.current++;setOpened("");setError("");setBusy(false);
    const cached=listCache.current.read(status);
    setAssignments(cached?.items||[]);setListMore(cached?.more||false);
    if(tab==="issued"&&!cached)void loadList();
  },[tab,status]);
  async function withBusy(fn:()=>Promise<void>){if(locked.current)return;locked.current=true;setBusy(true);setError("");try{await fn();}catch(e){if(valid())setError(msg(e));}finally{locked.current=false;if(valid())setBusy(false);}}
  function validate(){if(!title.trim())return "请填写任务标题";if(!deadline||!Number.isFinite(new Date(deadline).getTime()))return "请选择截止时间";if(!selected.length)return "请搜索并选择至少一个接收账号";if(!questions.length)return "请至少添加一道题目";for(const q of questions){if(!q.title.trim())return "请填写题目标题";if(q.itemType.includes("CHOICE")&&q.options.filter(o=>o.trim()).length<2)return "选择题至少填写两个选项";if(q.itemType==="LINK"&&!q.linkUrl?.trim())return "请填写学习链接";}return "";}
  async function save(){const problem=validate();if(problem)throw new Error(problem);let tid=templateId||cachedTemplate.current;if(editable){const t=await service.saveTemplate(scope,title.trim(),description,questions,tid||undefined);if(!valid())throw new Error("身份已切换");tid=t.id;cachedTemplate.current=tid;setTemplateId(tid);}if(!tid)throw new Error("请选择任务模板");const a=await service.save({assignmentId:assignmentId||undefined,templateId:tid,scopeOrgId:scope,targetUserIds:selected.map(p=>p.id),deadlineAt:new Date(deadline).toISOString(),preDeadlineConfirmEnabled:false});if(!valid())throw new Error("身份已切换");setAssignmentId(a.id);return a.id;}
  function update(i:number,patch:Partial<PublishQuestion>){setQuestions(old=>old.map((q,j)=>i===j?{...q,...patch}:q));}
  const canTemplate=allows(permissions,"task:template:manage");
  return <div className="page-shell"><div className="mobile-page bottom-safe wp-page bp-page tp-page"><PublishHeader title="临时·触达式" icon={<Send size={19}/>} back disabled={busy}/><main className="wp-content">
    <div className="bp-recipient-summary"><span>发布基地：{base?.name}</span>{["DEV_ADMIN","HQ_ADMIN"].includes(identity?.roleCode||"")&&<button className="btn btn-ghost" disabled={busy} onClick={()=>{if(!title||window.confirm("切换基地将清空当前未保存内容，继续吗？"))changeScope();}}>切换基地</button>}</div>
    <div className="wp-tabs">{["new","issued"].map(t=><button key={t} aria-pressed={tab===t} disabled={busy} onClick={()=>setTab(t)}>{t==="new"?"新建触达任务":"我发布的"}</button>)}</div>
    {tab==="issued"?<div className="list"><div className="wp-issued-filters">{[["active","进行中"],["ended,deleted","已结束"]].map(([v,t])=><button key={v} aria-pressed={status===v} onClick={()=>setStatus(v)}>{t}</button>)}</div>{assignments.map(a=><section className={`wp-panel tp-task ${a.status==="active"?"tp-task-active":""}`} key={a.id}><button className="bp-record-toggle" aria-expanded={opened===a.id} onClick={()=>setOpened(opened===a.id?"":a.id)}><strong>{a.template?.title||"触达任务"}</strong><span className={`tag ${a.status==="active"?"task-status-active":"tag-slate"}`}>{a.status==="active"?"进行中":"已结束"}</span>{opened===a.id?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button><small className="section-note">截止 {a.deadlineAt?new Date(a.deadlineAt).toLocaleString("zh-CN"):"未设置"}</small>{opened===a.id&&<><Results key={a.id} id={a.id} ended={a.status!=="active"} cache={detailCache.current}/>{a.status==="active"&&<button className="btn btn-ghost" disabled={busy} onClick={()=>{if(window.confirm("确认终止任务？执行端将停止填写。"))void withBusy(async()=>{await service.action(a.id,scope,"close");if(valid()){invalidateCache();await loadList();}});}}>终止任务</button>}</>}</section>)}{busy&&<p role="status">加载中…</p>}{!busy&&!assignments.length&&<p className="section-note">当前分类暂无任务</p>}{listMore&&<button disabled={busy} className="btn btn-ghost" onClick={()=>void loadList(assignments.length)}>加载更多（10条）</button>}<button className="btn btn-ghost" disabled={busy} onClick={()=>{invalidateCache();void loadList();}}>刷新</button></div>:<>
    <ol className="wp-phases">{["基本信息","接收账号","配置题目","预览发布"].map((t,i)=><li key={t} aria-current={phase===i?"step":undefined}>{i+1} {t}</li>)}</ol>
    {phase===0&&<section className="wp-panel bp-form">{!editable&&canTemplate&&<button className="btn btn-ghost" onClick={()=>{setEditable(true);setTemplateId("");cachedTemplate.current="";}}>编辑任务内容</button>}{!canTemplate&&!templateId&&<p>当前身份没有新建任务内容的权限。</p>}<label>任务标题 *<input className="input" disabled={!editable||!canTemplate} value={title} placeholder="请输入任务标题" onChange={e=>setTitle(e.target.value)}/></label><label>任务说明<textarea className="input" rows={3} disabled={!editable||!canTemplate} value={description} onChange={e=>setDescription(e.target.value)}/></label><div><strong>截止时间 *</strong><MobileDateTimePicker value={deadline} onChange={setDeadline}/></div></section>}
    {phase===1&&<><section className="wp-panel bp-form"><strong>指定账号 · 已选 {selected.length} 人</strong><div className="bp-chips">{selected.map(p=><button key={p.id} onClick={()=>setSelected(old=>old.filter(v=>v.id!==p.id))}>{p.nickname||p.phone} ×</button>)}</div><input className="input" value={keyword} maxLength={80} onChange={e=>setKeyword(e.target.value)} placeholder="输入姓名、手机号或抖音号搜索"/>{accounts.map(p=><label className="bp-person" key={p.id}><input type="checkbox" checked={selected.some(v=>v.id===p.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,p]:old.filter(v=>v.id!==p.id))}/><span>{p.nickname}<small>{p.phone}</small></span></label>)}{searching&&<p>搜索中…</p>}{accountMore&&<button disabled={searching} className="btn btn-ghost" onClick={()=>void search(accountPage+1,searchVersion.current)}>更多账号</button>}</section></>}
    {phase===2&&<><div className="bp-recipient-summary"><span>已选接收账号 {selected.length} 人</span><button className="btn btn-ghost" onClick={()=>setPhase(1)}>修改账号</button></div>{questions.map((q,i)=><section key={i} className="wp-panel bp-form"><div className="wp-question-header"><strong>题目 {i+1}</strong><select value={q.itemType} disabled={!editable} aria-label={`题目${i+1}类型`} onChange={e=>{const itemType=e.target.value as PublishQuestion["itemType"];update(i,{itemType,options:itemType.includes("CHOICE")?q.options.length>=2?q.options:["",""]:[]});}}>{Object.entries(kinds).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select><label className="wp-required"><input type="checkbox" disabled={!editable} checked={q.isRequired} onChange={e=>update(i,{isRequired:e.target.checked})}/>必填</label>{editable&&<button className="wp-delete-question" aria-label={`删除题目${i+1}`} onClick={()=>setDeleting(i)}><Trash2 size={16}/></button>}</div><input className="input" disabled={!editable} value={q.title} placeholder="请输入题目内容" onChange={e=>update(i,{title:e.target.value})}/>{q.itemType.includes("CHOICE")&&<div>{q.options.map((o,n)=><div className="wp-option-row" key={n}><input className="input" disabled={!editable} value={o} placeholder={`选项${n+1}`} onChange={e=>update(i,{options:q.options.map((v,j)=>j===n?e.target.value:v)})}/>{editable&&<button disabled={q.options.length<=2} onClick={()=>update(i,{options:q.options.filter((_,j)=>j!==n)})} aria-label={`删除选项${n+1}`}><Trash2 size={16}/></button>}</div>)}{editable&&<button className="btn btn-ghost wp-add-option" onClick={()=>update(i,{options:[...q.options,""]})}>＋添加选项</button>}</div>}{q.itemType==="LINK"&&<input className="input" disabled={!editable} value={q.linkUrl||""} placeholder="学习链接" onChange={e=>update(i,{linkUrl:e.target.value})}/ >}{q.itemType==="ATTACHMENT"&&<small>执行人上传图片，沿用普通待办的图片规则。</small>}</section>)}{editable&&<button className="btn btn-ghost" onClick={()=>setQuestions(old=>[...old,blank()])}>＋添加题目</button>}</>}
    {phase===3&&preview&&<section className="wp-panel tp-preview"><div className="wp-preview-heading"><h2>{title}</h2><span>截止 {deadline.replace("T"," ")}</span></div>{description&&<p className="wp-preview-description">{description}</p>}<div className="wp-publish-check"><strong>系统核对：共 {preview.subjectCount??preview.totalTargets} 个接收账号</strong><div>{preview.subjectSummaries.map((p,i)=><span key={i}>{p.subjectName}</span>)}</div></div>{questions.map((q,i)=><div className="tp-preview-question" key={i}><QuestionHeading index={i} type={q.itemType} required={q.isRequired}/><p className="wp-preview-question-title">{q.title}</p>{q.itemType.includes("CHOICE")&&<ul className="wp-preview-options">{q.options.filter(o=>o.trim()).map((o,n)=><li key={n}><span className={q.itemType==="MULTI_CHOICE"?"square":""}/>{o}</li>)}</ul>}{q.itemType==="LINK"&&<p className="wp-preview-answer">{q.linkUrl}</p>}</div>)}</section>}
    <div className="bp-actions">{phase>0&&<button className="btn btn-ghost" disabled={busy} onClick={()=>setPhase(n=>n-1)}>上一步</button>}<button className="btn btn-primary" disabled={busy||(phase===3&&countdown>0)} onClick={()=>{if(phase===0){if(!title.trim()||!deadline)setError("请填写任务标题和截止时间");else setPhase(1);}else if(phase===1){if(!selected.length)setError("请搜索并选择至少一个接收账号");else setPhase(2);}else if(phase===2)void withBusy(async()=>{const id=await save();if(!valid())return;const p=await service.preview(id,scope);if(valid()){setPreview(p);setPhase(3);}});else void withBusy(async()=>{if(countdown||!assignmentId)return;await service.publish(assignmentId,scope);if(valid()){invalidateCache();setNotice("触达任务发布成功");setAssignmentId("");setTemplateId("");cachedTemplate.current="";setTitle("");setDescription("");setQuestions([blank()]);setSelected([]);setDeadline("");setPreview(null);setEditable(canTemplate);setPhase(0);setStatus("active");setTab("issued");}});}}>{busy?"处理中…":phase===0?"下一步：接收账号":phase===1?"下一步：配置题目":phase===2?"预览任务":countdown?`请核对（${countdown}秒）`:"确认发布"}</button></div>
    </>}
    </main>{!busy&&<MobileBottomNav/>}{(error||notice)&&<PublishFeedback message={error||notice} success={false} onClose={()=>{setError("");setNotice("");}}/>}{deleting!==null&&<PublishFeedback message={`删除题目 ${deleting+1}？`} success={false} onClose={()=>setDeleting(null)} onConfirm={()=>{setQuestions(old=>old.filter((_,i)=>i!==deleting));setDeleting(null);}}/>}</div></div>;
}
