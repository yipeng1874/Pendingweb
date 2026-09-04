export function ok(res, data) {
    return res.json({ success: true, data });
}
export function fail(res, code, message, status = 400) {
    return res.status(status).json({ success: false, error: { code, message } });
}
