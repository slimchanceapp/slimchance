# Google Play listing package

Everything the Play Console asks for, in the order it asks, for Slim Chance
(`app.slimchance`). Answers are taken from the code and the privacy page
(2026-10-31); change them here first when the app changes, then in the Console.

Images in this folder: `feature-graphic.jpg` (1024x500), five phone
screenshots (1080x1920), and the icon at `../play-icon-512.png`. All are
opaque JPEG/PNG, as Play requires.

## 1. Main store listing (Grow users → Store presence → Main store listing)

**App name** (24/30)

```
Slim Chance: Weight Loss
```

**Short description** (79/80)

```
The odds you're really losing weight, from your own scale and a rough food log.
```

**Full description** (2616/4000)

```
Most weight-loss apps make the scale the judge. Slim Chance makes it a witness.

Step on the scale each morning. One morning says little: water, salt and a late meal move it a kilo either way. A week of mornings says a lot. Slim Chance draws the trend through them and tells you the odds that your weight is really going your way, as ten coins: "9 in 10 it's coming off."

WHAT IT DOES
• The odds, not the daily number: your trend, and how sure it is, from your own mornings.
• When the scale goes up, it explains why from your own log: a big day of eating, a hard session, the weekday it always jumps.
• A calorie budget for the week, learned from how you actually log. Rough logging is enough: a consistent log teaches it what your days really cost. One big meal costs something from the rest of the week; it doesn't break the week.
• Today on one screen: the weigh-in, one next step, and today's plan.
• An optional AI coach, free while in preview, that plans your next days inside your budget: never under a safe floor, and never a hard day to "pay back" an earlier one.
• Training that counts what your watch saw: gym sessions, walks and sport from Health Connect count as training days, even when you didn't type a set.
• Getting fitter: resting heart rate, steps and training, beside the weight.
• Two calm notes a day: a morning one when you first unlock your phone, and an evening one. They never ring or wake you.
• Plans for the hard moments: decide now what you'll do on the Friday night that usually undoes the week.
• Keeping it off: once you reach your goal, the app switches to holding it, with a ceiling a kilo above.
• Bring your weight history from another app, and the trend starts on day one.

HOW IT TALKS TO YOU
Kindly. A kind word when you've earned it by showing up, never for what the scale did. No streaks to lose, no badges, no red numbers.

YOUR DATA
• No ads. No trackers. Nothing sold.
• Start without an account; add an email when you want it on another phone.
• Export everything (JSON or a spreadsheet) or delete your account at any time, in the app.
• Stored in the EU. Health Connect data is read only with your permission.
• Open source (AGPL-3.0): github.com/slimchanceapp/slimchance

FREE TO USE
The core is free to use: the odds, the trend, the budget, food, training, the notes, import and export. Optional Plus extras are on their way; safety features stay free for everyone.

Slim Chance is a tracker and a guide, not medical advice. If you have a medical condition, are pregnant or take medication that affects your weight, talk to your doctor before changing how you eat.
```

**Graphics:** app icon `../play-icon-512.png`; feature graphic
`feature-graphic.jpg`; phone screenshots, in this order:
`screenshot-1-today.jpg`, `screenshot-2-scale-up.jpg`,
`screenshot-3-first-odds.jpg`, `screenshot-4-progress.jpg`,
`screenshot-5-food.jpg`. No tablet screenshots needed for a phone app.

## 2. Store settings

- **App category:** Health & Fitness
- **Tags:** the closest to weight loss, calorie counter, fitness tracker (up to five)
- **Email:** `hello@slimchance.app`
- **Website:** `https://slimchance.app/about/`
- **Phone:** leave empty

## 3. App content (Policy → App content)

- **Privacy policy:** `https://slimchance.app/privacy.html`
- **App access:** All functionality is available without any access restrictions (a trial needs no login).
- **Ads:** No, my app does not contain ads.
- **Content rating:** category for utility / productivity / other apps. Answer **No** to every
  question: violence, fear, sexual content, language, drugs, alcohol or tobacco, gambling
  (the odds are a probability, not betting), users interacting or sharing content, sharing
  location with other users, buying digital goods. Expect PEGI 3 / Everyone.
- **Target audience:** 18 and over only.
- **News app:** No. **Government app:** No. **Financial features:** none.
- **Health apps:** yes, health features: activity and fitness tracking; nutrition and
  weight management; medication and treatment management (a medication log and dose
  reminders, never dosing advice). It is not a medical device.

### Data safety

**Overview**
- Collects or shares required user data types: **Yes**
- All user data encrypted in transit: **Yes**
- Account creation: **username and password** (email and password); people can also start
  without an account (a trial on the device).
- Delete account URL: `https://slimchance.app/privacy.html#delete`
- Users can ask to delete some of their data without deleting the account: **Yes** (any
  entry can be deleted in the app)

**Data types.** Shared with third parties: **none** for every type. The AI and weather
services (Google's Gemini, Kilo's gateway, Pollinations, Open-Meteo) only process a request
on Slim Chance's behalf, which is not sharing in Play's terms; the privacy page names each.

| Category | Data type | What it is in Slim Chance | Required? | Ephemeral? | Purposes |
|---|---|---|---|---|---|
| Personal info | Email address | to keep the account on another phone | Optional | No | Account management |
| Personal info | User IDs | the account's internal id | Required | No | Account management, App functionality |
| Personal info | Other info | sex, year of birth, height (for the calorie budget) | Required | No | App functionality |
| Health and fitness | Fitness info | weight, food and nutrition, workouts, steps, heart rate, sleep, distance, calories burned | Required | No | App functionality |
| Health and fitness | Health info | medications, doses, side effects, blood tests, period start, back-pain rating, body fat | Optional | No | App functionality |
| Photos and videos | Photos | progress photos (kept); food and body-fat photos (sent for an estimate, not kept) | Optional | No | App functionality |
| Location | Approximate location | rounded to about a kilometre, for the morning weather; not stored | Optional | **Yes** | App functionality |
| App activity | App interactions | the days the app was opened, setup steps reached, one-tap answers, the link tag | Required | No | Analytics |
| App activity | Other user-generated content | notes to the coach, words in the weekly check-in, written plans | Optional | No | App functionality |
| App info and performance | Crash logs, Diagnostics | a short error report when something breaks | Required | No | Analytics |

Not collected: name, address, phone, contacts, messages, calendar, audio, files, web
browsing, financial info, device or advertising IDs (no push service, no ad SDK).

### Health Connect (App content → Health Connect)

Background reading: **No**. Each permission and what it is for:

| Permission | Why Slim Chance needs it |
|---|---|
| Read weight | Weigh-ins from a smart scale's app become the morning weigh-ins the trend is drawn from. |
| Write weight | Weigh-ins typed in Slim Chance are saved to Health Connect, so other apps the person uses see them. |
| Read steps | Daily steps show on Today and in the weekly review, and are one of the "Getting fitter" signs. |
| Read exercise | Workouts a watch records (a gym session recorded as "Overall fitness") count as training days, so people who train with only a watch get credit. |
| Write exercise | Workouts logged by hand in Slim Chance are saved to Health Connect, so the history agrees across apps. |
| Read heart rate | The average heart rate of a workout shows with that session on Train, as its effort. |
| Read resting heart rate | The resting heart rate trend is one of the "Getting fitter" signs. |
| Read heart rate variability | Heart rate variability against the person's own baseline is part of the morning recovery read. |
| Read sleep | Last night's sleep is part of the morning recovery read and the morning note. |
| Read active calories burned, Read total calories burned | The calories a watch records for a workout show with that session on Train (active, or total where a watch reports only that). |
| Read distance | The distance of walks and runs a watch records shows with each session. |

## 4. Closed test (Test and release → Testing → Closed testing)

1. Create the track (or use "Alpha"). **Countries:** all available.
2. **Testers:** an email list for now (your own addresses); add the public Google Group
   when it exists. **Feedback:** `hello@slimchance.app`.
3. **Create release:** when asked about app signing, choose **Use a Google-generated key**
   (Play App Signing). The bundle is signed with our upload key, which stays on the laptop
   and in GitHub's secrets.
4. Upload `slimchance-play.aab` (build 18, version 2.5). Release name: `18 (2.5)`.
   Release notes:
   ```
   The first test build. Thank you for trying it: hello@slimchance.app reaches the person who builds it.
   ```
5. Review the release, then **Start rollout to Closed testing**. Google reviews it; with a
   new account that can take a few days, alongside the identity check.
6. The 14 days start when 12 testers have opted in through the test link.
