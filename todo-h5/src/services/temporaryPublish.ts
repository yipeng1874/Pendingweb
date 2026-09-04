import { api } from "./http";
import type { PublishQuestion } from "./workflowPublish";
export type Org = { id: string; name: string; path: string; parentId?: string; orgType: string; status: string };
export type Account = { id: string; nickname: string; phone: string };
export type Template = { id: string; title: string; description?: string; status: string; items: { id?: string; itemType: PublishQuestion["itemType"]; title: string; isRequired: boolean; linkUrl?: string; options?: { label: string; sortOrder: number }[] }[] };
export type Assignment = { id: string; templateId: string; template?: Template; deadlineAt?: string; status: string; targetUserIds?: string[]; targets?: { orgId: string }[]; preDeadlineConfirmEnabled?: boolean };
export type Preview = { subjectCount: number; totalTargets: number; subjectSummaries: { subjectName: string; visibleIdentityCount: number }[]; orgSummaries?: { orgName: string; total: number }[] };
export const query = (data: Record<string, string | number>) => new URLSearchParams(Object.entries(data).map(([k,v]) => [k,String(v)])).toString();
export const temporaryApi = {
  permissions: () => api.get<string[]>("/me/permissions"),
  orgs: () => api.get<Org[]>("/orgs/tree"),
  templates: (scope: string, offset: number) => api.get<Template[]>(`/tasks/templates?${query({category:"TEMPORARY",scopeOrgId:scope,limit:10,offset})}`),
  template: (id: string, scope: string) => api.get<Template>(`/tasks/templates/${id}?scopeOrgId=${encodeURIComponent(scope)}`),
  saveTemplate: (scope: string, title: string, description: string, questions: PublishQuestion[], id?: string) => {
    const data = { title, description, category:"TEMPORARY", orgId:scope, scopeOrgId:scope, items: questions.map((q,i) => ({...q,sortOrder:i,options:q.options.filter(o=>o.trim()).map((label,j)=>({label:label.trim(),sortOrder:j}))})) };
    return id ? api.patch<Template>(`/tasks/templates/${id}?scopeOrgId=${encodeURIComponent(scope)}`,data) : api.post<Template>("/tasks/templates",data);
  },
  accounts: (scope: string, keyword: string, page: number) => api.get<{items:Account[];total:number}>(`/accounts/search?${query({scopeOrgId:scope,keyword,page,pageSize:20})}`),
  accountsByIds: (scope: string, ids: string[]) => api.get<{items:Account[]}>(`/accounts/search?${query({scopeOrgId:scope,ids:ids.join(",")})}`),
  save: (data: {assignmentId?:string;templateId:string;scopeOrgId:string;targetUserIds:string[];deadlineAt:string;preDeadlineConfirmEnabled:boolean}) => api.post<Assignment>("/tasks/assignments/temporary-drafts",{...data,mode:"ACCOUNT",orgIds:[],excludedOrgIds:[],excludedAnchorProfileIds:[]}),
  preview: (id:string,scope:string) => api.get<Preview>(`/tasks/assignments/${id}/temporary-preview?scopeOrgId=${encodeURIComponent(scope)}`),
  publish: (id:string,scope:string) => api.post(`/tasks/assignments/${id}/temporary-publish`,{scopeOrgId:scope}),
  list: (scope:string,status:string,offset:number) => api.get<Assignment[]>(`/tasks/assignments?${query({scopeOrgId:scope,status,mode:"ACCOUNT",category:"TEMPORARY",offset,limit:10})}`),
  detail: (id:string,scope:string) => api.get<Assignment>(`/tasks/assignments/${id}?scopeOrgId=${encodeURIComponent(scope)}`),
  records: (id:string,offset:number) => api.get<{items:{id:string;subjectName:string;status:string}[];hasMore:boolean}>(`/tasks/report/temporary-dashboard/assignments/${id}/records?limit=10&offset=${offset}`),
  answers: (id:string) => api.get<{items:{taskItemId:string;title:string;itemType:string;isRequired?:boolean;answerText?:string;answerOptions?:string[];isLinkConfirmed?:boolean;done:boolean;attachments:{id:string;fileUrl:string;fileName?:string}[]}[] }>(`/tasks/report/temporary-dashboard/records/${id}/detail`),
  action: (id:string,scope:string,action:"close"|"reopen") => api.post(`/tasks/assignments/${id}/${action}`,{scopeOrgId:scope}),
};
