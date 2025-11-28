"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type UploadState = "idle" | "uploading" | "success" | "error";

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [statusMessage, setStatusMessage] = useState("PDF を選択してください");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("java_sources.zip");
  const [baseDirectory, setBaseDirectory] = useState("");

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const handleFile = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      setSelectedFile(null);
      return;
    }
    const file = fileList[0];
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setErrorMessage("PDF 形式のファイルのみアップロードできます");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setErrorMessage(null);
    setStatusMessage(`${file.name} をアップロードします`);
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

  const resetDownload = () => {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
    setDownloadUrl(null);
    setDownloadName("java_sources.zip");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setErrorMessage("PDF ファイルを選択してください");
      return;
    }
    resetDownload();
    setUploadState("uploading");
    setStatusMessage("PDF から Java コードを抽出しています...");
    setErrorMessage(null);
    try {
      const formData = new FormData();
      formData.append("pdf", selectedFile);
      formData.append("base_directory", baseDirectory);
      const response = await fetch(`${API_BASE_URL}/extract`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const maybeJson = await response.json().catch(() => null);
        const detail = maybeJson?.detail ?? "抽出に失敗しました";
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (!blob.size) {
        throw new Error("空の ZIP が返却されました");
      }
      const objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);
      const disposition = response.headers.get("Content-Disposition");
      if (disposition) {
        const match = disposition.match(/filename="?([^";]+)"?/i);
        if (match?.[1]) {
          setDownloadName(match[1]);
        }
      }
      setUploadState("success");
      setStatusMessage("抽出が完了しました。ZIP をダウンロードできます。");
    } catch (error) {
      setUploadState("error");
      const message = error instanceof Error ? error.message : "不明なエラー";
      setErrorMessage(message);
      setStatusMessage("抽出に失敗しました");
    }
  };

  const handleDirectGeneration = async () => {
    if (!selectedFile) {
      setErrorMessage("PDF ファイルを選択してください");
      return;
    }

    // @ts-expect-error showDirectoryPicker is not standard yet
    if (typeof window.showDirectoryPicker !== "function") {
      setErrorMessage(
        "このブラウザはフォルダへの直接保存に対応していません。Chrome または Edge を使用してください。"
      );
      return;
    }

    try {
      // @ts-expect-error showDirectoryPicker is not standard yet
      const dirHandle = await window.showDirectoryPicker();
      if (!dirHandle) return;

      setUploadState("uploading");
      setStatusMessage("PDF から Java コードを抽出して保存しています...");
      setErrorMessage(null);

      const formData = new FormData();
      formData.append("pdf", selectedFile);
      formData.append("base_directory", baseDirectory);
      formData.append("response_format", "json");

      const response = await fetch(`${API_BASE_URL}/extract`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const maybeJson = await response.json().catch(() => null);
        const detail = maybeJson?.detail ?? "抽出に失敗しました";
        throw new Error(detail);
      }

      const files: Record<string, string> = await response.json();

      for (const [path, content] of Object.entries(files)) {
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

      setUploadState("success");
      setStatusMessage("ファイルの保存が完了しました。");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return; // User cancelled picker
      }
      setUploadState("error");
      const message = error instanceof Error ? error.message : "不明なエラー";
      setErrorMessage(message);
      setStatusMessage("保存に失敗しました");
    }
  };

  const triggerDownload = () => {
    if (!downloadUrl) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = downloadName;
    anchor.click();
  };

  const filePreview = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    const sizeInKb = (selectedFile.size / 1024).toFixed(1);
    return [
      { label: "ファイル名", value: selectedFile.name },
      { label: "サイズ", value: `${sizeInKb} KB` },
      {
        label: "更新日",
        value: selectedFile.lastModified
          ? new Date(selectedFile.lastModified).toLocaleString()
          : "-",
      },
    ];
  }, [selectedFile]);

  const canSubmit = Boolean(selectedFile) && uploadState !== "uploading";

  const statusTone = useMemo(() => {
    switch (uploadState) {
      case "uploading":
        return "text-amber-600";
      case "success":
        return "text-emerald-600";
      case "error":
        return "text-rose-600";
      default:
        return "text-slate-600";
    }
  }, [uploadState]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 via-slate-50 to-slate-100 px-4 py-10 text-slate-900">
      <main className="mx-auto w-full max-w-3xl space-y-8">
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

        <section className="rounded-3xl bg-white/95 p-6 shadow-2xl shadow-purple-100/60 backdrop-blur">
          <form className="space-y-6" onSubmit={handleSubmit}>
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

            {filePreview && (
              <dl className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3">
                {filePreview.map(({ label, value }) => (
                  <div key={label} className="space-y-1">
                    <dt className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                      {label}
                    </dt>
                    <dd className="truncate text-sm font-medium text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="space-y-2">
              <label
                htmlFor="base-dir"
                className="block text-sm font-medium text-slate-700"
              >
                保存先ディレクトリ (任意)
              </label>
              <div className="flex gap-2">
                <input
                  id="base-dir"
                  type="text"
                  value={baseDirectory}
                  onChange={(e) => setBaseDirectory(e.target.value)}
                  placeholder="例: src/main/java"
                  className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button
                  type="button"
                  onClick={() => document.getElementById("dir-input")?.click()}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  フォルダを選択
                </button>
                <input
                  id="dir-input"
                  type="file"
                  // @ts-expect-error webkitdirectory is not standard
                  webkitdirectory=""
                  directory=""
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      const path = files[0].webkitRelativePath;
                      // path is like "folder/file.txt" or "parent/child/file.txt"
                      // We want the directory part.
                      // If the user selected "src", and it has "main/java/...", path might be "src/main/java/..."
                      // Actually webkitRelativePath includes the selected folder name as the first segment.
                      // If I select "java" inside "src/main", and it has file "Test.java", path is "java/Test.java".
                      // So the base dir is "java".
                      // If I want "src/main/java", I need to select "src".

                      // Let's just take the directory of the first file.
                      const dir = path.substring(0, path.lastIndexOf("/"));
                      setBaseDirectory(dir);
                    }
                  }}
                />
              </div>
              <p className="text-xs text-slate-500">
                指定したディレクトリの下にパッケージ構成が作成されます。フォルダを選択するとそのパスが自動入力されます。
              </p>
            </div>

            <div>
              <p
                className={`text-sm font-medium ${statusTone}`}
                data-state={uploadState}
              >
                {statusMessage}
              </p>
              {errorMessage && (
                <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  {errorMessage}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadState === "uploading"
                  ? "抽出中..."
                  : "抽出して ZIP を生成"}
              </button>

              <button
                type="button"
                onClick={handleDirectGeneration}
                disabled={!canSubmit}
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                フォルダに直接生成
              </button>

              {downloadUrl && (
                <button
                  type="button"
                  onClick={triggerDownload}
                  className="inline-flex items-center justify-center rounded-full bg-purple-100 px-6 py-3 text-sm font-semibold text-purple-700 transition hover:bg-purple-200"
                >
                  ZIP をダウンロード
                </button>
              )}
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
