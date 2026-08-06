// ===== PDF 生成引擎（客户端，基于 html2pdf.js） =====

export interface PDFOptions {
  title: string;
  filename: string;
  elementId: string;
}

/**
 * 生成 PDF Blob（在浏览器端调用）
 */
export async function generatePDF(options: PDFOptions): Promise<Blob> {
  const element = document.getElementById(options.elementId);
  if (!element) throw new Error("报告内容元素未找到");

  // 动态导入，避免 SSR 时加载浏览器 API
  const html2pdf = (await import("html2pdf.js")).default;

  const opt = {
    margin: [15, 15, 15, 15] as [number, number, number, number],
    filename: options.filename,
    image: { type: "jpeg" as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#F6F4EC" },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const },
    pagebreak: { mode: ["css", "legacy"] },
  };

  return html2pdf().set(opt).from(element).outputPdf("blob");
}

/**
 * 触发浏览器下载 PDF
 */
export function downloadPDF(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
