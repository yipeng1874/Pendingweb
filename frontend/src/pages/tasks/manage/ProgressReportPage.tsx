import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BarChart3, CheckCircle2, ChevronDown, Clock, Users2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import type { AssignmentDailyReportItem, AssignmentProgressReport, TaskAssignment } from "../../../types";
import { assignmentApi, reportApi } from "../../../services/task";
import { orgTypeMeta } from "../../../shared/constants/org";
import { recordSubjectMeta, temporaryModeMeta } from "../../../shared/constants/taskTemporary";

function RingProgress({ value, size = 90 }: { value: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E2E8F0" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#4C72FF" strokeWidth={7} strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" className="transition-all duration-700" />
    </svg>
  );
}

const statusMeta: Record<string, { cls: string; text: string }> = {
  submitted: { cls: "bg-emerald-50 text-emerald-600", text: "已完成" },
  in_progress: { cls: "bg-blue-50 text-blue-600", text: "进行中" },
  pending: { cls: "bg-slate-100 text-slate-500", text: "待开始" },
  overdue: { cls: "bg-red-50 text-red-600", text: "已逾期" },
};

function formatDateTime(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTaskDate(date: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!matched) return date;
  return `${matched[2]}-${matched[3]}`;
}

export function ProgressReportPage() {
  const [searchParams] = useSearchParams();
  const defaultId = searchParams.get("assignmentId") ?? "";
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [selectedId, setSelectedId] = useState(defaultId);
  const [report, setReport] = useState<AssignmentProgressReport | null>(null);
  const [dailyRows, setDailyRows] = useState<AssignmentDailyReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    assignmentApi.list().then(setAssignments).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setReport(null);
      return;
    }
    setLoading(true);
    reportApi.getProgress(selectedId).then(setReport).catch(console.error).finally(() => setLoading(false));
  }, [selectedId]);

  const selectedAssignment = useMemo(() => assignments.find((assignment) => assignment.id === selectedId) ?? null, [assignments, selectedId]);

  useEffect(() => {
    if (!selectedId || selectedAssignment?.category !== "DAILY") {
      setDailyRows([]);
      return;
    }
    setDailyLoading(true);
    reportApi.getDaily(selectedId).then(setDailyRows).catch(console.error).finally(() => setDailyLoading(false));
  }, [selectedAssignment?.category, selectedId]);

  const subjectTypeCounts = useMemo(() => ({ user: report?.records.filter((record) => record.subjectType === "USER").length ?? 0, org: report?.records.filter((record) => record.subjectType === "ORG").length ?? 0 }), [report]);
  const tempMode = selectedAssignment?.temporaryMode ? temporaryModeMeta[selectedAssignment.temporaryMode] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">进度报表</h1>
        <p className="mt-1 text-sm text-slate-500">区分账号主体与组织主体，查看临时任务或主播日常任务的完成情况。</p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="relative">
          <select className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-400" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">— 选择发放任务 —</option>
            {assignments.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>{assignment.template?.title ?? assignment.id}（{assignment.category === "DAILY" ? "日常" : `${temporaryModeMeta[assignment.temporaryMode ?? "ACCOUNT"].label}`} · {new Date(assignment.createdAt).toLocaleDateString("zh-CN")}）</option>
            ))}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      {loading && <div className="py-10 text-center text-sm text-slate-400">加载报表中...</div>}

      {report && !loading && selectedAssignment && (
        <div className="space-y-5">
          <section className="grid gap-4 rounded-[28px] border border-slate-200 bg-gradient-to-br from-white via-[#f8fbff] to-[#eef4ff] p-6 shadow-[0_16px_50px_rgba(76,114,255,0.08)] xl:grid-cols-[220px_minmax(0,1fr)]">
            <div className="flex flex-col items-center justify-center rounded-3xl border border-white/70 bg-white/80 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur">
              <div className="relative"><RingProgress value={report.completionRate} size={98} /><div className="absolute inset-0 flex items-center justify-center"><span className="text-2xl font-bold text-slate-900">{report.completionRate}%</span></div></div>
              <p className="mt-3 text-xs text-slate-500">完成率</p>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{selectedAssignment.category === "DAILY" ? "主播日常任务" : "临时任务"}</span>
                {tempMode && <span className={`rounded-full px-2 py-1 text-xs font-medium ${tempMode.badge}`}>{tempMode.label}</span>}
                {selectedAssignment.temporaryMode === "MANAGER" && selectedAssignment.temporarySubjectOrgType && <span className={`rounded-full px-2 py-1 text-xs font-medium ${orgTypeMeta[selectedAssignment.temporarySubjectOrgType].badge}`}>{orgTypeMeta[selectedAssignment.temporarySubjectOrgType].label}主体</span>}
              </div>
              <h2 className="mt-3 text-2xl font-bold text-slate-900">{selectedAssignment.template?.title ?? "未命名任务"}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-500">{selectedAssignment.category === "DAILY" ? "主播日常任务默认按账号主体统计完成情况，按任务日期汇总时会在次日16:00正式封单。" : `本次临时任务按${selectedAssignment.temporaryMode === "MANAGER" ? `${orgTypeMeta[(selectedAssignment.temporarySubjectOrgType as "TEAM" | "HALL" | null) ?? "TEAM"].label}主体` : "账号主体"}统计进度，同时保留可见身份与实际提交时间。`}</p>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl bg-emerald-50 p-4"><div className="mb-2 flex items-center gap-2 text-emerald-600"><CheckCircle2 size={14} />已完成</div><p className="text-2xl font-bold text-emerald-700">{report.submitted}</p><p className="mt-1 text-xs text-emerald-600">共 {report.total} 个主体</p></div>
                <div className="rounded-2xl bg-orange-50 p-4"><div className="mb-2 flex items-center gap-2 text-orange-600"><Clock size={14} />进行中</div><p className="text-2xl font-bold text-orange-600">{report.inProgress}</p><p className="mt-1 text-xs text-orange-500">待继续推进</p></div>
                <div className="rounded-2xl bg-violet-50 p-4"><div className="mb-2 flex items-center gap-2 text-violet-600"><Users2 size={14} />组织主体</div><p className="text-2xl font-bold text-violet-600">{subjectTypeCounts.org}</p><p className="mt-1 text-xs text-violet-500">账号主体 {subjectTypeCounts.user}</p></div>
                <div className="rounded-2xl bg-red-50 p-4"><div className="mb-2 flex items-center gap-2 text-red-600"><AlertCircle size={14} />已逾期</div><p className="text-2xl font-bold text-red-600">{report.overdue}</p><p className="mt-1 text-xs text-red-500">逾期率 {report.overdueRate}%</p></div>
              </div>
            </div>
          </section>

          {selectedAssignment.category === "DAILY" && (
            <section className="rounded-3xl border border-slate-100 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2 text-slate-800"><Clock size={16} className="text-blue-500" /><span className="font-semibold">按任务日期汇总</span></div>
                  <p className="mt-1 text-xs text-slate-400">每一行代表一个任务日期；该日期会持续统计到次日 16:00，之后口径固定。</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{dailyRows.length} 天</span>
              </div>
              {dailyLoading ? (
                <div className="px-5 py-10 text-center text-sm text-slate-400">加载日汇总中...</div>
              ) : dailyRows.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-400">暂无按天汇总数据</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500">
                        <th className="px-4 py-3 text-left font-medium">任务日期</th>
                        <th className="px-4 py-3 text-left font-medium">有效主体</th>
                        <th className="px-4 py-3 text-left font-medium">已完成</th>
                        <th className="px-4 py-3 text-left font-medium">已逾期</th>
                        <th className="px-4 py-3 text-left font-medium">已豁免</th>
                        <th className="px-4 py-3 text-left font-medium">完成率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dailyRows.map((row) => {
                        const completionRate = row.total > 0 ? Math.round((row.submitted / row.total) * 100) : 0;
                        return (
                          <tr key={row.date} className="transition hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <div>
                                <p className="font-medium text-slate-800">{formatTaskDate(row.date)}</p>
                                <p className="mt-1 text-xs text-slate-400">{row.date} · 次日16:00封单</p>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{row.total}</td>
                            <td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">{row.submitted}</span></td>
                            <td className="px-4 py-3"><span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">{row.overdue}</span></td>
                            <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{row.exempted}</span></td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-blue-400" style={{ width: `${completionRate}%` }} />
                                </div>
                                <span className="text-xs text-slate-500">{completionRate}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <div className="rounded-3xl border border-slate-100 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <button type="button" onClick={() => setShowDetails((value) => !value)} className="flex w-full items-center justify-between px-5 py-4 text-left">
              <div className="flex items-center gap-2"><BarChart3 size={16} className="text-blue-500" /><span className="font-semibold text-slate-800">主体明细</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{report.records.length} 条</span></div>
              <ChevronDown size={16} className={`text-slate-400 transition-transform ${showDetails ? "rotate-180" : ""}`} />
            </button>
            {showDetails && (
              <div className="border-t border-slate-100">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs text-slate-500"><th className="px-4 py-3 text-left font-medium">完成主体</th><th className="px-4 py-3 text-left font-medium">主体口径</th><th className="px-4 py-3 text-left font-medium">状态</th><th className="px-4 py-3 text-left font-medium">进度</th><th className="px-4 py-3 text-left font-medium">截止时间</th><th className="px-4 py-3 text-left font-medium">最后提交</th><th className="px-4 py-3 text-left font-medium">豁免</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.records.map((record) => {
                        const status = statusMeta[record.status] ?? statusMeta.pending;
                        const subjectMeta = recordSubjectMeta[record.subjectType];
                        const progress = record.totalItems > 0 ? Math.round((record.doneItems / record.totalItems) * 100) : 0;
                        return (
                          <tr key={record.id} className="transition hover:bg-slate-50">
                            <td className="px-4 py-3"><div className="min-w-[180px]"><p className="font-medium text-slate-800">{record.subjectName ?? record.user?.nickname ?? "—"}</p><p className="mt-1 text-xs text-slate-400">{record.subjectType === "ORG" ? record.subjectOrgType ? `${orgTypeMeta[record.subjectOrgType].label}协同主体` : "组织主体" : record.user?.phone ?? "账号主体"}</p></div></td>
                            <td className="px-4 py-3"><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${subjectMeta.badge}`}>{subjectMeta.label}</span>{record.subjectType === "ORG" && record.subjectOrgType && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${orgTypeMeta[record.subjectOrgType].badge}`}>{orgTypeMeta[record.subjectOrgType].label}</span>}</div></td>
                            <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>{status.text}</span></td>
                            <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-400" style={{ width: `${progress}%` }} /></div><span className="text-xs text-slate-500">{record.doneItems}/{record.totalItems}</span></div></td>
                            <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(record.deadlineAt)}</td>
                            <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(record.lastSubmittedAt ?? record.submittedAt ?? undefined)}</td>
                            <td className="px-4 py-3">{record.exemptionStatus ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${record.exemptionStatus === "approved" ? "bg-slate-100 text-slate-400" : record.exemptionStatus === "pending" ? "bg-yellow-50 text-yellow-600" : "bg-red-50 text-red-500"}`}>{record.exemptionStatus === "approved" ? "已豁免" : record.exemptionStatus === "pending" ? "申请中" : "已驳回"}</span> : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!selectedId && !loading && <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 py-16 text-slate-400"><BarChart3 size={36} className="mb-3 text-slate-200" /><p className="text-sm">请先选择一个发放任务查看报表</p></div>}
    </div>
  );
}
