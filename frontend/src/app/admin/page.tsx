"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface InvitationCode {
  id: number;
  code: string;
  is_used: boolean;
  created_at: string;
  used_at: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const [invites, setInvites] = useState<InvitationCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const isAdmin = localStorage.getItem("is_admin") === "true";

    if (!token || !isAdmin) {
      router.push("/login");
      return;
    }

    fetchInvites(token);
  }, [router]);

  const fetchInvites = async (token: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/invites`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("データの取得に失敗しました");
      }

      const data = await res.json();
      setInvites(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const generateInvite = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE_URL}/auth/invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error("招待コードの生成に失敗しました");
      }

      fetchInvites(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">
            管理者ダッシュボード
          </h1>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            ホームに戻る
          </button>
        </header>

        <div className="rounded-xl bg-white p-6 shadow-md">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-800">
              招待コード管理
            </h2>
            <button
              onClick={generateInvite}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              新規コード発行
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-rose-50 p-4 text-rose-600">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    コード
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    ステータス
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    作成日時
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-sm text-slate-900">
                      {invite.code}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {invite.is_used ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 text-xs font-semibold leading-5 text-slate-800">
                          使用済み
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 text-xs font-semibold leading-5 text-emerald-800">
                          有効
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                      {new Date(invite.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
