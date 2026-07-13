export const Boxel = `:root {
  --background: var(--boxel-100);
  --foreground: var(--boxel-700);
  --card: var(--boxel-light);
  --card-foreground: var(--boxel-dark);
  --popover: var(--boxel-light);
  --popover-foreground: var(--boxel-dark);
  --primary: var(--boxel-highlight);
  --primary-foreground: var(--boxel-dark);
  --secondary: var(--boxel-100);
  --secondary-foreground: var(--boxel-dark);
  --muted: var(--boxel-100);
  --muted-foreground: var(--boxel-450);
  --accent: oklch(0.931 0 0);
  --accent-foreground: oklch(0 0 0);
  --destructive: var(--boxel-danger);
  --destructive-foreground: var(--boxel-light-100);
  --border: var(--boxel-border-color);
  --input: oklch(1 0 0);
  --ring: var(--boxel-highlight);
  --chart-1: oklch(0.5838 0.299 307.6101);
  --chart-2: oklch(0.5354 0.2684 283.1486);
  --chart-3: oklch(0.9194 0.2182 125.1586);
  --chart-4: oklch(0.5641 0.2301 259.998);
  --chart-5: oklch(0.8277 0.2119 149.9571);
  --sidebar: var(--boxel-200);
  --sidebar-foreground: var(--boxel-dark);
  --sidebar-primary: var(--boxel-highlight);
  --sidebar-primary-foreground: var(--boxel-dark);
  --sidebar-accent: oklch(0.931 0 0);
  --sidebar-accent-foreground: oklch(0 0 0);
  --sidebar-border: oklch(0.8669 0 0);
  --sidebar-ring: oklch(0.8859 0.1865 164.8865);
  --font-sans: 'IBM Plex Sans', 'Helvetica Neue', Arial, ui-sans-serif, sans-serif, system-ui;
  --font-serif: 'IBM Plex Serif', 'Georgia', Times, serif;
  --font-mono: 'IBM Plex Mono', 'Menlo', 'Courier New', Courier, ui-monospace, monospace;
  --radius: 0.625rem;
  --shadow-x: 0;
  --shadow-y: 1px;
  --shadow-blur: 3px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.1;
  --shadow-color: oklch(0 0 0);
  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 1px 2px -1px hsl(0 0% 0% / 0.1);
  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.1), 0 1px 2px -1px hsl(0 0% 0% / 0.1);
  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 2px 4px -1px hsl(0 0% 0% / 0.1);
  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 4px 6px -1px hsl(0 0% 0% / 0.1);
  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 8px 10px -1px hsl(0 0% 0% / 0.1);
  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);
  --tracking-normal: 0.01em;
  --spacing: 0.25rem;
  --boxel-switch-background: var(--boxel-400);
  --success: var(--boxel-success);
  --success-foreground: var(--boxel-success-foreground);
  --warning: var(--boxel-warning);
  --warning-foreground: var(--boxel-warning-foreground);
}

.dark {
  --background: oklch(0.2663 0.0245 298.8206);
  --foreground: oklch(1 0 0);
  --card: oklch(0.3541 0.031 289.8048);
  --card-foreground: oklch(1 0 0);
  --popover: oklch(0.4211 0.0203 300.7169);
  --popover-foreground: oklch(1 0 0);
  --primary: oklch(0.8859 0.1865 164.8865);
  --primary-foreground: oklch(0 0 0);
  --secondary: oklch(0 0 0);
  --secondary-foreground: oklch(1 0 0);
  --muted: oklch(0.4211 0.0203 300.7169);
  --muted-foreground: oklch(0.7565 0.0113 286.1261);
  --accent: oklch(0.5769 0.0259 290.9642);
  --accent-foreground: oklch(1 0 0);
  --destructive: oklch(0.6763 0.2115 24.8106);
  --destructive-foreground: oklch(0.9672 0 0);
  --border: oklch(0.4386 0 0);
  --input: oklch(0 0 0);
  --ring: oklch(0.8859 0.1865 164.8865);
  --chart-1: oklch(0.5838 0.299 307.6101);
  --chart-2: oklch(0.5354 0.2684 283.1486);
  --chart-3: oklch(0.9194 0.2182 125.1586);
  --chart-4: oklch(0.5641 0.2301 259.998);
  --chart-5: oklch(0.8277 0.2119 149.9571);
  --sidebar: oklch(0.3541 0.031 289.8048);
  --sidebar-foreground: oklch(1 0 0);
  --sidebar-primary: oklch(0.8859 0.1865 164.8865);
  --sidebar-primary-foreground: oklch(0 0 0);
  --sidebar-accent: oklch(0.5769 0.0259 290.9642);
  --sidebar-accent-foreground: oklch(1 0 0);
  --sidebar-border: oklch(0.4386 0 0);
  --sidebar-ring: oklch(0.8859 0.1865 164.8865);
  --font-sans: 'IBM Plex Sans', 'Helvetica Neue', Arial, ui-sans-serif, sans-serif, system-ui;
  --font-serif: 'IBM Plex Serif', 'Georgia', Times, serif;
  --font-mono: 'IBM Plex Mono', 'Menlo', 'Courier New', Courier, ui-monospace, monospace;
  --radius: 0.625rem;
  --shadow-x: 0;
  --shadow-y: 1px;
  --shadow-blur: 3px;
  --shadow-spread: 0px;
  --shadow-opacity: 0.1;
  --shadow-color: oklch(0 0 0);
  --shadow-2xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-xs: 0 1px 3px 0px hsl(0 0% 0% / 0.05);
  --shadow-sm: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 1px 2px -1px hsl(0 0% 0% / 0.1);
  --shadow: 0 1px 3px 0px hsl(0 0% 0% / 0.1), 0 1px 2px -1px hsl(0 0% 0% / 0.1);
  --shadow-md: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 2px 4px -1px hsl(0 0% 0% / 0.1);
  --shadow-lg: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 4px 6px -1px hsl(0 0% 0% / 0.1);
  --shadow-xl: 0 1px 3px 0px hsl(0 0% 0% / 0.1),
    0 8px 10px -1px hsl(0 0% 0% / 0.1);
  --shadow-2xl: 0 1px 3px 0px hsl(0 0% 0% / 0.25);
}`;
