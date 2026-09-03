export type FeishuMessageConfig = {
  appId: string;
  appSecret: string;
};

/** A bounded request keeps a Feishu outage from indefinitely blocking task submission. */
export async function sendFeishuBatchMessage(config: FeishuMessageConfig, openIds: string[], text: string) {
  const tokenResponse = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    signal: AbortSignal.timeout(5000),
  });
  const token = await tokenResponse.json() as any;
  if (!tokenResponse.ok || token.code !== 0 || !token.tenant_access_token) {
    throw new Error(token.msg || "获取飞书 tenant_access_token 失败");
  }

  const response = await fetch("https://open.feishu.cn/open-apis/message/v4/batch_send/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.tenant_access_token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ msg_type: "text", open_ids: openIds, content: { text } }),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json() as any;
  if (!response.ok || result.code !== 0) throw new Error(result.msg || "飞书批量发送失败");
  return {
    messageId: result.data?.message_id ?? null,
    invalidOpenIds: Array.isArray(result.data?.invalid_open_ids) ? result.data.invalid_open_ids as string[] : [],
  };
}
