# Supabase Setup — Step by Step

Ye 10 minute ka kaam hai. Sab free. Order important hai — upar se neeche karo.

---

## Step 1 — Supabase project banao

1. [supabase.com](https://supabase.com) kholo → **Start your project** → GitHub se sign in
2. **New project** dabao
3. Bharo:
   - **Name:** `lately`
   - **Database Password:** strong password generate karo → **kahin save kar lo** (baad mein dobara nahi dikhega)
   - **Region:** `South Asia (Mumbai)` — India se sabse tez
   - **Plan:** Free
4. **Create new project** → 2 minute lagega provision hone mein

---

## Step 2 — Tables banao (migration chalao)

1. Left sidebar → **SQL Editor** → **New query**
2. `supabase/migrations/0001_init.sql` ka **pura content** copy karke paste karo
3. **Run** (ya Ctrl+Enter)
4. `Success. No rows returned` dikhna chahiye

Ye banata: 4 table (`reels`, `categories`, `notes`, `profiles`), auto full-text `search_vector` column, GIN index, aur RLS on.

---

## Step 3 — Seed data daalo

1. Wahi SQL Editor → **New query**
2. `supabase/seed.sql` ka content paste karo → **Run**

Ye daalta: dev user ka profile + tumhari 6 default category (Dev & Tools, Career & Jobs, Food & Places, Fitness, Style & Vibes, Watch Later).

Dobara chalane se duplicate nahi hoga — safe hai.

---

## Step 4 — Keys copy karo

1. Left sidebar → **Project Settings** (gear icon) → **API**
2. Do cheez chahiye:
   - **Project URL** → jaise `https://abcdefgh.supabase.co`
   - **anon public** key → lamba `eyJ...` string

> `service_role` key **kabhi mat** use karna app mein — wo sab RLS bypass kar deti. Sirf `anon` chahiye.

---

## Step 5 — AI keys lo (free)

**Groq** (audio → transcript):
1. [console.groq.com](https://console.groq.com) → sign in
2. **API Keys** → **Create API Key** → copy

**Gemini** (samajh + category + tags):
1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → sign in
2. **Create API key** → copy

Dono skip bhi kar sakte — app phir bhi chalega, bas card "partial" rahenge (caption only, koi category/tag nahi).

---

## Step 6 — .env banao

Project folder mein `.env.example` ko copy karke `.env` naam do, phir bharo:

```
EXPO_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
EXPO_PUBLIC_DEV_USER_ID=00000000-0000-0000-0000-000000000001
EXPO_PUBLIC_GROQ_API_KEY=gsk_...
EXPO_PUBLIC_GEMINI_API_KEY=AIza...
```

`.env` gitignored hai — GitHub pe nahi jayega.

---

## Step 7 — Verify karo

```bash
npm run verify:supabase
```

Ye script khud check karta:
- `.env` mila aur keys bhari hain
- Chaaro table exist karti
- Seed data pahuncha
- **Insert kaam karta** (capture path)
- **Full-text search kaam karta** (retrieval path) — probe row daal ke, dhundh ke, delete kar deta
- AI keys present hain ya nahi

Sab ✅ hua to setup done. Koi ❌ aaya to script batayega exactly kya fix karna.

---

## Step 8 — App chalao

Share sheet ko native code chahiye, isliye Expo Go se **nahi** chalega. Dev client build karo:

```bash
npx expo run:android      # USB se phone connected ho, ya emulator
```

ya EAS se (Mac/Android SDK na ho to):

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform android
```

Build install hone ke baad:

```bash
npm start
```

Phir Instagram kholo → koi reel → **Share** → **Lately** dikhna chahiye.

---

## Troubleshoot

| Problem | Fix |
|---|---|
| `Table "reels" not reachable` | Step 2 nahi chala — migration run karo |
| `No categories found` | Step 3 nahi chala — seed run karo |
| `Insert failed` | RLS policy issue — migration dobara chalao |
| `Search returned nothing` | `search_vector` column nahi bana — migration dobara chalao |
| Lately share sheet mein nahi | Dev client build nahi hua (Expo Go se kaam nahi karega) |
| Project sleep ho gaya | Free tier 7 din inactivity pe pause karta — dashboard se resume karo |

---

## ⚠️ Security — bhoolna mat

Abhi RLS policies **jaan-boojh kar loose** hain (`using (true)`) — sirf single-user local dev ke liye. **Kisi bhi real user ko onboard karne se pehle** inko `using (auth.uid() = user_id)` karna zaroori hai, warna har logged-in user sabki saves padh sakta hai. Ye Phase 3 (magic-link auth) ka kaam hai.
