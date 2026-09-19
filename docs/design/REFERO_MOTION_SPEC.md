# Refero-Inspired Motion & UI/UX Specification

## 1. Visual Hierarchy & Canvas Tokens
- **Canvas Backdrop**: Deep space absolute black `#000000` or `#020409`. Eliminate all tinted beige or light bounding wrappers.
- **Stage Presence**: Full viewport coverage (`min-h-[85vh]` on desktop, `min-h-[78vh]` on mobile) commanding primary visual focus.
- **Atmospheric Glow**: Outer Fresnel shell (radius * 1.04) rendering an electric cyan/sapphire glow (`#38bdf8` to `#60a5fa`) with additive blending.

## 2. Glassmorphism HUD Tokens (Refero Dark Mode)
- **Floating Controls Surface**:
  - Background: `rgba(15, 23, 42, 0.65)` (obsidian glass)
  - Blur: `backdrop-blur-xl`
  - Border: `1px solid rgba(255, 255, 255, 0.12)`
  - Shadow: `0 8px 32px 0 rgba(0, 0, 0, 0.45)`
  - Text: Pure white (`#FFFFFF`) with muted secondary accents (`#94A3B8`).

## 3. Character Billboard & Tag Geometry
- **Character Sprite**: Vertical standing posture rooted perpendicular to the sphere normal at $(R + 4.2)$.
- **Name Tag Pill**: Crisp white speech bubble badge (`#FFFFFF`, text `#0F172A`, font-semibold, rounded-full, px-2.5 py-1) suspended directly above the avatar sprite head.
- **Orientation**: Camera-locked billboard (`lookAt(camera.position)` or `THREE.Sprite`).

## 4. Micro-Interactions & Motion Dynamics
- **Orbit Drag**: Damped inertia with exponential decay (`factor: 0.05`). Smooth spin deceleration.
- **Zoom Constraints**: Distance clamped to $[130, 380]$. Pitch clamped to $[0.25, \pi - 0.25]$ to eliminate flipping.
- **Bottom Drawer Peek**: Slides up smoothly via CSS `transform: translateY(0)` with `transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`.
