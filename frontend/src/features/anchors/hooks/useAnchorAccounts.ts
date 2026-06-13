import { useEffect, useMemo, useState } from "react";
import { anchorApi } from "../api";
import { useIdentityStore } from "../../../stores/identityStore";
import type { AnchorApplication, OrgUnit } from "../../../types";
import type { Anchor } from "../types";
import { buildOrgTree } from "../../../shared/utils/orgTree";

const PAGE_SIZE = 20;

export function useAnchorAccounts() {
  const currentIdentity = useIdentityStore((state) => state.currentIdentity);
  const canReviewApplications = currentIdentity?.roleCode !== "HALL_MANAGER";
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [apps, setApps] = useState<AnchorApplication[]>([]);
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Anchor>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [anchorPage, setAnchorPage] = useState(1);
  const [anchorTotal, setAnchorTotal] = useState(0);
  const [loadedOrgIds, setLoadedOrgIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void loadRootOrgs();
  }, [currentIdentity?.id, currentIdentity?.roleCode]);

  useEffect(() => {
    void load();
  }, [anchorPage, keyword, status, selectedOrgId]);

  const orgTree = useMemo(() => buildOrgTree(orgs), [orgs]);
  const selectedOrg = useMemo(() => orgs.find((item) => item.id === selectedOrgId), [orgs, selectedOrgId]);
  const approvedApps = useMemo(() => apps.filter((item) => item.status === "approved"), [apps]);
  const detailsByUserId = useMemo(() => new Map(approvedApps.filter((item) => item.userId).map((item) => [item.userId, item])), [approvedApps]);

  async function loadRootOrgs() {
    try {
      const rootChildren = await anchorApi.getOrgChildren({});
      setOrgs(rootChildren);
      setLoadedOrgIds(new Set([""]));
      setSelectedOrgId("");
      setAnchorPage(1);
      setAnchors([]);
      setAnchorTotal(0);
      setApps([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "组织数据加载失败");
    }
  }

  async function loadOrgChildren(parentId: string) {
    if (loadedOrgIds.has(parentId)) return;
    const children = await anchorApi.getOrgChildren(parentId ? { parentId } : {});
    setOrgs((previous) => {
      const existing = new Map(previous.map((item) => [item.id, item]));
      for (const child of children) existing.set(child.id, child);
      return Array.from(existing.values());
    });
    setLoadedOrgIds((previous) => new Set(previous).add(parentId));
  }

  async function selectOrg(orgId: string) {
    setSelectedOrgId(orgId);
    setAnchorPage(1);
    await loadOrgChildren(orgId);
  }

  async function load() {
    if (!selectedOrgId) {
      setAnchors([]);
      setAnchorTotal(0);
      setApps([]);
      return;
    }

    try {
      setError("");
      const params: Record<string, string> = {
        page: String(anchorPage),
        pageSize: String(PAGE_SIZE),
        orgId: selectedOrgId,
      };
      if (keyword) params.keyword = keyword;
      if (status) params.status = status;

      const profilePromise = anchorApi.getProfiles(params);
      const appPromise = canReviewApplications
        ? anchorApi.getApplications({ status: "approved", page: "1", pageSize: "100", targetOrgId: selectedOrgId })
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100 });
      const [profileResult, appResult] = await Promise.all([profilePromise, appPromise]);
      setAnchors(profileResult.items);
      setAnchorTotal(profileResult.total);
      setApps(appResult.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "主播账号数据加载失败");
    }
  }

  async function run(action: () => Promise<unknown>, successText: string) {
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(successText);
      setEditing(undefined);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      return false;
    }
  }

  async function saveProfile() {
    if (!editing) return false;
    return run(async () => {
      await anchorApi.updateProfile(editing.id, editing);
    }, "主播资料已保存");
  }

  async function removeProfile(anchor: Anchor) {
    if (!window.confirm(`确定删除主播档案「${anchor.nickname}」吗？如该账号仍持有管理权限，将禁止删除，请先到组织账号管理中处理权限。`)) return false;
    return run(() => anchorApi.deleteProfile(anchor.id), "主播档案已删除");
  }

  async function resetPassword(app: AnchorApplication) {
    if (!app.userId || !window.confirm(`确认将账号 ${app.user?.phone || app.anchorNickname} 的密码重置为 123456 吗？`)) return false;
    return run(async () => {
      await anchorApi.resetPassword(app.userId);
    }, "账号密码已重置为 123456");
  }


  return {
    orgTree,
    orgs,
    selectedOrg,
    selectedOrgId,
    setSelectedOrgId: selectOrg,
    keyword,
    setKeyword: (value: string) => {
      setKeyword(value);
      setAnchorPage(1);
    },
    status,
    setStatus: (value: string) => {
      setStatus(value);
      setAnchorPage(1);
    },
    editing,
    setEditing,
    message,
    error,
    filteredAnchors: anchors,
    approvedApps,
    detailsByUserId,
    load,
    run,
    saveProfile,
    removeProfile,
    resetPassword,
    anchorPage,
    anchorTotal,
    pageSize: PAGE_SIZE,
    setAnchorPage,
    loadOrgChildren,
  };
}
