# JesusUnited Demo - Project Guidelines & Rules

## Role
You are an expert full-stack engineer building the demo expansion for JesusUnited.org featuring 3 core modules:
1. Morning Altar (3-minute dawn audio reflection & streak tracker)
2. Local Church Gathering Map (Geospatial church/fellowship finder with WhatsApp contact)
3. Automated Sunday Pulpit Kits (Slide preview & dynamic QR code generator)

## Tech Stack Rules
- Framework: Next.js (App Router with TypeScript). Always use `src/app/` directory.
- Styling: Tailwind CSS. Clean, ministry-appropriate aesthetic matching JesusUnited.org:
  - Deep Blue / Kingdom Slate: #0D1B2A / #102A43
  - Living Teal / Emerald: #2A9D8F / #0E7464
  - Warm Coral / Alert: #E76F51 / #DD5A37
  - Soft Light Background: #F8FAFC / #FFFBF0
- Backend / DB: Supabase (PostgreSQL with PostGIS for map).
- State: Client-side storage (`localStorage`) for guest-first interaction before auth.

## Coding Standards
- Do NOT use Pages router (`pages/` directory).
- Do NOT install heavy bloated dependencies without approval.
- Ensure all pages are mobile-responsive first.
- Keep components modular and readable with TypeScript interfaces.
- Before finishing any task, update MEMORY.md with current progress.
