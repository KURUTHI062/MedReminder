# MedReminder

A MongoDB-backed medication reminder app with a React frontend and Express backend.

## Install

From the project root:

```bash
npm install
```

This project uses npm workspaces, so the frontend and backend dependencies are installed together from the root.

## Configure MongoDB

The app supports both caregiver login and a senior PIN login flow. Senior profiles can optionally store a 4–6 digit PIN and trusted device records.

Create the backend environment file:

```bash
copy backend\.env.example backend\.env
```

Then update the values in `backend/.env`:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=medreminder
JWT_SECRET=change-this-to-a-long-random-secret
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
```

### Local MongoDB setup

1. Install MongoDB locally or run MongoDB in Docker.
2. Make sure the MongoDB server is running on `mongodb://127.0.0.1:27017`.
3. Confirm the database `medreminder` is accessible.

### MongoDB Atlas setup

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/
MONGODB_DB_NAME=medreminder
```

Do not commit or share real production secrets.

## Run the app

From the project root:

```bash
npm run dev
```

This starts both services together:

- Frontend: http://localhost:5173
- Backend: http://localhost:5000
- Health check: http://localhost:5000/api/health

## Environment variables

- `backend/.env` contains local runtime values.
- `backend/.env.example` is the template version.
- `frontend/.env.example` shows frontend variables such as the Vite API base path.

## API

The frontend communicates with the backend through the Vite proxy using `/api`, so requests are forwarded to `http://localhost:5000`.

## Senior and caregiver features

- Caregivers can create linked senior profiles from the Patients page, assign a 4–6 digit PIN, reset PINs, revoke trusted devices, and monitor dose adherence and stock.
- Senior PINs are bcrypt-hashed, login errors do not reveal whether an email exists, and five failed PIN attempts lock the senior account for 15 minutes. PIN login is also limited to ten attempts per client IP every 15 minutes in each backend process; multi-instance deployments should use a shared rate-limit store.
- Trusted-device credentials are random, stored as hashes in MongoDB, and delivered to the browser in an HttpOnly SameSite cookie. Revoking a trusted device invalidates sessions issued through that device immediately; resetting a PIN signs out all senior sessions and trusted devices.
- Caregiver medicine management uses an ownership-checked `X-Senior-Id` scope; a caregiver cannot access another caregiver's senior.
- Dose actions are persisted in MongoDB and resolved transitions use conditional updates. A dose cannot be changed from Taken/Skipped/Missed by a second request.
- Snooze supports 5, 10, or 15 minutes, up to three times for a dose. Weekly schedules can be configured by weekday.
- Caregiver corrections require a reason and add an audit record. Caregiver reports are calculated from real resolved dose history for today, seven days, or thirty days.
- The backend scheduler checks for due and missed doses every 30 seconds. Configure `MISSED_GRACE_MINUTES` in the backend and matching `VITE_MISSED_GRACE_MINUTES` in the frontend (default: 30) for the same grace period.
- Optional background Web Push is implemented with a service worker and deduplicated reminder delivery records. Transient failures and missing subscriptions are retried up to five attempts, five minutes apart, while the reminder window remains open. Generate a VAPID key pair with `npx web-push generate-vapid-keys` and configure `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_SUBJECT` in `backend/.env`. Users still need to enable browser notification permission. Without those keys, only app-open reminders are available.
- Voice entry uses the browser's speech-recognition API when available and opens the normal edit/confirmation form before saving. No OCR provider is configured; the scan control reports that limitation instead of pretending to extract a prescription.

## Notes

- MongoDB is the only database used by the app.
- Supabase and related dependencies have been removed.
- JWT authentication is used for secure user access.
- Socket.IO is not installed; caregiver dashboards refresh via short polling. Prescription OCR is not configured; no OCR provider is connected.
