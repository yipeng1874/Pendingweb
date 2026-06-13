/**
 * 飞书环境检测与授权码获取工具
 *
 * 飞书 PC 桌面端工作台（Electron）：
 *   - window.tt 由飞书注入
 *   - window.h5sdk 也存在，需要先调用 h5sdk.ready() 等待鉴权完成
 *   - 然后再调用 tt.authorize({ scopeList }) 获取授权码
 *
 * 飞书移动端 H5：
 *   - 同样需要 h5sdk.ready() 后再调用 tt.authorize
 */

declare global {
  interface Window {
    tt?: {
      // 网页应用获取登录 code 的正确接口（PC/移动端 V6.9.0+）
      requestAccess: (opts: {
        scopeList: string[];
        appID?: string;
        state?: string;
        success: (res: { code: string; state?: string }) => void;
        fail: (err: unknown) => void;
        complete?: (res: unknown) => void;
      }) => void;
      // 兜底（小程序环境）
      authorize?: (opts: {
        scope?: string;
        scopeList?: string[];
        success: (res: { code: string }) => void;
        fail: (err: unknown) => void;
        complete?: (res: unknown) => void;
      }) => void;
      config?: (...args: unknown[]) => void;
      ready?: (cb: () => void) => void;
      error?: (cb: (err: unknown) => void) => void;
      requestAuthCode?: (opts: {
        appId: string;
        success: (res: { code: string }) => void;
        fail: (err: unknown) => void;
      }) => void;
    };
    h5sdk?: {
      ready: (cb: () => void) => void;
      error: (cb: (err: unknown) => void) => void;
      config: (opts: {
        appId: string;
        timestamp: number;
        nonceStr: string;
        signature: string;
        jsApiList: string[];
        onSuccess?: () => void;
        onFail?: (err: unknown) => void;
      }) => void;
    };
  }
}

/** 检测是否在飞书 App 环境内（PC 桌面端或移动端） */
export function isInFeishuApp(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("lark") || ua.includes("feishu");
}

/**
 * 获取飞书授权码
 *
 * 流程：
 * 1. 等待 window.tt 注入
 * 2. 若 window.h5sdk 存在，先调用 h5sdk.ready() 等待 SDK 鉴权完成
 * 3. 再调用 tt.authorize 获取 code
 */
export function getFeishuAuthCode(appId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isInFeishuApp()) {
      reject(new Error("当前不在飞书 App 环境内"));
      return;
    }

    waitForTT()
      .then(() => {
        const ua = navigator.userAgent.toLowerCase();
        const isElectron = ua.includes("electron");

        // PC 桌面端 Electron：直接调用（优先 requestAuthCode，无需 h5sdk 签名）
        // 移动端 / 浏览器内嵌 H5：需要先完成 h5sdk 鉴权
        if (!isElectron && window.h5sdk) {
          initH5sdk(appId)
            .then(() => doAuthorize(resolve, reject, appId))
            .catch(reject);
        } else {
          doAuthorize(resolve, reject, appId);
        }
      })
      .catch(reject);
  });
}

/** 初始化 h5sdk：先从后端获取签名，再调 h5sdk.config + h5sdk.ready */
async function initH5sdk(appId: string): Promise<void> {
  // 飞书签名校验用的 URL：去掉 hash，保留 path+query
  // 注意：URL 必须与飞书开放平台「H5 可信域名」完全匹配（含端口）
  const url = window.location.href.split("#")[0];
  console.log("[feishu] h5sdk config url:", url);
  const resp = await fetch(`/api/auth/feishu/jssdk-config?url=${encodeURIComponent(url)}`);
  const json = await resp.json() as any;
  if (!json.success) throw new Error(json.error?.message ?? "获取 JSSDK 配置失败");

  const { timestamp, nonceStr, signature } = json.data;

  return new Promise((resolve, reject) => {
    window.h5sdk!.error((err) => {
      reject(new Error(`h5sdk 鉴权失败: ${JSON.stringify(err)}`));
    });

    window.h5sdk!.config({
      appId,
      timestamp,
      nonceStr,
      signature,
      jsApiList: ["authorize"],
      onSuccess: () => {
        // config 成功后等 ready
        window.h5sdk!.ready(resolve);
      },
      onFail: (err) => {
        reject(new Error(`h5sdk config 失败: ${JSON.stringify(err)}`));
      },
    });
  });
}

/** 调用 tt.requestAccess 获取 code（网页应用专用，PC/移动端均支持） */
function doAuthorize(
  resolve: (code: string) => void,
  reject: (err: Error) => void,
  appId: string
) {
  // 网页应用正确接口：tt.requestAccess，appID 必传
  if (typeof window.tt?.requestAccess === "function") {
    window.tt.requestAccess({
      scopeList: [],   // 空数组：仅获取用户凭证信息（登录 code）
      appID: appId,
      success: (res) => resolve(res.code),
      fail: (err) => reject(new Error(`飞书授权失败: ${JSON.stringify(err)}`)),
    });
    return;
  }
  // 兜底：tt.authorize（小程序环境）
  if (typeof window.tt?.authorize === "function") {
    window.tt.authorize({
      scopeList: ["contact:user.base:readonly"],
      scope: "contact:user.base:readonly",
      success: (res) => resolve(res.code),
      fail: (err) => reject(new Error(`飞书授权失败: ${JSON.stringify(err)}`)),
    });
    return;
  }
  reject(new Error("飞书客户端未提供授权接口"));
}

/** 轮询等待 window.tt 被飞书注入，最多等 5s */
function waitForTT(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.tt) { resolve(); return; }
    let attempts = 0;
    const timer = setInterval(() => {
      if (window.tt) { clearInterval(timer); resolve(); return; }
      if (++attempts >= 50) {
        clearInterval(timer);
        reject(new Error("飞书客户端未注入 window.tt，请在飞书工作台内访问"));
      }
    }, 100);
  });
}
