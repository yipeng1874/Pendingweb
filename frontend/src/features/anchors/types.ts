import type { OrgUnit } from "../../types";

export type AnchorStatus = "unbound" | "bound" | "inactive";

export type Anchor = {
  id: string;
  nickname: string;
  douyinNo?: string;
  douyinUid: string;
  hallOrgId: string;
  boundUserId?: string;
  status: AnchorStatus;
  hallOrg?: OrgUnit;
  boundUser?: { id: string; phone: string; nickname: string; status: string } | null;
};

export type ReviewStatus = "pending" | "approved" | "rejected";
export type ReviewDraft = {
  anchorNickname: string;
  douyinUid: string;
  douyinNo: string;
  profileId: string;
};

