# 🚀 FinPilot Production Deployment Guide

This guide walks you through deploying FinPilot to production with **Supabase (PostgreSQL + RLS)**, **Google OAuth Authentication**, and the **Munim AI Copilot (Gemini)** so that everything runs smoothly with zero errors.

---

## 📋 Pre-Deployment Checklist

Before deploying, make sure you have:
1. A **Supabase** account ([supabase.com](https://supabase.com)) — Free tier is plenty.
2. A **Google Cloud Console** project for Google OAuth ([console.cloud.google.com](https://console.cloud.google.com)).
3. A **Google Gemini API Key** ([aistudio.google.com](https://aistudio.google.com)).
4. A deployment platform account (such as **Render**, **Railway**, **Fly.io**, or **Vercel**).

---

## 🗄️ Step 1: Set Up Supabase Database (1 Click)

1. Open your project on [Supabase Dashboard](https://supabase.com/dashboard).
2. Click **SQL Editor** in the left sidebar.
3. Click **New Query**.
4. Open the file [`supabase/complete_setup.sql`](./supabase/complete_setup.sql) in your code editor, copy the entire content, and paste it into the Supabase SQL Editor.
5. Click **Run** (green button).

> **What this does:**
> - Creates all core tables (`categories`, `transactions`, `imports`, `recurring_rules`, `flags`, `goals`, `scenarios`).
> - Creates Munim AI tables (`chat_conversations`, `chat_messages`, `chat_proposals`, `chat_usage`).
> - Enables **Row Level Security (RLS)** on all tables so users only ever see their own financial data.
> - Creates performance indexes and automatic updated timestamps.

---

## 🔑 Step 2: Configure Google OAuth in Supabase

1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Create or select your project.
3. Go to **APIs & Services > Credentials** and click **Create Credentials > OAuth client ID**.
4. Application type: **Web application**.
5. Under **Authorized redirect URIs**, add your Supabase callback URL:
   ```
   https://<your-supabase-project-id>.supabase.co/auth/v1/callback
   ```
   *(Find this in Supabase Dashboard > Authentication > Providers > Google)*.
6. Copy the generated **Client ID** and **Client Secret**.
7. Go to **Supabase Dashboard > Authentication > Providers > Google**:
   - Toggle **Google** to **Enabled**.
   - Paste your **Client ID** and **Client Secret**.
   - Under **URL Configuration**, add your deployed production URL to **Redirect URLs**:
     ```
     https://<your-app-name>.onrender.com/index.html
     ```
   - Click **Save**.

---

## 🌐 Step 3: Deploy Backend & Frontend (e.g. Render / Railway)

FinPilot is a Node.js + Express app that serves both the API and the static frontend from the same server.

### Option A: Deploy on Render.com (Recommended - Free Web Service)
1. Push your code to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "FinPilot initial release"
   git remote add origin https://github.com/<your-username>/finpilot.git
   git push -u origin main
   ```
2. Log in to [Render.com](https://render.com) and click **New > Web Service**.
3. Select your GitHub repository.
4. Settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Node Version**: Node 18 or 20 (auto-detected from `package.json`).
5. Under **Environment Variables**, add:
   ```env
   NODE_ENV=production
   PORT=3000
   SUPABASE_URL=https://<your-project-id>.supabase.co
   SUPABASE_ANON_KEY=<your-supabase-anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
   LLM_PROVIDER=gemini
   LLM_MODEL=gemini-flash-lite-latest
   GEMINI_API_KEY=<your-gemini-api-key>
   DAILY_TOKEN_BUDGET=50000
   CHAT_MAX_ITERATIONS=6
   ```
6. Click **Deploy Web Service**.

---

### Option B: Deploy on Railway.app
1. Go to [Railway.app](https://railway.app) and create a **New Project**.
2. Select **Deploy from GitHub repo**.
3. In the project settings, add the same Environment Variables listed above.
4. Railway will automatically detect Node.js, run `npm install`, and launch `npm start`.
5. Under **Settings > Networking**, click **Generate Domain**.

---

## ✅ Step 4: Verify Your Live Deployment

Once deployed, test each of these items on your live domain:

1. **Health Check**:
   Open `https://<your-domain>/api/health` in your browser. It should respond:
   ```json
   { "status": "ok", "service": "FinPilot AI Personal Finance Copilot", "version": "1.0.0" }
   ```

2. **Sign In**:
   - Go to `https://<your-domain>/login.html`.
   - Click **Continue with Google** — it should redirect to Google OAuth and return you to the dashboard with your Google name and avatar.
   - Alternatively, test signing up with email/password.

3. **Hands-Free Voice Transaction**:
   - Click the **Voice Add** button in the header.
   - Click the microphone and say: *"300 for shopping"* or *"500 petrol"*.
   - Confirm the transaction and verify it adds to your live dashboard.

4. **Munim AI Copilot**:
   - Open the chatbot drawer and ask: *"What is my expense?"*
   - Munim will fetch your live transactions from Supabase and answer accurately with zero arithmetic hallucinations.

---

## 🔒 Security Best Practices in Production
- **Never commit `.env` to GitHub**: The included [`.gitignore`](./.gitignore) automatically protects your API keys.
- **Service Role Key Safety**: The backend never sends the `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- **Client RLS Enforcement**: All database queries are executed with the user's personal JWT session token, enforcing strict Row Level Security.
