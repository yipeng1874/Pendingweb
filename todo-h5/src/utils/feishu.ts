declare global {
  interface Window {
    tt?: {
      requestAccess?: (options: {
        scopeList: string[];
        appID: string;
        success: (result: { code: string }) => void;
        fail: (error: unknown) => void;
      }) => void;
      authorize?: (options: {
        scopeList: string[];
        scope: string;
        success: (result: { code: string }) => void;
        fail: (error: unknown) => void;
      }) => void;
    };
    h5sdk?: {
      ready: (callback: () => void) => void;
      error: (callback: (error: unknown) => void) => void;
      config: (options: {
        appId: string;
        timestamp: number;
        nonceStr: string;
        signature: string;
        jsApiList: string[];
        onSuccess?: () => void;
        onFail?: (error: unknown) => void;
      }) => void;
    };
  }
}

export function isInFeishuApp() {
  return /Lark|Feishu/i.test(window.navigator.userAgent);
}

function waitForFeishuSdk() {
  return new Promise<void>((resolve, reject) => {
    if (window.tt) return resolve();
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (window.tt) {
        window.clearInterval(timer);
        resolve();
      } else if (++attempts >= 50) {
        window.clearInterval(timer);
        reject(new Error("飞书客户端能力加载失败，请从飞书工作台重新进入"));
      }
    }, 100);
  });
}

async function configureH5Sdk(appId: string, configId: string) {
  if (!window.h5sdk) return;
  const pageUrl = window.location.href.split("#")[0];
  const response = await fetch(`/api/auth/feishu/jssdk-config?url=${encodeURIComponent(pageUrl)}&configId=${encodeURIComponent(configId)}`);
  const result = await response.json() as {
    success: boolean;
    data?: { timestamp: number; nonceStr: string; signature: string };
    error?: { message?: string };
  };
  if (!result.success || !result.data) throw new Error(result.error?.message ?? "获取飞书鉴权配置失败");

  await new Promise<void>((resolve, reject) => {
    window.h5sdk!.error((error) => reject(new Error(`飞书 H5 鉴权失败：${JSON.stringify(error)}`)));
    window.h5sdk!.config({
      appId,
      timestamp: result.data!.timestamp,
      nonceStr: result.data!.nonceStr,
      signature: result.data!.signature,
      jsApiList: ["authorize"],
      onSuccess: () => window.h5sdk!.ready(resolve),
      onFail: (error) => reject(new Error(`飞书 H5 配置失败：${JSON.stringify(error)}`)),
    });
  });
}

export async function getFeishuAuthCode(appId: string, configId: string) {
  if (!isInFeishuApp()) throw new Error("当前不在飞书客户端内");
  await waitForFeishuSdk();
  const isDesktop = /Electron/i.test(window.navigator.userAgent);
  if (!isDesktop) await configureH5Sdk(appId, configId);

  return new Promise<string>((resolve, reject) => {
    if (window.tt?.requestAccess) {
      window.tt.requestAccess({
        scopeList: [],
        appID: appId,
        success: ({ code }) => resolve(code),
        fail: (error) => reject(new Error(`飞书授权失败：${JSON.stringify(error)}`)),
      });
      return;
    }
    if (window.tt?.authorize) {
      window.tt.authorize({
        scopeList: ["contact:user.base:readonly"],
        scope: "contact:user.base:readonly",
        success: ({ code }) => resolve(code),
        fail: (error) => reject(new Error(`飞书授权失败：${JSON.stringify(error)}`)),
      });
      return;
    }
    reject(new Error("当前飞书版本不支持免登，请升级飞书后重试"));
  });
}
