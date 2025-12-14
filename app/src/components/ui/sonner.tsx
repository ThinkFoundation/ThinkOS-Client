import { useEffect, useState } from "react"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system")

  useEffect(() => {
    // Get initial theme
    const stored = localStorage.getItem("think_theme") as "light" | "dark" | "system" | null
    setTheme(stored || "system")

    // Listen for theme changes
    const handleThemeChange = () => {
      const newTheme = localStorage.getItem("think_theme") as "light" | "dark" | "system" | null
      setTheme(newTheme || "system")
    }

    window.addEventListener("themechange", handleThemeChange)
    return () => window.removeEventListener("themechange", handleThemeChange)
  }, [])

  return (
    <Sonner
      theme={theme}
      position="top-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
