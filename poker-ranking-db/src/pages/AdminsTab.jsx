import { useCallback, useEffect, useState } from "react";
import { C, btnPrimary, btnRow, btnSecondary, fmtDateTime, inputCls, isEnter } from "../utils.js";

export default function AdminsTab({ admin, call, flash }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", password: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwError, setPwError] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await call("/admins");
      setAdmins(r.admins);
      setError("");
    } catch (e) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  const addAdmin = async () => {
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const r = await call("/admins", { method: "POST", body: form });
      setForm({ username: "", password: "" });
      flash(`已新增管理员 ${r.admin.username}`);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeAdmin = async (a) => {
    try {
      await call(`/admins/${a.id}`, { method: "DELETE" });
      flash(`已删除管理员 ${a.username}`);
      setConfirmId(null);
      load();
    } catch (e) {
      flash(e.message);
    }
  };

  const changePassword = async () => {
    if (pwBusy) return;
    setPwError("");
    if (pw.newPassword !== pw.confirm) return setPwError("两次输入的新密码不一样");
    setPwBusy(true);
    try {
      await call("/admins/me/password", {
        method: "POST",
        body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword },
      });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      flash("已修改密码，其他装置需要重新登入");
    } catch (e) {
      setPwError(e.message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-3 items-start">
      <section
        className="md:col-span-2 bg-white rounded-lg border"
        style={{ borderColor: C.line }}
        aria-labelledby="admins-heading"
      >
        <div className="p-4 border-b" style={{ borderColor: C.line }}>
          <h2 id="admins-heading" className="text-lg font-bold">
            管理员帐号
          </h2>
          <p className="text-xs" style={{ color: C.muted }}>
            所有管理员都可以修改积分和新增其他管理员。
          </p>
        </div>
        {error ? (
          <p className="p-8 text-center text-sm" style={{ color: C.red }}>
            {error}
          </p>
        ) : loading ? (
          <p className="p-8 text-center text-sm" style={{ color: C.muted }}>
            载入中…
          </p>
        ) : (
          <ul>
            {admins.map((a) => (
              <li
                key={a.id}
                className="px-4 py-3 border-b flex flex-wrap items-center gap-x-4 gap-y-2"
                style={{ borderColor: C.line }}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">
                    {a.username}
                    {a.id === admin.id && (
                      <span className="ml-2 text-xs font-normal" style={{ color: C.muted }}>
                        （你）
                      </span>
                    )}
                  </div>
                  <div className="text-xs flex flex-wrap gap-x-3" style={{ color: C.muted }}>
                    <span>建立 {fmtDateTime(a.createdAt)}</span>
                    <span>最后登入 {fmtDateTime(a.lastLoginAt)}</span>
                  </div>
                </div>
                {a.id !== admin.id &&
                  (confirmId === a.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">删除 {a.username}？</span>
                      <button className={btnPrimary} style={{ background: C.red }} onClick={() => removeAdmin(a)}>
                        删除
                      </button>
                      <button
                        className={btnSecondary}
                        style={{ borderColor: C.line, color: C.ink }}
                        onClick={() => setConfirmId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button className={btnRow} style={{ color: C.red }} onClick={() => setConfirmId(a.id)}>
                      删除
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-6">
        <section className="bg-white rounded-lg border p-5" style={{ borderColor: C.line }} aria-labelledby="new-admin">
          <h2 id="new-admin" className="text-lg font-bold mb-4">
            新增管理员
          </h2>
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="na-u" className="block text-sm font-medium mb-1">
                帐号
              </label>
              <input
                id="na-u"
                className={inputCls}
                style={{ borderColor: C.line }}
                value={form.username}
                autoCapitalize="none"
                autoComplete="off"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                onKeyDown={(e) => isEnter(e) && addAdmin()}
              />
            </div>
            <div>
              <label htmlFor="na-p" className="block text-sm font-medium mb-1">
                初始密码
              </label>
              <input
                id="na-p"
                type="password"
                className={inputCls}
                style={{ borderColor: C.line }}
                value={form.password}
                autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onKeyDown={(e) => isEnter(e) && addAdmin()}
              />
              <p className="text-xs mt-1" style={{ color: C.muted }}>
                最少 8 个字元。对方登入后可以自行修改。
              </p>
            </div>
          </div>
          {formError && (
            <p className="text-sm mt-3" style={{ color: C.red }} role="alert">
              {formError}
            </p>
          )}
          <button
            className={btnPrimary + " w-full mt-4"}
            style={{ background: C.felt }}
            onClick={addAdmin}
            disabled={busy}
          >
            {busy ? "新增中…" : "新增管理员"}
          </button>
        </section>

        <section className="bg-white rounded-lg border p-5" style={{ borderColor: C.line }} aria-labelledby="change-pw">
          <h2 id="change-pw" className="text-lg font-bold mb-4">
            修改我的密码
          </h2>
          <div className="flex flex-col gap-3">
            {[
              ["currentPassword", "目前密码", "current-password"],
              ["newPassword", "新密码", "new-password"],
              ["confirm", "再输入一次新密码", "new-password"],
            ].map(([key, label, ac]) => (
              <div key={key}>
                <label htmlFor={`pw-${key}`} className="block text-sm font-medium mb-1">
                  {label}
                </label>
                <input
                  id={`pw-${key}`}
                  type="password"
                  className={inputCls}
                  style={{ borderColor: C.line }}
                  value={pw[key]}
                  autoComplete={ac}
                  onChange={(e) => setPw({ ...pw, [key]: e.target.value })}
                  onKeyDown={(e) => isEnter(e) && changePassword()}
                />
              </div>
            ))}
          </div>
          {pwError && (
            <p className="text-sm mt-3" style={{ color: C.red }} role="alert">
              {pwError}
            </p>
          )}
          <button
            className={btnPrimary + " w-full mt-4"}
            style={{ background: C.felt }}
            onClick={changePassword}
            disabled={pwBusy}
          >
            {pwBusy ? "储存中…" : "修改密码"}
          </button>
        </section>
      </div>
    </div>
  );
}
