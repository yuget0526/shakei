"use client";

import { useState, useCallback, ChangeEvent, DragEvent, useMemo } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type UploadState = "idle" | "uploading" | "success" | "error";
type Language = "java" | "php";

const LANGUAGE_CONFIG: Record<
  Language,
  { label: string; hint: string; color: string }
> = {
  java: {
    label: "Java",
    hint: "IntelliJ の src フォルダを選択",
    color: "orange",
  },
  php: {
    label: "PHP",
    hint: "XAMPP htdocs / MAMP www を選択",
    color: "indigo",
  },
};

// File System Access API の型定義
interface FileSystemDirectoryHandle {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<FileSystemFileHandle>;
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }
}

export default function Home() {
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [statusMessage, setStatusMessage] = useState("PDF を選択してください");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "saving" | "success">(
    "upload"
  );
  const [extractedFiles, setExtractedFiles] = useState<Record<
    string,
    string
  > | null>(null);

  // 言語ごとの保存先ディレクトリハンドル
  const [javaDirHandle, setJavaDirHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [phpDirHandle, setPhpDirHandle] =
    useState<FileSystemDirectoryHandle | null>(null);

  // プレビュー用の状態
  const [previewLanguage, setPreviewLanguage] = useState<Language | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);

  // 言語ごとのファイル分類
  const filesByLanguage = useMemo(() => {
    if (!extractedFiles) return { java: {}, php: {} };

    const java: Record<string, string> = {};
    const php: Record<string, string> = {};

    for (const [path, content] of Object.entries(extractedFiles)) {
      if (path.toLowerCase().endsWith(".java")) {
        java[path] = content;
      } else if (path.toLowerCase().endsWith(".php")) {
        php[path] = content;
      }
    }

    return { java, php };
  }, [extractedFiles]);

  const handleFile = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const file = fileList[0];
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setErrorMessage("PDF 形式のファイルのみアップロードできます");
      return;
    }

    setErrorMessage(null);
    setStatusMessage(`${file.name} を解析しています...`);
    setUploadState("uploading");

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("base_directory", "");
      formData.append("response_format", "json");

      const response = await fetch(`${API_BASE_URL}/extract`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const maybeJson = await response.json().catch(() => null);
        const detail = maybeJson?.detail ?? "解析に失敗しました";
        throw new Error(detail);
      }

      const files: Record<string, string> = await response.json();
      setExtractedFiles(files);
      setStep("preview");
      setUploadState("success");
      setStatusMessage("解析が完了しました。");
    } catch (error) {
      setUploadState("error");
      const message = error instanceof Error ? error.message : "不明なエラー";
      setErrorMessage(message);
      setStatusMessage("解析に失敗しました");
    }
  }, []);

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files);
  };

  const onDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      handleFile(event.dataTransfer.files);
    },
    [handleFile]
  );

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
  };

  // フォルダ選択
  const selectFolder = async (language: Language) => {
    if (typeof window.showDirectoryPicker !== "function") {
      setErrorMessage("このブラウザはフォルダ選択に対応していません。");
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker();
      if (!dirHandle) return;

      if (language === "java") {
        setJavaDirHandle(dirHandle);
      } else {
        setPhpDirHandle(dirHandle);
      }
      setErrorMessage(null);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Folder selection error:", error);
      }
    }
  };

  // ファイル保存処理
  const saveFilesToDir = async (
    files: Record<string, string>,
    dirHandle: FileSystemDirectoryHandle
  ) => {
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split("/");
      let currentHandle = dirHandle;

      for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i], {
          create: true,
        });
      }

      const fileName = parts[parts.length - 1];
      const fileHandle = await currentHandle.getFileHandle(fileName, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }
  };

  // 保存実行
  const handleSave = async () => {
    const javaFiles = filesByLanguage.java;
    const phpFiles = filesByLanguage.php;
    const hasJava = Object.keys(javaFiles).length > 0;
    const hasPHP = Object.keys(phpFiles).length > 0;

    if (hasJava && !javaDirHandle) {
      setErrorMessage("Java ファイルの保存先を選択してください");
      return;
    }
    if (hasPHP && !phpDirHandle) {
      setErrorMessage("PHP ファイルの保存先を選択してください");
      return;
    }

    setStep("saving");
    setStatusMessage("ファイルを保存しています...");
    setErrorMessage(null);

    try {
      if (hasJava && javaDirHandle) {
        await saveFilesToDir(javaFiles, javaDirHandle);
      }
      if (hasPHP && phpDirHandle) {
        await saveFilesToDir(phpFiles, phpDirHandle);
      }

      setStep("success");
      setStatusMessage("ファイルの保存が完了しました。");
    } catch (error) {
      setStep("preview");
      setErrorMessage(
        error instanceof Error ? error.message : "保存に失敗しました"
      );
    }
  };

  // プレビュー用のファイルリスト
  const previewFileList = useMemo(() => {
    if (!previewLanguage) return [];
    return Object.keys(filesByLanguage[previewLanguage]).sort();
  }, [filesByLanguage, previewLanguage]);

  const currentFileContent = useMemo(() => {
    if (!previewLanguage || previewFileList.length === 0) return "";
    return (
      filesByLanguage[previewLanguage][previewFileList[carouselIndex]] || ""
    );
  }, [filesByLanguage, previewLanguage, previewFileList, carouselIndex]);

  const reset = () => {
    setStep("upload");
    setExtractedFiles(null);
    setJavaDirHandle(null);
    setPhpDirHandle(null);
    setPreviewLanguage(null);
    setCarouselIndex(0);
    setUploadState("idle");
    setStatusMessage("PDF を選択してください");
    setErrorMessage(null);
  };

  // 保存ボタンが有効かどうか
  const canSave = useMemo(() => {
    const hasJava = Object.keys(filesByLanguage.java).length > 0;
    const hasPHP = Object.keys(filesByLanguage.php).length > 0;
    const javaOk = !hasJava || javaDirHandle !== null;
    const phpOk = !hasPHP || phpDirHandle !== null;
    return javaOk && phpOk;
  }, [filesByLanguage, javaDirHandle, phpDirHandle]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 via-slate-50 to-slate-100 px-4 py-10 text-slate-900">
      <main className="mx-auto w-full max-w-4xl space-y-8">
        <header className="space-y-3 text-center sm:text-left">
          <p className="text-sm font-semibold tracking-widest text-purple-500">
            写経.exe
          </p>
          <h1 className="text-4xl font-semibold leading-tight text-slate-900">
            PDF から 写経を自動で行います
          </h1>
          <p className="text-base text-slate-600">
            写経なんて誰がやっても一緒だよね
          </p>
        </header>

        <section className="rounded-3xl bg-white/95 p-6 shadow-2xl shadow-purple-100/60 backdrop-blur transition-all duration-500">
          {step === "upload" && (
            <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
              <label
                htmlFor="pdf-input"
                className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-purple-200 bg-purple-50/60 px-6 py-10 text-center transition hover:border-purple-400 hover:bg-purple-50"
                onDragOver={onDragOver}
                onDrop={onDrop}
              >
                <input
                  id="pdf-input"
                  type="file"
                  accept="application/pdf"
                  onChange={onFileInputChange}
                  hidden
                />
                <span className="text-lg font-semibold text-slate-900">
                  PDF をドラッグ&ドロップ
                </span>
                <span className="mt-2 text-sm text-slate-500">
                  またはクリックしてファイルを選択
                </span>
              </label>
              {uploadState === "uploading" && (
                <p className="text-center text-sm font-medium text-amber-600 animate-pulse">
                  {statusMessage}
                </p>
              )}
              {errorMessage && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  {errorMessage}
                </p>
              )}
            </form>
          )}

          {step === "preview" && extractedFiles && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">
                  抽出されたファイル
                </h2>
                <button
                  onClick={reset}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  最初に戻る
                </button>
              </div>

              {errorMessage && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  {errorMessage}
                </p>
              )}

              {/* 言語ごとのセクション */}
              <div className="space-y-4">
                {(["java", "php"] as Language[]).map((lang) => {
                  const files = filesByLanguage[lang];
                  const count = Object.keys(files).length;
                  if (count === 0) return null;

                  const config = LANGUAGE_CONFIG[lang];
                  const dirHandle =
                    lang === "java" ? javaDirHandle : phpDirHandle;
                  const isSelected = dirHandle !== null;

                  return (
                    <div
                      key={lang}
                      className={`rounded-xl border-2 p-4 transition ${
                        isSelected
                          ? "border-emerald-300 bg-emerald-50/50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span
                            className={`px-3 py-1 rounded-full text-sm font-medium ${
                              config.color === "orange"
                                ? "bg-orange-100 text-orange-700"
                                : "bg-indigo-100 text-indigo-700"
                            }`}
                          >
                            {config.label}: {count}ファイル
                          </span>
                          {isSelected && (
                            <span className="text-sm text-emerald-600 flex items-center gap-1">
                              ✓ {dirHandle.name}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => {
                              setPreviewLanguage(lang);
                              setCarouselIndex(0);
                            }}
                            className="text-sm text-purple-600 hover:text-purple-800 px-2"
                          >
                            プレビュー
                          </button>
                          <button
                            onClick={() => selectFolder(lang)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                              isSelected
                                ? "bg-slate-200 text-slate-600 hover:bg-slate-300"
                                : "bg-purple-600 text-white hover:bg-purple-700"
                            }`}
                          >
                            {isSelected ? "変更" : "フォルダを選択"}
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {config.hint}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* プレビューモーダル */}
              {previewLanguage && previewFileList.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-slate-50 shadow-inner">
                  <div className="mb-2 flex items-center justify-between border-b border-slate-700 pb-2">
                    <span className="font-mono text-sm text-purple-300">
                      {previewFileList[carouselIndex]}
                    </span>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-slate-400">
                        {carouselIndex + 1} / {previewFileList.length}
                      </span>
                      <button
                        onClick={() => setPreviewLanguage(null)}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        ✕ 閉じる
                      </button>
                    </div>
                  </div>
                  <pre className="h-64 overflow-auto whitespace-pre font-mono text-xs leading-relaxed">
                    <code>{currentFileContent}</code>
                  </pre>
                  <div className="mt-3 flex items-center justify-between">
                    <button
                      onClick={() =>
                        setCarouselIndex((i) => Math.max(0, i - 1))
                      }
                      disabled={carouselIndex === 0}
                      className="rounded-full px-3 py-1 text-sm text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                    >
                      ← 前へ
                    </button>
                    <button
                      onClick={() =>
                        setCarouselIndex((i) =>
                          Math.min(previewFileList.length - 1, i + 1)
                        )
                      }
                      disabled={carouselIndex === previewFileList.length - 1}
                      className="rounded-full px-3 py-1 text-sm text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                    >
                      次へ →
                    </button>
                  </div>
                </div>
              )}

              {/* 保存ボタン */}
              <button
                onClick={handleSave}
                disabled={!canSave}
                className={`w-full rounded-full px-6 py-4 text-base font-semibold transition shadow-lg ${
                  canSave
                    ? "bg-slate-900 text-white hover:bg-slate-800 shadow-purple-200"
                    : "bg-slate-300 text-slate-500 cursor-not-allowed"
                }`}
              >
                {canSave
                  ? "すべてのファイルを保存"
                  : "保存先を選択してください"}
              </button>
            </div>
          )}

          {step === "saving" && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600"></div>
              <p className="text-lg font-medium text-slate-700">
                保存しています...
              </p>
            </div>
          )}

          {step === "success" && (
            <div className="text-center py-10 space-y-6">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg
                  className="h-10 w-10"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-800">
                完了しました！
              </h2>
              <div className="text-slate-600 space-y-1">
                {javaDirHandle && (
                  <p>
                    Java →{" "}
                    <span className="font-mono text-purple-600">
                      {javaDirHandle.name}
                    </span>
                  </p>
                )}
                {phpDirHandle && (
                  <p>
                    PHP →{" "}
                    <span className="font-mono text-purple-600">
                      {phpDirHandle.name}
                    </span>
                  </p>
                )}
              </div>
              <button
                onClick={reset}
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-8 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                続けて別のファイルを処理
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
