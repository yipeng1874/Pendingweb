import { useState, useMemo, useEffect, useCallback } from "react";
import { anchorApi } from "../api";
import { api } from "../../../services/http";
import { useIdentityStore } from "../../../stores/identityStore";
import type { AnchorApplication, OrgUnit } from "../../../types";
import type { ReviewDraft, ReviewStatus } from "../types";
import { buildOrgTree } from "../../../shared/utils/orgTree";

const PAGE_SIZE = 20;

export function makeDraft(app: AnchorApplication): ReviewDraft {
  return {
    anchorNickname: app.anchorNickname,
    douyinUid: app.douyinUid.startsWith("pending-") ? "" : app.douyinUid,
    douyinNo: app.douyinNo || "",
    profileId: "",
  };
}

export function useAnchorReviews() {
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [apps, setApps] = useState<AnchorApplication[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("pending");
  const [keyword, setKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeAppId, setActiveAppId] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadedOrgIds, setLoadedOrgIds] = useState<Set<string>>(new Set());

  const orgTree = useMemo(() => buildOrgTree(orgs), [orgs]);
  const orgMap = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs]);

  const filteredApps = useMemo(() => apps, [apps]);

  const activeApp = useMemo(() => apps.find((app) => app.id === activeAppId), [apps, activeAppId]);

  const loadRootOrgs = useCallback(async () => {
    const rootChildren = await anchorApi.getOrgChildren({});
    setOrgs(rootChildren);
    setLoadedOrgIds(new Set([""]));
    setSelectedOrgId("");
    setPage(1);
    setApps([]);
    setTotal(0);
  }, []);

  const loadOrgChildren = useCallback(async (parentId: string) => {
    if (loadedOrgIds.has(parentId)) return;
    const children = await anchorApi.getOrgChildren(parentId ? { parentId } : {});
    setOrgs((previous) => {
      const next = new Map(previous.map((item) => [item.id, item]));
      for (const child of children) next.set(child.id, child);
      return Array.from(next.values());
    });
    setLoadedOrgIds((previous) => new Set(previous).add(parentId));
  }, [loadedOrgIds]);

  const loadApplications = useCallback(async () => {
    if (!selectedOrgId) {
      setApps([]);
      setTotal(0);
      return;
    }

    try {
      setError("");
      const params: Record<string, string> = {
        status: reviewStatus,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        targetOrgId: selectedOrgId,
      };
      if (keyword.trim()) params.keyword = keyword.trim();
      if (dateFrom) params.startDate = dateFrom;
      if (dateTo) params.endDate = dateTo;

      const appList = await anchorApi.getApplications(params);
      setApps(appList.items);
      setTotal(appList.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败");
    }
  }, [reviewStatus, keyword, dateFrom, dateTo, page, selectedOrgId]);

  useEffect(() => {
    void loadRootOrgs();
  }, [loadRootOrgs]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const review = async (app: AnchorApplication, approved: boolean) => {
    try {
      setMessage("");
      setError("");
      const draft = reviewDrafts[app.id];
      if (approved && (!draft?.anchorNickname || !draft?.douyinUid)) {
        throw new Error("请填写审核后的昵称和抖音 UID");
      }
      await api.post(`/anchors/applications/${app.id}/review`, {
        approved,
        ...(approved ? draft : {}),
      });
      setMessage(`申请已${approved ? "通过" : "驳回"}`);
      if (activeAppId === app.id) setActiveAppId("");
      await loadApplications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  };

  return {
    orgTree,
    orgMap,
    selectedOrgId,
    setSelectedOrgId: async (orgId: string) => {
      setSelectedOrgId(orgId);
      setPage(1);
      await loadOrgChildren(orgId);
    },
    reviewStatus,
    setReviewStatus: (value: ReviewStatus) => {
      setReviewStatus(value);
      setPage(1);
    },
    keyword,
    setKeyword: (value: string) => {
      setKeyword(value);
      setPage(1);
    },
    dateFrom,
    setDateFrom: (value: string) => {
      setDateFrom(value);
      setPage(1);
    },
    dateTo,
    setDateTo: (value: string) => {
      setDateTo(value);
      setPage(1);
    },
    activeAppId,
    setActiveAppId,
    reviewDrafts,
    setReviewDrafts,
    message,
    error,
    filteredApps,
    activeApp,
    loadApplications,
    review,
    page,
    total,
    pageSize: PAGE_SIZE,
    setPage,
    loadOrgChildren,
  };
}
