# Blessed Faith Academy — School Management System

Web-based school management for **Blessed Faith Academy** (Zambia). Staff can manage enrolment, fees and payments, attendance, school rules, discipline, and reports. Permissions are enforced in the app and in the database (Supabase Row Level Security).

**Currency:** Zambian Kwacha (ZMW), shown as `K…`  
**Payments:** Mobile money and bank transfer only (no cash)

## Documentation

| Document | Audience |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Office staff, teachers, bursar — how to use the system day to day |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Developers / IT — setup, migrations, env, architecture |

## Tech stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js Server Actions + Supabase (Postgres, Auth, RLS)
- **Validation:** Zod · **Forms:** React Hook Form

## Quick start

1. Copy `.env.example` to `.env.local` and fill in Supabase values (see [Operations](docs/OPERATIONS.md#environment-variables)).
2. Run all SQL migrations in order in the Supabase SQL Editor (see [Operations](docs/OPERATIONS.md#database-migrations)).
3. Install and run:

```bash
cd blessed-faith-academy
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in at `/login`.

## Features at a glance

| Area | Routes |
|---|---|
| Students | `/dashboard/students` |
| Applications | `/dashboard/applications` |
| Fees | `/dashboard/fees`, student profile, payment receipts |
| Attendance | `/dashboard/attendance`, covers |
| Rules & discipline | `/dashboard/rules`, `/dashboard/discipline` |
| Reports | `/dashboard/reports` (print + CSV) |
| Staff (admin only) | `/dashboard/staff` |

## Locked fee bands (2026)

| Item | Amount |
|---|---|
| Early childhood / Pre-grade tuition | K1,200 / term |
| Grades 1–7 tuition | K1,150 / term |
| Report book | K10 / year |
| PTA | K150 / year |
| Maintenance | K50 / year |
| Meals (optional) | Weekly K150 · Monthly K500 · Termly K1,400 |
| Uniforms | Optional priced items (charged once per year when opted in) |
| Requirements | Checklist only — not billed |

## Scripts

```bash
npm run dev     # local development
npm run build   # production build
npm run start   # run production build
npm run lint    # ESLint
```

## License

Private school project — not published as open source unless the school decides otherwise.
