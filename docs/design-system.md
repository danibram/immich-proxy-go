# Design System

## Philosophy

This application uses a **Glassmorphism** design language - a modern aesthetic characterized by frosted glass effects, subtle transparency, and soft, luminous colors. The design evokes a sense of depth and elegance while maintaining excellent readability.

## Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| **Powder Blush** | `#ffa69e` | Warm accents, upload indicators, notifications |
| **Vanilla Cream** | `#faf3dd` | Light backgrounds, highlights, cards on light mode |
| **Icy Aqua** | `#b8f2e6` | Primary accents, progress bars, interactive states, success |
| **Light Blue** | `#aed9e0` | Secondary accents, icons, subtle highlights |
| **Blue Slate** | `#5e6472` | Primary buttons, headers, text on light backgrounds |

### Color Psychology

- **Powder Blush**: Delicate, soft peach-pink that radiates warmth and approachability
- **Vanilla Cream**: Creamy, inviting hue evoking comfort and understated elegance
- **Icy Aqua**: Frosty and sparkling, conveying freshness and clarity
- **Light Blue**: Soft pastel conveying open skies and calm
- **Blue Slate**: Cool authority and depth, grounding the palette

## Glassmorphism Principles

### Core Characteristics

1. **Frosted Glass Effect**
   - Background blur: `backdrop-blur-xl` (24px)
   - Semi-transparent backgrounds: `bg-white/5` to `bg-white/10`
   - Subtle borders: `border-white/10`

2. **Layered Depth**
   - Multiple layers of transparency create depth
   - Cards float above backgrounds
   - Shadows are soft and diffused

3. **Luminous Accents**
   - Colors from the palette used as glowing accents
   - Subtle gradients add dimension
   - Interactive elements have gentle glow effects

### Glass Component Recipe

```css
.glass {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
}

.glass-hover:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
}
```

### Dark Mode (Primary)

The app is designed dark-mode first:
- Base background: `#0a0a0a` (near black)
- Card surfaces: `#141414`
- Elevated surfaces: `#1a1a1a`
- Text: White with varying opacity (100%, 80%, 60%, 40%)

## Typography

- **Font Family**: Inter (with system fallbacks)
- **Headings**: Bold (700), tight tracking
- **Body**: Regular (400), comfortable line height
- **Small text**: Medium (500), slightly increased tracking

## Components

### Buttons

**Primary Button**
```
bg-blue-slate hover:bg-blue-slate/80 text-white
```

**Secondary Button**
```
bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10
```

**Accent Button**
```
bg-icy-aqua hover:bg-icy-aqua/80 text-gray-900
```

### Cards

```
bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl
```

### Inputs

```
bg-white/5 border border-white/10 rounded-xl
focus:border-icy-aqua focus:ring-1 focus:ring-icy-aqua
```

### Progress Indicators

- Spinner: `border-icy-aqua border-t-transparent`
- Progress bar: `bg-icy-aqua` on `bg-white/10` track

## Gradients

### Primary Gradient
```
bg-gradient-to-br from-blue-slate to-icy-aqua
```

### Accent Gradient
```
bg-gradient-to-br from-light-blue to-icy-aqua
```

### Subtle Background Gradient
```
bg-gradient-to-br from-blue-slate/20 to-icy-aqua/20
```

## Shadows

Shadows are used sparingly and are soft:

```css
shadow-lg shadow-blue-slate/10
```

## Animation

- **Transitions**: 200ms ease for interactions
- **Hover states**: Smooth color and opacity changes
- **Modals**: Scale and fade animations
- **Loading**: Smooth spinner rotation

## Accessibility

- Minimum contrast ratio of 4.5:1 for text
- Focus states are clearly visible
- Interactive elements have appropriate hover/active states
- Color is not the only means of conveying information
