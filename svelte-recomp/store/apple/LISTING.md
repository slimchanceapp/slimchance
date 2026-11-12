# App Store listing package (iPhone)

Ready for the day the Apple Developer account opens (paid early December 2026).
Same shape as `../play/LISTING.md`. The iPhone shell is `ios/` (Capacitor); bundle
id `com.toxicminds.recompos` (old name kept on purpose, like the Android id).
Character counts in brackets were measured when written; recount if a text changes.

## 1. Before submitting: guideline 4.2 (minimum functionality)

Apple rejects "a website in a wrapper", and the shell loads the live site. Reviewers
switch on airplane mode. Native parts today: Apple Health weigh-ins (`Health.swift`)
and the silent morning and evening notifications (`Moments.swift`). Add before the
first submission:

- Opening offline: the app shows its last state, never an error page.
- A home-screen widget with the coins (WidgetKit), like Android's.

Already met: account deletion inside the app (5.1.1(v)); no third-party login, so
Sign in with Apple is not required (4.8); nothing sold, so no in-app purchase rules.

## 2. Day one in App Store Connect (in this order)

1. Agreements: the free-apps agreement only (nothing is sold).
2. Trader status for the EU (DSA): **non-trader** (decided 11 Nov 2026, as on Play).
3. Certificates, Identifiers & Profiles: App ID `com.toxicminds.recompos` with the
   HealthKit capability.
4. My Apps, New App: platform iOS, name **Slim Chance**, primary language English
   (U.K.), bundle id above, SKU `slimchance-ios`. Creating the record reserves the name
   (free on 12 Nov 2026; Apple's search API found no app with it).
5. App Store Connect API key (Users and Access, Integrations, Team Keys, role App
   Manager): save the `.p8` as `~/.config/recompos/appstore.p8` and its ids in
   `~/.config/recompos/appstore.env` (never in the repo), then as repository secrets
   for the TestFlight job.
6. Info.plist: `ITSAppUsesNonExemptEncryption` = `NO` (HTTPS only), so no export
   question on each build.

## 3. Listing text

**Name** (11/30): `Slim Chance`

**Subtitle** (28/30): `Weight loss with honest odds`

**Promotional text** (146/170):

```
Weigh in each morning and see the odds you're really losing, as ten coins. A rough food log is enough: your budget is learned from your own scale.
```

**Keywords** (96/100):

```
weight,loss,lose,calorie,counter,tracker,diet,scale,trend,food,log,protein,fasting,tdee,cut,odds
```

**Description** (2028/4000):

```
Most weight-loss apps make the scale the judge. Slim Chance makes it a witness.

Step on the scale each morning. One morning says little: water, salt and a late meal move it a kilo either way. A week of mornings says a lot. Slim Chance draws the trend through them and tells you the odds that your weight is really going your way, as ten coins: "9 in 10 it's coming off."

WHAT IT DOES
• The odds, not the daily number: your trend, and how sure it is, from your own mornings.
• When the scale goes up, it explains why from your own log: a big day of eating, a hard session, the weekday it always jumps.
• A calorie budget for the week, learned from how you actually log. Rough logging is enough: a consistent log teaches it what your days really cost.
• Today on one screen: the weigh-in, one next step, and today's plan.
• An optional AI coach that plans your next days from foods you already eat, inside your budget, never under a safe floor.
• Two calm notes a day, morning and evening. They never ring.
• Plans for the hard moments: decide now what you'll do on the Friday night that usually undoes the week.
• Keeping it off: once you reach your goal, the app switches to holding it.
• Your weigh-ins from Apple Health, so the trend starts on day one.

HOW IT TALKS TO YOU
Kindly. A kind word when you've earned it by showing up, never for what the scale did. No streaks to lose, no badges, no red numbers.

YOUR DATA
• No ads. No trackers. Nothing sold.
• Start without an account; add an email when you want it on another phone.
• Export everything or delete your account at any time, in the app.
• Stored in the EU. Apple Health is read only with your permission, and never used for advertising.
• Open source (AGPL-3.0): github.com/slimchanceapp/slimchance

FREE
Everything is free. No subscription, no in-app purchases.

Slim Chance is a tracker and a guide, not medical advice. If you have a medical condition, are pregnant or take medication that affects your weight, talk to your doctor before changing how you eat.
```

**Category:** Health & Fitness (primary), Food & Drink (secondary).

**URLs:** support `https://slimchance.app/about/` (add a contact line with
hello@slimchance.app to its "Who makes it?" answer first: Apple wants contact
details there); marketing `https://slimchance.app/about/`; privacy policy
`https://slimchance.app/privacy.html`.

**Price:** free, every country Apple serves.

## 4. App Privacy (the "nutrition label")

Data linked to the person, none used for tracking, none shared for advertising:

| Apple's type | What it is here | Purpose |
| --- | --- | --- |
| Health and Fitness | weigh-ins, food, workouts, sleep, period days (opt-in) | App Functionality |
| Photos or Videos | meal and progress photos the person takes | App Functionality |
| Contact Info: email | only once the account is saved | App Functionality |
| Identifiers: user ID | the account id | App Functionality |
| Usage Data: product interaction | first-party counts (setup steps, features used) | Analytics |
| Diagnostics: crash data | our own error table | App Functionality |

## 5. Age rating and review notes

**Age rating:** answer the questionnaire as it stands (weight loss is a health and
wellness topic; nothing else applies). The app itself asks for 18+ at setup.

**Review notes:**

```
No sign-in needed: tap "I agree", then "Start now"; a trial account starts at once. Apple Health is optional and only reads weigh-ins. The two daily notifications are silent. Everything is free; nothing is sold in the app.
```

**Screenshots:** 6.9-inch iPhone, 1290 x 2796, made like Play's (a throwaway trial
with seeded data, deleted afterwards): Today, the scale-up explanation, Progress,
Food, the coins widget once it exists.
