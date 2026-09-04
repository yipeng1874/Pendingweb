export function text(value) {
    return String(value ?? "").trim();
}
export function safeUser(user) {
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
}
export function isVirtualHall(org) {
    return Boolean(org.orgCode?.startsWith("HALL-VIRTUAL-") || org.douyinUid?.startsWith("virtual-") || org.name?.includes("模拟厅"));
}
