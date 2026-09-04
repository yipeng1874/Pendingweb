import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter,Routes,Route} from "react-router-dom";
import {TemporaryPublishPage} from "../src/pages/TemporaryPublishPage";
import {useAuthStore} from "../src/stores/auth";
import "../src/styles.css";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
useAuthStore.persist.setOptions({storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
useAuthStore.setState({token:"mock",currentIdentity:{id:"manager",userId:"owner",roleCode:"BASE_ADMIN",orgId:"base",scopePath:"/base",org:{id:"base",name:"测试基地",orgType:"BASE"}}});
const logs:string[]=[],requests:string[]=[],drafts:any[]=[];let template:any,published=0,fail=true;
const check=(v:unknown,t:string)=>{if(!v)throw new Error(t);logs.push(`通过：${t}`);};
window.fetch=async(url,init={})=>{const p=String(url);requests.push(p);const ok=(data:unknown)=>new Response(JSON.stringify({success:true,data}));
 if(p.endsWith("/me/permissions"))return ok(useAuthStore.getState().currentIdentity?.roleCode==="ANCHOR"?[]:["*"]);
 if(p.endsWith("/orgs/tree"))return ok([{id:"base",name:"测试基地",orgType:"BASE",path:"/base",status:"active"},{id:"team",name:"一团队",orgType:"TEAM",path:"/base/team",parentId:"base",status:"active"}]);
 if(p.includes("/accounts/search?"))return ok({items:[{id:"person",nickname:"测试接收人",phone:"13800000000"}],total:1});
 if(p.includes("/tasks/templates")&&["POST","PATCH"].includes(init.method||"")){template={...JSON.parse(String(init.body)),id:"template",status:"draft"};return ok(template);}
 if(p.includes("/tasks/templates/template"))return ok(template);
 if(p.endsWith("/temporary-drafts")){const b=JSON.parse(String(init.body));drafts.push(b);return ok({...b,id:"draft",status:"draft",template,targets:b.orgIds.map((orgId:string)=>({orgId}))});}
 if(p.includes("/temporary-preview"))return ok({subjectCount:1,totalTargets:1,subjectSummaries:[{subjectName:"测试接收人",visibleIdentityCount:1}]});
 if(p.endsWith("/temporary-publish")){published++;check(new Headers(init.headers).get("X-Identity-Id")==="manager","发布携带当前身份");if(fail){fail=false;return new Response(JSON.stringify({success:false,error:{message:"模拟失败"}}),{status:503});}return ok({});}
 if(p.includes("/tasks/assignments?"))return ok(p.includes("status=draft")?[{...drafts.at(-1),id:"draft",status:"draft",template}]:[]);
 if(p.includes("/tasks/assignments/draft?"))return ok({...drafts.at(-1),id:"draft",status:"draft",template,targets:[{orgId:"team"}]});
 throw new Error(`未预期接口 ${p}`);
};
const root=createRoot(document.getElementById("root")!);
const pause=async(ms=30)=>act(async()=>{await new Promise(r=>setTimeout(r,ms));});
async function click(label:string){const b=Array.from((document.querySelector('[role="dialog"]')||document).querySelectorAll("button")).find(b=>b.textContent?.includes(label)) as HTMLButtonElement;if(!b)throw new Error(`缺少按钮${label}`);await act(async()=>b.click());await pause();}
async function fill(selector:string,value:string){const el=document.querySelector(selector) as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));});}
async function run(){await act(async()=>root.render(<MemoryRouter><Routes><Route path="*" element={<TemporaryPublishPage/>}/></Routes></MemoryRouter>));await pause();
 if(location.search.includes("preview")){document.getElementById("results")!.hidden=true;return;}
 check(!document.body.textContent?.includes("选择已有模板") && !document.body.textContent?.includes("开启二次通知"),"隐藏模板选择和二次通知入口");check(document.body.textContent?.includes("测试基地"),"基地身份自动定位基地");check(!requests.some(p=>p.includes("accounts")),"初始化不加载账号");
 await click("下一步");check(!!document.querySelector('[role="alertdialog"]'),"基本信息校验弹窗");await click("知道了");
 await fill('[placeholder="请输入任务标题"]',"触达验证");await click("请选择截止时间");await click("下一步");await click("确定");await click("下一步");
 await fill('[placeholder="输入姓名、手机号或抖音号搜索"]',"测试");await pause(400);await act(async()=>(document.querySelector('.bp-person input') as HTMLElement).click());
 check(!document.body.textContent?.includes("组织范围"),"移除组织范围入口");await click("下一步");
 check(!document.querySelector('.bp-person'),"题目与接收范围独立步骤");
 for(const [i,type] of ["QA","SINGLE_CHOICE","MULTI_CHOICE","FILL_BLANK","LINK","ATTACHMENT"].entries()){
  if(i)await click("＋添加题目");await fill(`[aria-label="题目${i+1}类型"]`,type);const titles=document.querySelectorAll('[placeholder="请输入题目内容"]');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(titles[i],`题目${i+1}`);titles[i].dispatchEvent(new Event("input",{bubbles:true}));});
  for(const [n,el] of Array.from(document.querySelectorAll('.wp-option-row input')).entries()){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(el,`选项${n}`);el.dispatchEvent(new Event("input",{bubbles:true}));});}
  if(type==="LINK")await fill('[placeholder="学习链接"]',"https://example.com");
 }
 check(!document.body.textContent?.includes("保存草稿"),"不提供保存草稿操作");await click("预览任务");check(drafts[0].preDeadlineConfirmEnabled===false,"保存草稿关闭二次通知");check(drafts[0].mode==="ACCOUNT"&&drafts[0].targetUserIds[0]==="person"&&drafts[0].orgIds.length===0,"触达草稿仅提交账号且组织为空");check(template.items.length===6&&template.items[1].options[0].label,"六种题型转换为PC模板结构");check(document.body.textContent?.includes("共 1 个接收账号"),"预览使用后端去重接收人");check(published===0,"预览不会发布任务");
 await pause(5200);await click("确认发布");check(document.body.textContent?.includes("模拟失败"),"失败保留预览");await click("知道了");await click("确认发布");await click("知道了");check(published===2,"失败后可重试正式发布");
 check(requests.some(p=>p.includes("mode=ACCOUNT")&&p.includes("limit=10")),"记录按模式分页请求");check(!document.body.textContent?.includes("草稿")&&!document.body.textContent?.includes("继续编辑"),"发布记录无草稿入口");
 await act(async()=>useAuthStore.setState({currentIdentity:{id:"anchor",userId:"other",roleCode:"ANCHOR"}}));await pause();check(document.body.textContent?.includes("没有临时任务发布权限"),"无权限身份不可进入且清除草稿");
}
run().then(()=>document.getElementById("results")!.textContent=logs.join("\n")+"\n全部通过").catch(e=>document.getElementById("results")!.textContent=logs.join("\n")+`\n失败：${e.message}`);
