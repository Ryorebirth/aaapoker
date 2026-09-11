import { useEffect, useState } from "react";
import { api } from "../api.js";
import { C, FONT, btnPrimary, inputCls, isEnter } from "../utils.js";
import Dashboard from "./Dashboard.jsx";

export default function AdminApp() {
  const [state, setState] = useState({ loading: true, needsSetup: false, admin: null, error: "" });

  const loadStatus = async () => {
    try {
      const s = await api("/auth/status");
      setState({ loading: false, needsSetup: s.needsSetup, admin: s.admin, error: "" });
    } catch (e) {
      setState({ loading: false, needsSetup: false, admin: null, error: e.message });
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (state.loading) {
    return (
      <Shell>
        <p className="text-center text-sm" style={{ color: C.muted }}>
          載入中…
        </p>
      </Shell>
    );
  }

  if (state.error) {
    return (
      <Shell>
        <p className="font-semibold mb-2">無法連線到系統</p>
        <p className="text-sm mb-4" style={{ color: C.muted }}>
          {state.error}
        </p>
        <button className={btnPrimary + " w-full"} style={{ background: C.felt }} onClick={loadStatus}>
          重試
        </button>
      </Shell>
    );
  }

  if (state.admin) {
    return (
      <Dashboard
        admin={state.admin}
        onSignedOut={() => setState({ loading: false, needsSetup: false, admin: null, error: "" })}
      />
    );
  }

  return (
    <AuthForm
      mode={state.needsSetup ? "setup" : "login"}
      onDone={(admin) => setState({ loading: false, needsSetup: false, admin, error: "" })}
      onSetupTaken={loadStatus}
    />
  );
}

function Shell({ children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: C.felt, fontFamily: FONT, color: C.ink }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-lg mb-2" style={{ color: C.brass, letterSpacing: "0.35em" }} aria-hidden="true">
            ♠ ♥ ♦ ♣
          </div>
          <h1 className="text-2xl font-bold text-white">撲克積分管理</h1>
        </div>
        <div className="bg-white rounded-lg p-6">{children}</div>
        <p className="text-center text-sm mt-5">
          <a href="/board" className="underline" style={{ color: "rgba(255,255,255,0.8)" }}>
            查看即時排行榜
          </a>
        </p>
      </div>
    </div>
  );
}

function AuthForm({ mode, onDone, onSetupTaken }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isSetup = mode === "setup";

  const submit = async () => {
    if (busy) return;
    setError("");
    if (isSetup && password !== confirm) return setError("兩次輸入的密碼不一樣");
    setBusy(true);
    try {
      const r = await api(isSetup ? "/auth/setup" : "/auth/login", {
        method: "POST",
        body: { username, password },
      });
      onDone(r.admin);
    } catch (e) {
      setError(e.message);
      if (isSetup && e.status === 409) setTimeout(onSetupTaken, 1500);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => isEnter(e) && submit();

  return (
    <Shell>
      <h2 className="text-lg font-bold mb-1">{isSetup ? "建立第一個管理員" : "管理員登入"}</h2>
      <p className="text-sm mb-5" style={{ color: C.muted }}>
        {isSetup
          ? "系統還沒有管理員。這個帳號可以管理積分，以及新增其他管理員。"
          : "登入後可以新增玩家、加減分和查看修改紀錄。"}
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="u" className="block text-sm font-medium mb-1">
            帳號
          </label>
          <input
            id="u"
            className={inputCls}
            style={{ borderColor: C.line }}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={onKey}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
          />
          {isSetup && (
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              3 至 32 個英文字母或數字
            </p>
          )}
        </div>
        <div>
          <label htmlFor="p" className="block text-sm font-medium mb-1">
            密碼
          </label>
          <input
            id="p"
            type="password"
            className={inputCls}
            style={{ borderColor: C.line }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKey}
            autoComplete={isSetup ? "new-password" : "current-password"}
          />
          {isSetup && (
            <p className="text-xs mt-1" style={{ color: C.muted }}>
              最少 8 個字元
            </p>
          )}
        </div>
        {isSetup && (
          <div>
            <label htmlFor="c" className="block text-sm font-medium mb-1">
              再輸入一次密碼
            </label>
            <input
              id="c"
              type="password"
              className={inputCls}
              style={{ borderColor: C.line }}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={onKey}
              autoComplete="new-password"
            />
          </div>
        )}
      </div>
      {error && (
        <p className="text-sm mt-3" style={{ color: C.red }} role="alert">
          {error}
        </p>
      )}
      <button
        className={btnPrimary + " w-full mt-5"}
        style={{ background: C.felt }}
        onClick={submit}
        disabled={busy}
      >
        {busy ? "請稍候…" : isSetup ? "建立並登入" : "登入"}
      </button>
    </Shell>
  );
}
