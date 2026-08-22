import { useTheme } from "../theme/theme-provider";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
      {theme === "dark" ? "LIGHT" : "DARK"}
    </Button>
  );
}
