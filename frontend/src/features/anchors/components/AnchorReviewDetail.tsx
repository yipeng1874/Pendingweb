import type { AnchorApplication, OrgUnit } from "../../../types";
import type { ReviewDraft, ReviewStatus } from "../types";
import { TextField } from "../../../shared/components/form/TextField";

interface AnchorReviewDetailProps {
  activeApp?: AnchorApplication;
  activeDraft?: ReviewDraft;
  reviewStatus: ReviewStatus;
  orgMap: Map<string, OrgUnit>;
  onDraftChange: (draft: ReviewDraft) => void;
  onReview: (app: AnchorApplication, approved: boolean) => void;
}

function describeOrg(org?: OrgUnit) {
  return org ? `${org.name}（${org.orgCode}）` : "未识别";
}

function describeOrgPath(app: AnchorApplication, orgMap: Map<string, OrgUnit>) {
  const hall = orgMap.get(app.targetHallOrgId) ?? app.hall;
  const team = (hall?.parentId ? orgMap.get(hall.parentId) : undefined) ?? app.teamOrg ?? undefined;
  const base = (team?.parentId ? orgMap.get(team.parentId) : undefined) ?? app.baseOrg ?? undefined;
  return [base?.name, team?.name, hall?.name].filter(Boolean).join(" / ") || "未识别";
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}

export function AnchorReviewDetail({
  activeApp,
  activeDraft,
  reviewStatus,
  orgMap,
  onDraftChange,
  onReview,
}: AnchorReviewDetailProps) {
  if (!activeApp || !activeDraft) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-400">
        请先从左侧列表选择一条审核记录
      </div>
    );
  }

  const hall = orgMap.get(activeApp.targetHallOrgId) ?? activeApp.hall;
  const team = (hall?.parentId ? orgMap.get(hall.parentId) : undefined) ?? activeApp.teamOrg ?? undefined;
  const base = (team?.parentId ? orgMap.get(team.parentId) : undefined) ?? activeApp.baseOrg ?? undefined;
  const orgPathCN = describeOrgPath(activeApp, orgMap);
  return (
    <>
      <div className="flex items-center justify-end">
        <span className={`rounded-full px-3 py-1 text-xs ${activeApp.status === "pending" ? "bg-amber-50 text-amber-700" : activeApp.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {activeApp.status === "pending" ? "待审核" : activeApp.status === "approved" ? "已通过" : "已驳回"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4">
        <DetailRow label="申请人昵称" value={activeApp.anchorNickname} />
        <DetailRow label="手机号" value={activeApp.user?.phone || "未加载"} />
        <DetailRow label="账号状态" value={activeApp.user?.status || "未加载"} />
        <DetailRow label="基地" value={describeOrg(base)} />
        <DetailRow label="团队" value={describeOrg(team)} />
        <DetailRow label="厅" value={describeOrg(hall)} />
        <DetailRow label="中文路径" value={orgPathCN} />
        <DetailRow label="申请时间" value={new Date(activeApp.submittedAt).toLocaleString()} />
        <DetailRow label="审核时间" value={activeApp.reviewedAt ? new Date(activeApp.reviewedAt).toLocaleString() : "尚未审核"} />
      </div>

      {reviewStatus === "pending" ? (
        <>
          <div className="mt-5 grid gap-3">
            <TextField
              label="审核后账号昵称"
              value={activeDraft.anchorNickname}
              onChange={(val) => onDraftChange({ ...activeDraft, anchorNickname: val })}
            />
            <TextField
              label="抖音号"
              value={activeDraft.douyinNo}
              onChange={(val) => onDraftChange({ ...activeDraft, douyinNo: val })}
            />
            <TextField
              label="抖音 UID"
              value={activeDraft.douyinUid}
              onChange={(val) => onDraftChange({ ...activeDraft, douyinUid: val })}
            />
          </div>
          <div className="mt-5 flex gap-2">
            <button className="rounded-xl bg-feishu-blue px-4 py-2 text-sm font-medium text-white" onClick={() => onReview(activeApp, true)}>通过并开通账号</button>
            <button className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600" onClick={() => onReview(activeApp, false)}>驳回</button>
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-600">
          <p>审核结果：{activeApp.status === "approved" ? "已通过" : "已驳回"}</p>
          <p className="mt-1">抖音号：{activeApp.douyinNo || "未填写"}</p>
          <p className="mt-1">抖音 UID：{activeApp.douyinUid?.startsWith("pending-") ? "待审核补充" : activeApp.douyinUid}</p>
        </div>
      )}
    </>
  );
}
