export function text(value: unknown) {
  return String(value ?? "").trim();
}

export function safeUser<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export function isVirtualHall(org: { orgCode?: string | null; douyinUid?: string | null; name?: string | null }) {
  return Boolean(org.orgCode?.startsWith("HALL-VIRTUAL-") || org.douyinUid?.startsWith("virtual-") || org.name?.includes("模拟厅"));
}
