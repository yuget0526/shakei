"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.append("username", username);
    formData.append("password", password);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/token`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(
          "ログインに失敗しました。ユーザー名またはパスワードを確認してください。"
        );
      }

      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("is_admin", String(data.is_admin));
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-slate-900">ログイン</h2>
          <p className="mt-2 text-slate-600">
            写経.exe を利用するにはログインしてください
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="username" className="sr-only">
                ユーザー名
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="relative block w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900 placeholder-slate-500 focus:z-10 focus:border-purple-500 focus:outline-none focus:ring-purple-500 sm:text-sm"
                placeholder="ユーザー名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                パスワード
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="relative block w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900 placeholder-slate-500 focus:z-10 focus:border-purple-500 focus:outline-none focus:ring-purple-500 sm:text-sm"
                placeholder="パスワード"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-rose-600 text-center">{error}</div>
          )}

          <div>
            <button
              type="submit"
              className="group relative flex w-full justify-center rounded-lg bg-purple-600 px-4 py-3 text-sm font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
            >
              ログイン
            </button>
          </div>
        </form>
        <div className="text-center text-sm">
          <a
            href="/register"
            className="font-medium text-purple-600 hover:text-purple-500"
          >
            アカウントをお持ちでない方は登録へ
          </a>
        </div>
      </div>
    </div>
  );
}
