package com.toxicminds.recompos;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.style.StyleSpan;
import android.util.SizeF;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The home-screen widget: the chance as ten coins, today's food and protein, the
 * sentence when there is room, and one tap to weigh in (the number pad over the home
 * screen), scan a barcode or photograph a meal (the app opens at the food logger).
 * Taller, it adds what turns the chance, today's food as bars and the week's days.
 * Laid out per size, from coins alone at 2x1 to everything at 4x2 on tall cells and
 * 4x3 (Android's widget quality guidelines: rearrange as it grows, never scale up).
 * The app writes what it shows whenever it's open (MomentsPlugin.setWidget, from
 * src/lib/stores/moments.ts), tomorrow's food line too; the widget works out only
 * whether today is weighed and which day's food is today's. No weight on it: a home
 * screen is seen by whoever is near the phone.
 */
public class SlimWidget extends AppWidgetProvider {
    static final String ACTION_DAY = "com.toxicminds.recompos.WIDGET_DAY";
    /** Before the app has written anything: what to do, not an empty card. */
    static final String FIRST_LINE = "Open Slim Chance to see your chance here.";
    /** Under it when there is room: how the coins light (the app's first-week line). */
    static final String FIRST_HINT = "Each morning on the scale lights a coin.";
    /** Where Scan and Photo open the app (widgetRoute in src/lib/moments/nativeAlarms.ts). */
    static final String SCAN = "slimchance://food/scan";
    static final String PHOTO = "slimchance://food/photo";
    private static final int[] COINS = {
        R.drawable.coins_0, R.drawable.coins_1, R.drawable.coins_2, R.drawable.coins_3,
        R.drawable.coins_4, R.drawable.coins_5, R.drawable.coins_6, R.drawable.coins_7,
        R.drawable.coins_8, R.drawable.coins_9, R.drawable.coins_10,
    };
    private static final int[] DAYS = {
        R.id.widget_day0, R.id.widget_day1, R.id.widget_day2, R.id.widget_day3,
        R.id.widget_day4, R.id.widget_day5, R.id.widget_day6,
    };
    private static final int[] LETTERS = {
        R.id.widget_dl0, R.id.widget_dl1, R.id.widget_dl2, R.id.widget_dl3,
        R.id.widget_dl4, R.id.widget_dl5, R.id.widget_dl6,
    };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        refresh(ctx);
    }

    /** Resized: before Android 12 the layout is chosen here, by height. */
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        refresh(ctx);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ACTION_DAY.equals(intent.getAction())) refresh(ctx);
        else super.onReceive(ctx, intent);
    }

    @Override
    public void onDisabled(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am != null) am.cancel(dayTurns(ctx));
    }

    /** Redraw every placed widget from what the app last wrote. */
    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, SlimWidget.class));
        if (ids == null || ids.length == 0) return;
        if (Build.VERSION.SDK_INT >= 31) {
            mgr.updateAppWidget(ids, new RemoteViews(layouts(ctx)));
        } else {
            Look look = new Look(ctx);
            for (int id : ids) {
                int h = mgr.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
                mgr.updateAppWidget(id, h < 140 ? look.small(true, true) : look.full(true, h >= 190, false, h >= 290 ? 2 : h >= 230 ? 1 : 0));
            }
        }

        // Turn the day over after midnight without waking the phone: RTC, not
        // RTC_WAKEUP, arrives the next time it's awake, before anyone looks.
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am != null) {
            long next = LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli() + 60_000;
            am.set(AlarmManager.RTC, next, dayTurns(ctx));
        }
    }

    /** Each size's layout, from what the app last wrote; Android 12+ shows the
     *  largest that fits the widget, per orientation. Each size is the least
     *  its layout needs: WidgetRenderTest draws every layout at exactly its size
     *  and fails one that cuts a part off (two rows from 100 dp did, 7 dp, on
     *  build 24). Below a size, the next smaller layout. */
    static Map<SizeF, RemoteViews> layouts(Context ctx) {
        Look look = new Look(ctx);
        Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
        sizes.put(new SizeF(110f, 50f), look.small(false, false));
        sizes.put(new SizeF(200f, 50f), look.small(false, true));
        sizes.put(new SizeF(300f, 50f), look.small(true, true));
        sizes.put(new SizeF(110f, 160f), look.full(false, false, true, 0)); // its food line takes two lines
        sizes.put(new SizeF(220f, 140f), look.full(false, false, false, 0));
        sizes.put(new SizeF(300f, 140f), look.full(true, false, false, 0));
        sizes.put(new SizeF(220f, 190f), look.full(false, true, false, 0));
        sizes.put(new SizeF(300f, 190f), look.full(true, true, false, 0));
        // Taller (4x2 on tall cells, as on the owner's Pixel 7, and 4x3): what
        // turns the chance and the food as bars, then the week's days too, so
        // the height carries something instead of a band of nothing.
        sizes.put(new SizeF(220f, 230f), look.full(false, true, false, 1));
        sizes.put(new SizeF(300f, 230f), look.full(true, true, false, 1));
        sizes.put(new SizeF(220f, 290f), look.full(false, true, false, 2));
        sizes.put(new SizeF(300f, 290f), look.full(true, true, false, 2));
        return sizes;
    }

    private static PendingIntent dayTurns(Context ctx) {
        Intent i = new Intent(ctx, SlimWidget.class).setAction(ACTION_DAY);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** What the widget shows now, and where its taps go. */
    private static final class Look {
        final Context ctx;
        final boolean has, weighed;
        final String title, hint, food, protein;
        final int lit, kcal, share, proteinG, proteinTarget;
        /** The week, Monday first: each day's food as a percentage of the day's
         *  target, -1 for a day with nothing logged or still to come. */
        final int[] week;
        final PendingIntent open, weigh, scan, photo;

        Look(Context ctx) {
            this.ctx = ctx;
            SharedPreferences p = ctx.getSharedPreferences(MomentReceiver.PREFS, Context.MODE_PRIVATE);
            JSONObject w;
            try {
                w = new JSONObject(p.getString("widget_json", "{}"));
            } catch (Exception e) {
                w = new JSONObject();
            }
            String today = LocalDate.now().toString();
            has = w.has("date") && !w.optString("date").isEmpty();
            boolean fresh = today.equals(w.optString("date"));
            // Weighed today: the app said so today, or a weight went in from here
            // or from the briefing and waits for the app to save it.
            weighed = (fresh && w.optBoolean("weighed")) || MomentReceiver.weighedFrom(p, today);
            String t = w.optString("title", "");
            title = t.isEmpty() ? FIRST_LINE : t;
            hint = has ? w.optString("hint", "") : FIRST_HINT;
            lit = w.isNull("lit") ? 0 : Math.max(0, Math.min(10, w.optInt("lit", 0)));
            // Food is the day's. After midnight, until the app writes again, the
            // day the app wrote as tomorrow (nothing eaten, the week's share for
            // it); without one, a new day with nothing known. Nothing written
            // yet: the sentence says what to do, once.
            JSONObject next = w.optJSONObject("next");
            JSONObject day = fresh ? w : next != null && today.equals(next.optString("date")) ? next : null;
            food = !has ? "" : day != null ? day.optString("food", "") : "New day: nothing logged yet";
            protein = has && day != null ? day.optString("protein", "") : "";
            kcal = day != null ? Math.max(0, day.optInt("kcal", 0)) : 0;
            share = day != null ? Math.max(0, day.optInt("share", 0)) : 0;
            proteinG = day != null ? Math.max(0, day.optInt("proteinG", 0)) : 0;
            proteinTarget = day != null ? Math.max(0, day.optInt("proteinTarget", 0)) : 0;
            JSONArray days = day != null ? day.optJSONArray("week") : null;
            if (days != null && days.length() == 7) {
                week = new int[7];
                for (int i = 0; i < 7; i++) week[i] = days.optInt(i, -1);
            } else week = has ? null : new int[] { -1, -1, -1, -1, -1, -1, -1 }; // nothing known yet: an empty week

            String unit = p.getString("widget_unit", "kg");
            Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            open = launch == null ? null : activity(10, launch);
            // kg and lb on the number pad, dated the day it's typed (no date
            // extra); stone in the app, since the pad has no space for "17 9".
            weigh = "st".equals(unit) ? open
                : activity(11, new Intent(ctx, QuickWeighActivity.class).putExtra("key", "morning")
                    .putExtra("unit", unit).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            scan = activity(12, link(SCAN));
            photo = activity(13, link(PHOTO));
        }

        /** One row: the coins, the day's food when there is room, and the one
         *  action that matters now (Weigh in until today's weigh-in, then Scan). */
        RemoteViews small(boolean showFood, boolean showAct) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_small);
            coins(v);
            v.setTextViewText(R.id.widget_food, food);
            v.setViewVisibility(R.id.widget_food, showFood && !food.isEmpty() ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_act, showAct ? View.VISIBLE : View.GONE);
            v.setTextViewText(R.id.widget_act_label, weighed ? "Scan" : "Weigh in");
            click(v, R.id.widget_act, weighed ? scan : weigh);
            click(v, android.R.id.background, open);
            return v;
        }

        /** Two rows and up. Narrow: one thing at a time (Weigh in until it's
         *  done, then Scan and Photo); labels when wide; the sentence when tall.
         *  more = 1 adds what turns the chance and today's food as bars, 2 the
         *  week's days as well. */
        RemoteViews full(boolean labels, boolean sentence, boolean narrow, int more) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
            coins(v);
            // Before the app has written, short: the line saying what to do and
            // the buttons, not ten unlit coins.
            v.setViewVisibility(R.id.widget_coins, has || sentence ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_done, weighed ? View.VISIBLE : View.GONE);
            boolean bars = more >= 1 && share > 0;
            // Narrow: protein on its own line rather than broken mid-phrase;
            // wider, one line, so the line never pushes the buttons off.
            v.setTextViewText(R.id.widget_food, protein.isEmpty() ? food : food + (narrow ? "\n" : " · ") + protein);
            v.setInt(R.id.widget_food, "setMaxLines", narrow ? 2 : 1);
            v.setViewVisibility(R.id.widget_food, food.isEmpty() || bars ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.widget_title, title);
            v.setViewVisibility(R.id.widget_title, sentence || !has ? View.VISIBLE : View.GONE);
            if (more >= 1) v.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, 17);
            v.setTextViewText(R.id.widget_hint, hint);
            v.setViewVisibility(R.id.widget_hint, more >= 1 && !hint.isEmpty() ? View.VISIBLE : View.GONE);
            show(v, bars, R.id.widget_gap_bars, R.id.widget_bars);
            if (bars) {
                v.setTextViewText(R.id.widget_kcal_text, food);
                v.setProgressBar(R.id.widget_kcal_bar, share, Math.min(kcal, share), false);
                v.setViewVisibility(R.id.widget_protein_col, proteinTarget > 0 ? View.VISIBLE : View.INVISIBLE);
                v.setTextViewText(R.id.widget_protein_text, protein);
                v.setProgressBar(R.id.widget_protein_bar, Math.max(1, proteinTarget), Math.min(proteinG, proteinTarget), false);
            }
            boolean days = more >= 2 && week != null;
            show(v, days, R.id.widget_gap_week, R.id.widget_week);
            if (days) week(v);
            v.setViewVisibility(R.id.widget_weigh, weighed ? View.GONE : View.VISIBLE);
            boolean tools = !narrow || weighed;
            v.setViewVisibility(R.id.widget_scan, tools ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_photo, tools ? View.VISIBLE : View.GONE);
            // Once weighed, Weigh in's room goes to Scan's and Photo's words.
            boolean words = labels || (weighed && !narrow);
            v.setViewVisibility(R.id.widget_scan_label, words ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_photo_label, words ? View.VISIBLE : View.GONE);
            click(v, R.id.widget_weigh, weigh);
            click(v, R.id.widget_scan, scan);
            click(v, R.id.widget_photo, photo);
            click(v, android.R.id.background, open);
            return v;
        }

        /** The week, Monday first: up to the day's target in the accent, past it
         *  in amber, to half again the target at the top; today's letter bold. */
        private void week(RemoteViews v) {
            int today = LocalDate.now().getDayOfWeek().getValue() - 1;
            for (int i = 0; i < 7; i++) {
                int pct = week[i];
                v.setProgressBar(DAYS[i], 150, pct < 0 ? 0 : Math.min(pct, 100), false);
                v.setInt(DAYS[i], "setSecondaryProgress", pct < 0 ? 0 : Math.min(pct, 150));
                SpannableString l = new SpannableString("MTWTFSS".substring(i, i + 1));
                if (i == today) {
                    l.setSpan(new StyleSpan(Typeface.BOLD), 0, 1, 0);
                    if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(LETTERS[i], "setTextColor", R.color.widget_text);
                }
                v.setTextViewText(LETTERS[i], l);
            }
        }

        private static void show(RemoteViews v, boolean on, int... ids) {
            for (int id : ids) v.setViewVisibility(id, on ? View.VISIBLE : View.GONE);
        }

        private void coins(RemoteViews v) {
            v.setImageViewResource(R.id.widget_coins, COINS[lit]);
            v.setContentDescription(R.id.widget_coins, has ? lit + " of 10 coins lit: your chance" : "Your chance, once you've weighed in");
        }

        private void click(RemoteViews v, int id, PendingIntent pi) {
            if (pi != null) v.setOnClickPendingIntent(id, pi);
        }

        private PendingIntent activity(int code, Intent i) {
            return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }

        /** The app, opened at a widget link (read by the app's appUrlOpen). */
        private Intent link(String uri) {
            return new Intent(Intent.ACTION_VIEW, Uri.parse(uri), ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
    }
}
