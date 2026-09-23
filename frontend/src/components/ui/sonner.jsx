import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/theme-provider";

export function Toaster(props) {
  const { theme } = useTheme();
  return <Sonner theme={theme} richColors closeButton position="top-right" {...props} />;
}
