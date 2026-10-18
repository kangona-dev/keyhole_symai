"use client";

import { useRef, useState, type FormEvent } from "react";
import { compressImage } from "@/lib/compress-image";
import { buttonClass, inputClass } from "@/components/ui";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Upload form that shrinks photos in the browser first, then submits normally
 * to /api/documents. Without JavaScript it still works and uploads the original.
 */
export default function DocumentUploadForm() {
  const ready = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (ready.current) return; // second pass: let the browser submit
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!input || !file) return;
    setError(null);
    setBusy(true);
    try {
      const smaller = await compressImage(file);
      if (smaller !== file) {
        const dt = new DataTransfer();
        dt.items.add(smaller);
        input.files = dt.files;
      }
    } catch {
      // Keep the original file; the server resizes it anyway.
    }
    if ((input.files?.[0]?.size ?? 0) > MAX_BYTES) {
      setBusy(false);
      setError("That image is over 4 MB even after compressing. Try a smaller photo.");
      return;
    }
    ready.current = true;
    form.requestSubmit();
    ready.current = false;
  }

  return (
    <form action="/api/documents" method="post" encType="multipart/form-data" className="space-y-4" onSubmit={onSubmit}>
      <div>
        <label htmlFor="type" className="mb-1 block text-sm font-medium">Document type</label>
        <select id="type" name="type" className={inputClass} defaultValue="payslip">
          <option value="id">ID document (stays locked until you&apos;re preferred)</option>
          <option value="payslip">Payslip</option>
          <option value="reference">Rental reference</option>
        </select>
      </div>
      <div>
        <label htmlFor="file" className="mb-1 block text-sm font-medium">Image (PNG or JPG). Large photos are shrunk before upload.</label>
        <input id="file" name="file" type="file" accept="image/png,image/jpeg" required className="block w-full text-sm" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      )}
      <button className={buttonClass} disabled={busy}>
        {busy ? "Uploading…" : "Upload"}
      </button>
      <p className="text-xs text-slate-500">
        Use sample documents only. Download test files:{" "}
        <a className="underline" href="/samples/sample-id.png" download>ID</a>,{" "}
        <a className="underline" href="/samples/sample-payslip.png" download>payslip</a>,{" "}
        <a className="underline" href="/samples/sample-reference.png" download>reference</a>.
      </p>
    </form>
  );
}
