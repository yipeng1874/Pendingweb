import { useState, useMemo, useEffect, ChangeEvent } from "react";
import type { OrgUnit } from "../../../types";
import { fetchOrgTree, createOrg, updateOrg, toggleOrgStatus, moveOrg, deleteOrg, batchCreateHalls } from "../api";
import { toOrgForm, parseBatchHallText } from "../utils";
import { emptyOrgForm, nextTypeMap, parentTypeMap } from "../constants";
import type { BatchHallRow } from "../types";

export function useOrganization() {
  const [orgs, setOrgs] = useState<OrgUnit[]>([]);
  const [selected, setSelected] = useState<OrgUnit>();
  const [form, setForm] = useState(emptyOrgForm);
  const [editForm, setEditForm] = useState(emptyOrgForm);
  const [isEditing, setIsEditing] = useState(false);
  const [moveParentId, setMoveParentId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [batchRows, setBatchRows] = useState<BatchHallRow[]>([]);

  const childType = useMemo(() => selected ? nextTypeMap[selected.orgType] : undefined, [selected]);
  const moveCandidates = useMemo(() => selected ? orgs.filter((org) => org.orgType === parentTypeMap[selected.orgType] && org.id !== selected.id && !org.path.startsWith(`${selected.path}/`)) : [], [orgs, selected]);
  const hasChildren = useMemo(() => new Set(orgs.map((org) => org.parentId).filter(Boolean)), [orgs]);
  const hasSelectedChildren = Boolean(selected && hasChildren.has(selected.id));
  const canMoveSelected = Boolean(selected && selected.orgType !== "HQ" && moveCandidates.length > 0);
  const canDeleteSelected = Boolean(selected && selected.orgType !== "HQ" && !hasSelectedChildren);
  const showCreateChild = Boolean(childType);
  const showBatchHalls = selected?.orgType === "TEAM";
  const showMoveOrDelete = canMoveSelected || canDeleteSelected;
  const visibleOrgs = useMemo(() => orgs.filter((org) => !org.path.split("/").filter(Boolean).slice(0, -1).some((code) => {
    const ancestor = orgs.find((item) => item.orgCode === code);
    return ancestor ? collapsedIds.has(ancestor.id) : false;
  })), [collapsedIds, orgs]);

  function selectOrg(org?: OrgUnit) {
    setSelected(org);
    setMoveParentId("");
    setMessage("");
    setError("");
    setIsEditing(false);
    if (org) setEditForm(toOrgForm(org));
  }

  function load(nextSelectedId?: string) {
    fetchOrgTree().then((list) => {
      setOrgs(list);
      const next = nextSelectedId ? list.find((item) => item.id === nextSelectedId) : selected ? list.find((item) => item.id === selected.id) : list[0];
      selectOrg(next ?? list[0]);
    }).catch((err) => setError(err.message));
  }

  useEffect(() => { load(); }, []);

  async function run(action: () => Promise<void>, successText: string) {
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(successText);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  function startEdit() {
    if (!selected) return;
    setEditForm(toOrgForm(selected));
    setIsEditing(true);
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    if (selected) setEditForm(toOrgForm(selected));
    setIsEditing(false);
    setMessage("");
    setError("");
  }

  async function createChildOrg() {
    if (!selected || !childType) return;
    await run(async () => {
      const created = await createOrg({ ...form, parentId: selected.id, orgType: childType });
      setForm(emptyOrgForm);
      load(created.id);
    }, "组织已创建");
  }

  async function saveSelectedOrg() {
    if (!selected) return;
    await run(async () => {
      const updated = await updateOrg(selected.id, { ...editForm, douyinUid: selected.orgType === "HALL" ? editForm.douyinUid : undefined });
      setIsEditing(false);
      load(updated.id);
    }, "组织档案已保存");
  }

  async function pauseOrRestore() {
    if (!selected) return;
    const isPaused = selected.status === "paused";
    await run(async () => {
      const updated = await toggleOrgStatus(selected.id, isPaused);
      load(updated.id);
    }, isPaused ? "组织已恢复" : "组织已暂停");
  }

  async function moveSelectedOrg() {
    if (!selected || !moveParentId) return;
    await run(async () => {
      const moved = await moveOrg(selected.id, moveParentId);
      load(moved.id);
    }, "组织已迁移");
  }

  async function deleteSelectedOrg() {
    if (!selected || selected.orgType === "HQ") return;
    if (!window.confirm(`确定删除组织「${selected.name}」吗？该操作不可恢复。`)) return;
    await run(async () => {
      await deleteOrg(selected.id);
      load();
    }, "组织已删除");
  }

  function toggleCollapsed(org: OrgUnit) {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(org.id)) next.delete(org.id);
      else next.add(org.id);
      return next;
    });
  }

  async function handleBatchFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseBatchHallText(text);
    setBatchRows(rows);
    setMessage(`已解析 ${rows.length} 条厅组织数据`);
    setError("");
    event.target.value = "";
  }

  async function createBatchHalls() {
    if (!selected || selected.orgType !== "TEAM") return;
    await run(async () => {
      const result = await batchCreateHalls(selected.id, batchRows);
      setBatchRows([]);
      load(result.items[0]?.id);
    }, `已批量创建 ${batchRows.length} 个厅组织`);
  }

  return {
    orgs,
    selected,
    form,
    setForm,
    editForm,
    setEditForm,
    isEditing,
    moveParentId,
    setMoveParentId,
    message,
    error,
    collapsedIds,
    setCollapsedIds,
    batchRows,
    setBatchRows,
    childType,
    moveCandidates,
    hasChildren,
    canMoveSelected,
    canDeleteSelected,
    showCreateChild,
    showBatchHalls,
    showMoveOrDelete,
    visibleOrgs,
    selectOrg,
    startEdit,
    cancelEdit,
    createChildOrg,
    saveSelectedOrg,
    pauseOrRestore,
    moveSelectedOrg,
    deleteSelectedOrg,
    toggleCollapsed,
    handleBatchFile,
    createBatchHalls,
  };
}
