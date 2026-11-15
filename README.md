# CareCircle AI — Elderly Care & Medication Management Platform

An accessible, interconnected healthcare platform built for **PromptWars x Catalyst** that empowers elderly individuals, family members, and caretakers to manage medications, track adherence, and coordinate doctor appointments.

## Key Features
- **Passcode-Protected Shared Profiles:** Secure `bcryptjs`-hashed passcodes allow authorized caregivers and family members to manage an elderly person's profile.
- **Dual-Mode Accessible UI:** High-contrast, WCAG-friendly **Senior Mode** (large fonts, one-tap "Mark as Taken") and **Caregiver Dashboard** (schedule management).
- **Adaption Labs AI Integration:** Translates complex prescription instructions into simple, senior-friendly daily steps.
- **Proactive Email Alerts:** Automated caregiver notifications via Nodemailer for pending medications and upcoming appointments.

## Demo Credentials
- **Profile ID:** `demo-elder`
- **Passcode:** `123456`

## Local Setup & Testing
```bash
npm install
npm test
npm start
```
