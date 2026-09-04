const BEIJING_OFFSET_HOURS = 8;
const BEIJING_OFFSET_MS = BEIJING_OFFSET_HOURS * 60 * 60 * 1000;
function pad(value) {
    return String(value).padStart(2, "0");
}
function parseRecordDateParts(recordDate) {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(recordDate);
    if (!matched)
        throw new Error("INVALID_RECORD_DATE");
    return {
        year: Number(matched[1]),
        month: Number(matched[2]),
        day: Number(matched[3]),
    };
}
function getBeijingShiftedDate(date = new Date()) {
    return new Date(date.getTime() + BEIJING_OFFSET_MS);
}
export function makeBeijingDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
    return new Date(Date.UTC(year, month - 1, day, hour - BEIJING_OFFSET_HOURS, minute, second, millisecond));
}
export function formatBeijingDate(date = new Date()) {
    const beijingDate = getBeijingShiftedDate(date);
    return `${beijingDate.getUTCFullYear()}-${pad(beijingDate.getUTCMonth() + 1)}-${pad(beijingDate.getUTCDate())}`;
}
export function addBeijingDays(recordDate, days) {
    const { year, month, day } = parseRecordDateParts(recordDate);
    const target = makeBeijingDate(year, month, day, 12, 0, 0, 0);
    target.setUTCDate(target.getUTCDate() + days);
    return formatBeijingDate(target);
}
export function getDailyTaskDayEnd(recordDate) {
    const { year, month, day } = parseRecordDateParts(recordDate);
    return makeBeijingDate(year, month, day, 23, 59, 59, 999);
}
export function getDailyTaskDayStart(recordDate) {
    const { year, month, day } = parseRecordDateParts(recordDate);
    return makeBeijingDate(year, month, day, 0, 0, 0, 0);
}
export function getDailyTaskSupplementDeadline(recordDate) {
    const { year, month, day } = parseRecordDateParts(addBeijingDays(recordDate, 1));
    return makeBeijingDate(year, month, day, 16, 0, 0, 0);
}
export function getDailyTaskContext(now = new Date()) {
    const today = formatBeijingDate(now);
    const yesterday = addBeijingDays(today, -1);
    const { year, month, day } = parseRecordDateParts(today);
    const yesterdayCollectionCutoff = makeBeijingDate(year, month, day, 16, 0, 0, 0);
    return {
        today,
        yesterday,
        canSupplementYesterday: now.getTime() < yesterdayCollectionCutoff.getTime(),
        yesterdayCollectionCutoff,
    };
}
export function isDailyRecordOverdue(recordDate, now = new Date()) {
    return now.getTime() > getDailyTaskDayEnd(recordDate).getTime();
}
export function isDailyRecordCollectionClosed(recordDate, now = new Date()) {
    return now.getTime() >= getDailyTaskSupplementDeadline(recordDate).getTime();
}
export function resolveDailyRecordStatus(doneItems, recordDate, now = new Date()) {
    if (isDailyRecordOverdue(recordDate, now))
        return "overdue";
    return doneItems > 0 ? "in_progress" : "pending";
}
export function resolveTaskRecordStatus(record, now = new Date()) {
    if (record.status === "submitted")
        return "submitted";
    if (record.assignment?.category === "DAILY" && record.recordDate) {
        return resolveDailyRecordStatus(record.doneItems, record.recordDate, now);
    }
    if (record.status === "overdue")
        return "overdue";
    return record.doneItems > 0 ? "in_progress" : "pending";
}
export function isTodayDailyRecord(recordDate, now = new Date()) {
    return recordDate === getDailyTaskContext(now).today;
}
export function isYesterdayDailyRecord(recordDate, now = new Date()) {
    return recordDate === getDailyTaskContext(now).yesterday;
}
