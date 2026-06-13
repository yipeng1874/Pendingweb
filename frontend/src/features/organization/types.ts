import type { OrgUnit } from "../../types";

export type OrgType = OrgUnit["orgType"];

export type OrgForm = {
  name: string;
  orgCode: string;
  principalName: string;
  contactPhone: string;
  douyinNo: string;
  douyinUid: string;
  brokerName: string;
  remark: string;
};

export type BatchHallRow = Omit<OrgForm, "orgCode">;
