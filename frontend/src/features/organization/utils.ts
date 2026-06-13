import type { OrgUnit } from "../../types";
import type { OrgForm, OrgType, BatchHallRow } from "./types";
import { requiredHallKeys } from "./constants";

export function toOrgForm(org: OrgUnit): OrgForm {
  return {
    name: org.name ?? "",
    orgCode: org.orgCode ?? "",
    principalName: org.principalName ?? "",
    contactPhone: org.contactPhone ?? "",
    douyinNo: org.douyinNo ?? "",
    douyinUid: org.douyinUid ?? "",
    brokerName: org.brokerName ?? "",
    remark: org.remark ?? "",
  };
}

export function isHallFormValid(form: OrgForm) {
  return Boolean(form.name.trim() && requiredHallKeys.every((key) => form[key].trim()));
}

export function isOrgCodeGenerated(orgType?: OrgType) {
  return orgType === "TEAM" || orgType === "HALL";
}

export function previewHallOrgCode(douyinUid: string) {
  const normalized = douyinUid.replace(/\\s/g, "").trim();
  return normalized ? `HALL-${normalized}` : "填写厅抖音 UID 后自动生成";
}

export function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseBatchHallText(text: string): BatchHallRow[] {
  const lines = text.replace(/^\\uFEFF/, "").split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((item) => item.replace(/\\s/g, ""));
  const map: Record<string, keyof BatchHallRow> = {
    组织名称: "name",
    厅名称: "name",
    名称: "name",
    负责人: "principalName",
    联系电话: "contactPhone",
    厅抖音号: "douyinNo",
    抖音号: "douyinNo",
    厅抖音UID: "douyinUid",
    抖音UID: "douyinUid",
    运营经纪人: "brokerName",
    备注: "remark",
  };
  const keys = header.map((item) => map[item]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return keys.reduce<BatchHallRow>((row, key, index) => {
      if (key) row[key] = cells[index] ?? "";
      return row;
    }, { name: "", principalName: "", contactPhone: "", douyinNo: "", douyinUid: "", brokerName: "", remark: "" });
  });
}
