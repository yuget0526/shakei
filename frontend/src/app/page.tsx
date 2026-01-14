"use client";

import {
  useState,
  useCallback,
  ChangeEvent,
  DragEvent,
  useMemo,
  useEffect,
} from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type UploadState = "idle" | "uploading" | "success" | "error";
type Language = "java" | "php" | "auto";

const LANGUAGE_CONFIG = {
  java: {
    label: "Java",
    hint: "IntelliJ でプロジェクトを作成し、src フォルダを選択してください",
    storageKey: "shakei_java_dir",
  },
  php: {
    label: "PHP",
    hint: "XAMPP の htdocs フォルダ、または MAMP の www フォルダを選択してください",
    storageKey: "shakei_php_dir",
  },
  auto: {
    label: "自動検出",
    hint: "PDFから言語を自動検出します。保存先を選択してください",
    storageKey: "shakei_auto_dir",
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

// Window に showDirectoryPicker を追加
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
  const [showCarousel, setShowCarousel] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("auto");
  const [savedDirName, setSavedDirName] = useState<string | null>(null);

  // ローカルストレージから保存済みディレクトリ名を取得
  useEffect(() => {
    const storageKey = LANGUAGE_CONFIG[selectedLanguage].storageKey;
    const saved = localStorage.getItem(storageKey);
    setSavedDirName(saved);
  }, [selectedLanguage]);

  const handleFile = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }
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

  // 言語に応じてファイルをフィルタリング
  const filteredFiles = useMemo(() => {
    if (!extractedFiles) return {};
    if (selectedLanguage === "auto") return extractedFiles;

    const filtered: Record<string, string> = {};
    const ext = selectedLanguage === "java" ? ".java" : ".php";

    for (const [path, content] of Object.entries(extractedFiles)) {
      if (path.toLowerCase().endsWith(ext)) {
        filtered[path] = content;
      }
    }
    return filtered;
  }, [extractedFiles, selectedLanguage]);

  const handleDirectGeneration = async () => {
    if (!filteredFiles || Object.keys(filteredFiles).length === 0) {
      setErrorMessage("保存するファイルがありません");
      return;
    }

    if (typeof window.showDirectoryPicker !== "function") {
      setErrorMessage(
        "このブラウザはフォルダへの直接保存に対応していません。Chrome または Edge を使用してください。"
      );
      return;
    }

    try {
      const dirHandle: FileSystemDirectoryHandle =
        await window.showDirectoryPicker();
      if (!dirHandle) return;

      // ディレクトリ名をローカルストレージに保存
      const storageKey = LANGUAGE_CONFIG[selectedLanguage].storageKey;
      localStorage.setItem(storageKey, dirHandle.name);
      setSavedDirName(dirHandle.name);

      setStep("saving");
      setStatusMessage("ファイルを保存しています...");

      for (const [path, content] of Object.entries(filteredFiles)) {
        const parts = path.split("/");
        let currentHandle = dirHandle;

        // Navigate/Create directories
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          currentHandle = await currentHandle.getDirectoryHandle(part, {
            create: true,
          });
        }

        // Write file
        const fileName = parts[parts.length - 1];
        const fileHandle = await currentHandle.getFileHandle(fileName, {
          create: true,
        });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      }

      setStep("success");
      setStatusMessage("ファイルの保存が完了しました。");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setStep("preview");
        return;
      }
      setStep("preview");
      setUploadState("error");
      const message = error instanceof Error ? error.message : "不明なエラー";
      setErrorMessage(message);
      setStatusMessage("保存に失敗しました");
    }
  };

  const fileList = useMemo(() => {
    return Object.keys(filteredFiles).sort();
  }, [filteredFiles]);

  const currentFileContent = useMemo(() => {
    if (fileList.length === 0) return "";
    return filteredFiles[fileList[carouselIndex]] || "";
  }, [filteredFiles, fileList, carouselIndex]);

  // 検出されたファイル言語の統計
  const detectedLanguages = useMemo(() => {
    if (!extractedFiles) return { java: 0, php: 0 };
    let java = 0;
    let php = 0;
    for (const path of Object.keys(extractedFiles)) {
      if (path.endsWith(".java")) java++;
      if (path.endsWith(".php")) php++;
    }
    return { java, php };
  }, [extractedFiles]);

  const reset = () => {
    setStep("upload");
    setExtractedFiles(null);
    setShowCarousel(false);
    setCarouselIndex(0);
    setUploadState("idle");
    setStatusMessage("PDF を選択してください");
    setErrorMessage(null);
  };

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

              {/* 言語統計 */}
              <div className="flex gap-4 text-sm">
                <span className="px-3 py-1 rounded-full bg-orange-100 text-orange-700">
                  Java: {detectedLanguages.java}ファイル
                </span>
                <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700">
                  PHP: {detectedLanguages.php}ファイル
                </span>
              </div>

              {/* 言語セレクター */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">
                  保存する言語を選択
                </label>
                <div className="flex gap-2">
                  {(Object.keys(LANGUAGE_CONFIG) as Language[]).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => {
                        setSelectedLanguage(lang);
                        setCarouselIndex(0);
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                        selectedLanguage === lang
                          ? "bg-purple-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {LANGUAGE_CONFIG[lang].label}
                      {lang !== "auto" && (
                        <span className="ml-1 opacity-70">
                          (
                          {lang === "java"
                            ? detectedLanguages.java
                            : detectedLanguages.php}
                          )
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {savedDirName && (
                  <p className="text-xs text-slate-500">
                    前回の保存先:{" "}
                    <span className="font-mono">{savedDirName}</span>
                  </p>
                )}
              </div>

              {fileList.length === 0 ? (
                <div className="rounded-xl bg-amber-50 p-4 text-center">
                  <p className="text-amber-700">
                    選択した言語のファイルがありません
                  </p>
                </div>
              ) : !showCarousel ? (
                <div className="space-y-4">
                  <ul className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-mono text-slate-700">
                    {fileList.map((file) => (
                      <li
                        key={file}
                        className="py-1 border-b border-slate-100 last:border-0"
                      >
                        {file}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setShowCarousel(true)}
                      className="inline-flex items-center justify-center rounded-full bg-purple-100 px-6 py-3 text-sm font-semibold text-purple-700 transition hover:bg-purple-200"
                    >
                      プレビューを見る
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-slate-50 shadow-inner">
                    <div className="mb-2 flex items-center justify-between border-b border-slate-700 pb-2">
                      <span className="font-mono text-sm text-purple-300">
                        {fileList[carouselIndex]}
                      </span>
                      <span className="text-xs text-slate-400">
                        {carouselIndex + 1} / {fileList.length}
                      </span>
                    </div>
                    <pre className="h-80 overflow-auto whitespace-pre font-mono text-xs leading-relaxed">
                      <code>{currentFileContent}</code>
                    </pre>
                  </div>

                  <div className="flex items-center justify-between px-2">
                    <button
                      onClick={() =>
                        setCarouselIndex((i) => Math.max(0, i - 1))
                      }
                      disabled={carouselIndex === 0}
                      className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                      ← 前へ
                    </button>
                    <div className="flex gap-1 flex-wrap max-w-xs justify-center">
                      {fileList.length <= 20 &&
                        fileList.map((_, idx) => (
                          <div
                            key={idx}
                            className={`h-1.5 w-1.5 rounded-full ${
                              idx === carouselIndex
                                ? "bg-purple-500"
                                : "bg-slate-300"
                            }`}
                          />
                        ))}
                    </div>
                    <button
                      onClick={() =>
                        setCarouselIndex((i) =>
                          Math.min(fileList.length - 1, i + 1)
                        )
                      }
                      disabled={carouselIndex === fileList.length - 1}
                      className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                    >
                      次へ →
                    </button>
                  </div>

                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <div className="rounded-lg bg-amber-50 p-3 text-center">
                      <p className="text-sm font-medium text-amber-800">
                        {LANGUAGE_CONFIG[selectedLanguage].hint}
                      </p>
                    </div>
                    <button
                      onClick={handleDirectGeneration}
                      className="w-full inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-4 text-base font-semibold text-white transition hover:bg-slate-800 shadow-lg shadow-purple-200"
                    >
                      フォルダを選択して保存 ({fileList.length}ファイル)
                    </button>
                  </div>
                </div>
              )}
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
              <p className="text-slate-600">
                {savedDirName && (
                  <span className="font-mono text-purple-600">
                    {savedDirName}
                  </span>
                )}
                {savedDirName && " に"}ファイルが保存されました。
              </p>
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
