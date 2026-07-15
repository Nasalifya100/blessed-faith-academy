# User guide — Blessed Faith Academy SMS

Day-to-day instructions for staff using the School Management System.

Sign in at `/login`. Your name and role appear in the top bar. Use **Sign out** when finished.

---

## Who can see what

| Role | Students | Applications | Attendance | Fees | Rules | Discipline | Reports | Staff |
|---|---|---|---|---|---|---|---|---|
| Administrator | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Headteacher | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Secretary | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Bursar | ✓* | ✓* | — | ✓ | ✓ (view) | — | ✓ | — |
| Teacher | ✓* | ✓* | Homeroom + cover | — | ✓ (view) | ✓ | ✓ | — |

\*Nav always includes Students and Applications for logged-in staff; what you can change is limited by role in the database.

If your account is **deactivated**, you will see a message and cannot use the dashboard — contact an administrator.

---

## 1. Students

**Path:** Dashboard → Students

- Search and filter the student list.
- Open a student to see guardians, enrolment, fees, requirements, attendance history, and discipline.
- **Add student** (`/dashboard/students/new`) for an existing pupil who is not going through a new application.

Use the student profile as the home base for most fee, requirement, and discipline work.

---

## 2. Applications (new enrolments)

**Path:** Dashboard → Applications

1. **New application** — fill in the official enrolment details and guardian information.
2. Submit and leave the application in the list for review.
3. Headteacher / Admin **approve** (enrols the child into a class) or **reject**.

After approval, open the student profile to generate fees and continue the office process.

---

## 3. Fees and payments

**Path:** Dashboard → Fees (catalogue) · student profile (charges and payments)

### Generate mandatory charges
On the student profile, generate charges for the current term/year. This creates tuition and mandatory extras (report book, PTA, maintenance) according to the child’s grade.

### Optional meals and uniforms
- **Meals:** choose weekly, monthly, or termly (one meal option per term).
- **Uniforms:** charge individual items as needed (once per academic year per item).
- You can **remove** an optional charge that has not been paid, if the family changes their mind.

### Record a payment
1. Enter amount and method (**mobile money** or **bank transfer** only).
2. Save — the student’s balance updates.
3. Open the payment receipt and print if needed (`/dashboard/payments/[id]/receipt`).

Balances and statements appear on the student profile. Money is shown in Kwacha (e.g. `K1,150.00`).

---

## 4. Requirements checklist

On the student profile, tick items as parents bring them (e.g. boom paste, ream of paper). These are **not** fee charges — they are a progress checklist only.

---

## 5. Attendance

**Path:** Dashboard → Attendance

### Homeroom and cover
**Attendance → Homeroom & cover**

- Assign each class a **homeroom teacher**.
- Assign a temporary **cover** when another teacher must take the register.

Teachers only see classes they are responsible for (homeroom or active cover). Office roles (admin, headteacher, secretary) can take any class.

### Take the register
1. Choose a class and date.
2. Mark each pupil: **present**, **absent**, **late**, or **excused**.
3. Save.

Past marks for a student appear on their profile under attendance history.

---

## 6. School rules

**Path:** Dashboard → Rules

View the school rules. Administrators and headteachers can add or edit rules. Teachers and others with access can read them for reference when recording discipline.

---

## 7. Discipline

**Path:** Dashboard → Discipline · also on the student profile

1. **Record** an incident (student, what happened, linked rule if useful).
2. Incidents stay **open** until resolved.
3. Headteacher / Admin / Secretary can **resolve** with notes.

Filter the school-wide list by open, resolved, or all. The Reports hub also links to open incidents.

---

## 8. Reports

**Path:** Dashboard → Reports

| Report | Use |
|---|---|
| Fee balances | Who owes what; export CSV; print |
| Attendance by class | Summaries for a date range; CSV; print |
| Enrolment by class | How many pupils per class |
| Discipline | Snapshot of open cases |

Use **Print** for paper copies and **Download CSV** for Excel. Print layout hides the navigation bar.

---

## 9. Staff accounts (administrators only)

**Path:** Dashboard → Staff

- Create staff logins with the correct role.
- Deactivate accounts that should no longer access the system.

Do not share passwords. Each person should have their own account.

---

## Common problems

| Problem | What to try |
|---|---|
| Cannot sign in | Check email/password; ask admin if account is active |
| Teacher sees no classes for attendance | Set homeroom or assign cover under Homeroom & cover |
| Fees or buttons missing | Your role may not include fees (e.g. teachers) |
| No school rules listed | Ask IT to run the rules seed migration (see Operations guide) |
| Receipt will not print | Use the browser print dialog; ensure popup blockers allow it |

For technical setup, migrations, and developer notes, see [OPERATIONS.md](OPERATIONS.md).
