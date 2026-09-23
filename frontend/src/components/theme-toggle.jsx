import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ className }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className={className}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="flex"
        >
          {theme === "dark" ? <Sun className="h-[1.15rem] w-[1.15rem]" /> : <Moon className="h-[1.15rem] w-[1.15rem]" />}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}
