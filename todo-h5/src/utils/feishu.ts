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

export async function getFeishuAuthCode(appId: string, _configId: string) {
  if (!isInFeishuApp()) throw new Error("当前不在飞书客户端内");
  await waitForFeishuSdk();
  const requestCode = () => new Promise<string>((resolve, reject) => {
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

  // Feishu's current in-client web SSO flow obtains the temporary code through
  // requestAccess directly. Do not replace its original error with a legacy
  // H5 SDK signature error; the caller needs the real errno for diagnosis.
  return requestCode();
}
