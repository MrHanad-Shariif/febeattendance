import { useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadFile } from "@/lib/attendance";

/**
 * "Download" menu with PDF and Excel (.xlsx) options. Both formats come from
 * the same server endpoint and filters (`params` + format=pdf|xlsx), so the
 * files always match what is on screen.
 */
export default function ExportMenu({ url, params = {}, name = "report", disabled = false, label = "Download" }) {
  const [busy, setBusy] = useState(null);

  async function download(format) {
    setBusy(format);
    try {
      await downloadFile(url, { ...params, format }, `FEBE_${name}.${format}`);
      toast.success(format === "pdf" ? "PDF downloaded" : "Excel file downloaded");
    } catch (err) {
      toast.error(await blobErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={disabled || busy !== null}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {busy ? `Preparing ${busy === "pdf" ? "PDF" : "Excel"}...` : label}
          <ChevronDown className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => download("pdf")}>
          <FileText /> Download PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download("xlsx")}>
          <FileSpreadsheet /> Download Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Errors on a blob request arrive as a Blob; read the JSON message out of it.
async function blobErrorMessage(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (parsed?.error) return parsed.error;
    } catch {
      /* not JSON */
    }
  }
  return apiErrorMessage(err, "The download failed. Please try again.");
}
