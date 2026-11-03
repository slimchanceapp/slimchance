package com.toxicminds.recompos;

import android.Manifest;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;

import android.os.Bundle;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Posts the morning briefing and the evening hold, each the first time the
 * phone is unlocked inside its window (MomentClock decides when). The text is
 * written by the web app whenever it's open and handed over through
 * MomentsPlugin; nothing here computes anything about the user's day.
 *
 * Every look is booked on a non-waking alarm (RTC, never RTC_WAKEUP): it costs
 * nothing while the phone sleeps, and Android delivers a held one the moment
 * the screen turns on, which is exactly the moment this is waiting for.
 */
public class MomentReceiver extends BroadcastReceiver {
    static final String PREFS = "recompos.moments";
    static final String ACTION_CHECK = "com.toxicminds.recompos.MOMENT_CHECK";
    /** The morning briefing's buttons: weigh in, rate the back, log the usual
     *  breakfast, all without opening the app (and from the watch). */
    static final String ACT_WEIGHT = "com.toxicminds.recompos.MOMENT_WEIGHT";
    static final String ACT_BACK = "com.toxicminds.recompos.MOMENT_BACK";
    static final String ACT_MEAL = "com.toxicminds.recompos.MOMENT_MEAL";
    static final String INPUT = "value";
    /** The queue is appended here (main thread) and trimmed by the plugin (its
     *  own thread): one lock, or a press during a trim could vanish. */
    static final Object QUEUE = new Object();

    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (ACT_WEIGHT.equals(a) || ACT_BACK.equals(a) || ACT_MEAL.equals(a)) {
            act(context, intent);
            return;
        }
        // Our own alarm, a reboot (alarms don't survive one) or an app update.
        check(context);
    }

    /** Decide, act, and book the next look. */
    static void check(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        carryOverBuild6(ctx, p);
        if (!p.getBoolean("on", false)) {
            cancel(ctx);
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        String today = now.toLocalDate().toString();
        int nowMin = now.getHour() * 60 + now.getMinute();
        List<MomentClock.Moment> moments = read(p);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
        boolean interactive = pm != null && pm.isInteractive();
        boolean locked = km != null && km.isKeyguardLocked();

        MomentClock.Next n = MomentClock.decide(today, nowMin, moments, interactive, locked);
        if (n.action == MomentClock.POST) {
            post(ctx, n.moment);
            p.edit().putString("shown:" + n.moment.key, n.moment.date)
                .putLong("postedAt:" + n.moment.key, System.currentTimeMillis()).commit();
            n.moment.shown = true;
            n = MomentClock.decide(today, nowMin, moments, interactive, locked);
        }

        long nowMs = System.currentTimeMillis();
        switch (n.action) {
            case MomentClock.POST: // a second one due at once: the next look posts it
            case MomentClock.SOON:
                schedule(ctx, nowMs + 5_000);
                break;
            case MomentClock.LATER:
                // Held while the screen is off; the minute only matters if the
                // screen comes on and off again within it.
                schedule(ctx, nowMs + 60_000);
                break;
            case MomentClock.AT:
                schedule(ctx, LocalDate.parse(n.moment.date).atTime(n.moment.after / 60, n.moment.after % 60)
                    .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli());
                break;
            default:
                cancel(ctx);
        }
    }

    /**
     * A button on the briefing: keep what was entered for the app to save (it
     * owns the one weigh-in path, the typo guard and the food log), tell the app
     * at once if it's running, and show it was taken.
     */
    private static void act(Context ctx, Intent intent) {
        Bundle in = RemoteInput.getResultsFromIntent(intent);
        CharSequence typed = in != null ? in.getCharSequence(INPUT) : null;
        act(ctx, intent.getAction(), intent.getStringExtra("date"), intent.getStringExtra("key"), typed);
    }

    /** One answer from the notification, typed in its reply or on the number
     *  pad (QuickWeighActivity): checked, queued for the app, and the
     *  notification shown again with what was done. */
    static void act(Context ctx, String a, String date, String key, CharSequence typed) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (a == null || date == null || key == null) return;
        JSONObject moment = momentJson(p, date, key);
        String noteKey = "note:" + date + ":" + key, actedKey = "acted:" + date + ":" + key;
        JSONObject acted = json(p.getString(actedKey, "{}"));
        try {
            JSONObject item = new JSONObject().put("id", System.currentTimeMillis() + "-" + a.hashCode())
                .put("date", date).put("at", java.time.Instant.now().toString());
            String farKey = "far:" + date + ":" + key;
            if (ACT_WEIGHT.equals(a)) {
                // In the person's own unit: the briefing says which (kg, lb or
                // st, typed as stones and pounds); its weighRange is in kg, or
                // in pounds for lb and st. The app converts what it's sent.
                JSONObject acts = moment.optJSONObject("actions");
                String unit = acts != null ? acts.optString("unit", "kg") : "kg";
                String word = "kg".equals(unit) ? "kg" : "lb";
                Double kg = MomentClock.parseWeight(typed, unit);
                if (kg == null) {
                    String like = "st".equals(unit) ? "17 9 (stones, pounds)" : "lb".equals(unit) ? "247.8" : "112.4";
                    p.edit().putString(noteKey, "“" + typed + "” isn’t a weight. Type it like " + like + ".").commit();
                    repost(ctx, p, date, key);
                    return;
                }
                // The app asks before saving a weight far from the trend; ask
                // here the same way, so "Logged" is never said of one it may refuse.
                JSONArray r = acts != null ? acts.optJSONArray("weighRange") : null;
                double[] range = r != null && r.length() == 2 ? new double[] { r.optDouble(0), r.optDouble(1) } : null;
                Double lastFar = p.contains(farKey) ? (double) p.getFloat(farKey, 0f) : null;
                int v = MomentClock.weighVerdict(kg, range, lastFar);
                if (v == MomentClock.KG_FAR) {
                    p.edit().putFloat(farKey, kg.floatValue())
                        .putString(noteKey, kg + " " + word + " is far from your trend. If it’s right, send it again.").commit();
                    repost(ctx, p, date, key);
                    return;
                }
                // "kg" carries the number as typed, in the person's unit (the
                // key predates units; momentActions.nativeKg converts it).
                item.put("type", "weight").put("kg", kg);
                if (v == MomentClock.KG_CONFIRMED) item.put("confirmed", true);
                acted.put("weight", kg + " " + word);
            } else if (ACT_BACK.equals(a)) {
                Integer n = MomentClock.parseRating(typed);
                if (n == null) {
                    p.edit().putString(noteKey, "“" + typed + "” isn’t 0 to 10. Try again.").commit();
                    repost(ctx, p, date, key);
                    return;
                }
                item.put("type", "back").put("value", n);
                acted.put("back", "back " + n + "/10");
            } else {
                JSONObject meal = moment.optJSONObject("actions") != null ? moment.optJSONObject("actions").optJSONObject("meal") : null;
                if (meal == null) return;
                item.put("type", "meal").put("items", meal.optJSONArray("items"));
                acted.put("meal", meal.optString("label", "breakfast").toLowerCase());
            }
            synchronized (QUEUE) {
                JSONArray queue = new JSONArray(p.getString("pending", "[]"));
                queue.put(item);
                p.edit().putString("pending", queue.toString()).putString(actedKey, acted.toString()).remove(noteKey).remove(farKey).commit();
            }
            MomentsPlugin.emit(item);
        } catch (Exception e) {
            p.edit().putString(noteKey, "That didn’t save. Open the app to log it.").commit();
        }
        repost(ctx, p, date, key);
    }

    /** "Show it now" on the app's card: post that armed moment at once, whatever
     *  its window, so where its buttons sit is seen before the morning. Leaves
     *  `shown` alone. The titles of its buttons; null when nothing was posted. */
    static List<String> show(Context ctx, String date, String key) {
        for (MomentClock.Moment m : read(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE))) {
            if (m.date.equals(date) && m.key.equals(key)) return post(ctx, m);
        }
        return null;
    }

    /** Show the notification again with what's been done (and without its button). */
    private static void repost(Context ctx, SharedPreferences p, String date, String key) {
        for (MomentClock.Moment m : read(p)) {
            if (m.date.equals(date) && m.key.equals(key)) {
                post(ctx, m);
                return;
            }
        }
    }

    private static NotificationCompat.Action inputAction(Context ctx, String action, MomentClock.Moment m,
                                                         String title, String label, String[] choices) {
        RemoteInput.Builder in = new RemoteInput.Builder(INPUT).setLabel(label);
        if (choices != null) in.setChoices(choices);
        Intent i = new Intent(ctx, MomentReceiver.class).setAction(action).putExtra("date", m.date).putExtra("key", m.key);
        // Mutable, so Android can add what was typed (explicit, so that's
        // allowed); the flag only exists from Android 12.
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, ACT_WEIGHT.equals(action) ? 1 : 2, i,
            mutable | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Action.Builder(0, title, pi)
            .addRemoteInput(in.build())
            .setAllowGeneratedReplies(false)
            .build();
    }

    /** "Log weight" that opens the number pad (QuickWeighActivity) instead of
     *  the typed reply, whose keyboard Android won't let an app choose. */
    private static NotificationCompat.Action padAction(Context ctx, MomentClock.Moment m, String unit) {
        Intent i = new Intent(ctx, QuickWeighActivity.class).putExtra("date", m.date).putExtra("key", m.key).putExtra("unit", unit)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(ctx, 3, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Action.Builder(0, "Log weight", pi).build();
    }

    private static JSONObject momentJson(SharedPreferences p, String date, String key) {
        try {
            JSONArray all = new JSONArray(p.getString("moments", "[]"));
            for (int i = 0; i < all.length(); i++) {
                JSONObject m = all.getJSONObject(i);
                if (date.equals(m.optString("date")) && key.equals(m.optString("key"))) return m;
            }
        } catch (Exception ignored) {
            // Unreadable: no actions.
        }
        return new JSONObject();
    }

    private static JSONObject json(String s) {
        try {
            return new JSONObject(s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pending(ctx));
    }

    private static List<MomentClock.Moment> read(SharedPreferences p) {
        List<MomentClock.Moment> out = new ArrayList<>();
        JSONArray all;
        try {
            all = new JSONArray(p.getString("moments", "[]"));
        } catch (Exception e) {
            return out;
        }
        for (int i = 0; i < all.length(); i++) {
            try {
                JSONObject m = all.getJSONObject(i);
                // Parsed, so a malformed date is skipped here rather than
                // thrown later while booking the alarm.
                String date = LocalDate.parse(m.getString("date")).toString(), key = m.getString("key");
                out.add(new MomentClock.Moment(date, key, m.getInt("after"), m.getInt("until"),
                    m.optString("title", "Slim Chance"), m.optString("body", ""),
                    date.equals(p.getString("shown:" + key, ""))));
            } catch (Exception ignored) {
                // A moment that can't be read is no moment.
            }
        }
        return out;
    }

    /** Build 6 knew only the morning, under its own name. Keep the day it last
     *  posted, so an update never repeats this morning's briefing. */
    private static void carryOverBuild6(Context ctx, SharedPreferences p) {
        SharedPreferences old = ctx.getSharedPreferences("recompos.morning", Context.MODE_PRIVATE);
        if (!old.contains("shown")) return;
        if (!p.contains("shown:morning")) p.edit().putString("shown:morning", old.getString("shown", "")).commit();
        old.edit().clear().commit();
    }

    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, MomentReceiver.class).setAction(ACTION_CHECK);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void schedule(Context ctx, long atMs) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        // Exact, so a held look isn't batched behind someone else's alarm and
        // still due when the screen comes on. USE_EXACT_ALARM (manifest) grants
        // it on 13+; on 12 it's the user's call, and inexact still works.
        if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
            am.setExact(AlarmManager.RTC, atMs, pending(ctx));
        } else {
            am.set(AlarmManager.RTC, atMs, pending(ctx));
        }
    }

    /** The titles of the buttons it carries; null when notifications are off. */
    private static List<String> post(Context ctx, MomentClock.Moment m) {
        if (Build.VERSION.SDK_INT >= 33
            && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return null;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return null;

        // One channel per moment, so either can be tuned or muted on its own in
        // Android's settings. Both pop up (the phone is in hand) and make no
        // sound; the watch buzzes on its own.
        boolean evening = "evening".equals(m.key);
        String channel = "recompos-" + m.key;
        NotificationChannel ch = new NotificationChannel(channel,
            evening ? "Evening hold" : "Morning briefing", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(evening
            ? "Your plan for the evening, the first time you unlock the phone after it starts"
            : "Weather and the day's plan, the first time you unlock the phone in the morning");
        ch.setSound(null, null);
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);

        // What was already done from this notification, and what was said back:
        // first, so the one line a collapsed notification shows is the answer
        // to what was just typed (at the bottom, a refused "66666" looked taken).
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject acted = json(p.getString("acted:" + m.date + ":" + m.key, "{}"));
        String note = p.getString("note:" + m.date + ":" + m.key, "");
        StringBuilder done = new StringBuilder();
        for (String k : new String[] { "weight", "back", "meal" }) {
            if (acted.has(k)) done.append(done.length() > 0 ? " · " : "").append(acted.optString(k));
        }
        StringBuilder text = new StringBuilder();
        if (!note.isEmpty()) text.append(note).append("\n");
        if (done.length() > 0) text.append("Logged: ").append(done).append("\n");
        String body = text.append(m.body).toString();

        int nl = body.indexOf('\n');
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_moderly)
            .setColor(0xFFC9A54E) // brass: the mark and the buttons, like every notification the app posts
            .setContentTitle(m.title)
            .setContentText(nl > 0 ? body.substring(0, nl) : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            // Pops up once; a button pressed later updates it in silence.
            .setOnlyAlertOnce(true)
            .setAutoCancel(true);
        if (open != null) {
            n.setContentIntent(PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        List<String> buttons = new ArrayList<>();
        JSONObject actions = momentJson(p, m.date, m.key).optJSONObject("actions");
        if (actions != null) {
            if (actions.optBoolean("weigh") && !acted.has("weight")) {
                String u = actions.optString("unit", "kg");
                // kg and lb on the number pad; stone keeps the typed reply,
                // since the pad has no space for "17 9".
                if ("st".equals(u)) n.addAction(inputAction(ctx, ACT_WEIGHT, m, "Log weight", "Weight in st and lb, like 17 9", null));
                else n.addAction(padAction(ctx, m, u));
                buttons.add("Log weight");
            }
            if (actions.optBoolean("back") && !acted.has("back")) {
                n.addAction(inputAction(ctx, ACT_BACK, m, "Rate back",
                    "Back today, 0 to 10", new String[] { "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10" }));
                buttons.add("Rate back");
            }
            JSONObject meal = actions.optJSONObject("meal");
            if (meal != null && !acted.has("meal")) {
                String title = "Log " + meal.optString("label", "breakfast").toLowerCase();
                Intent i = new Intent(ctx, MomentReceiver.class).setAction(ACT_MEAL)
                    .putExtra("date", m.date).putExtra("key", m.key);
                n.addAction(new NotificationCompat.Action.Builder(0, title,
                    PendingIntent.getBroadcast(ctx, 3, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build());
                buttons.add(title);
            }
        }
        try {
            NotificationManagerCompat.from(ctx).notify(evening ? 7002 : 7001, n.build());
        } catch (SecurityException e) {
            return null; // Notifications switched off since the check above.
        }
        return buttons;
    }
}
