package com.toxicminds.recompos;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The home-screen widget: the chance as ten coins, today's food and protein, the
 * sentence when there is room, and one tap to weigh in (the number pad over the home
 * screen), scan a barcode or photograph a meal (the app opens at the food logger).
 * Laid out per size, from coins alone at 2x1 to everything at 4x2 (Android's widget
 * quality guidelines: rearrange as it grows, never scale up). The app writes what it
 * shows whenever it's open (MomentsPlugin.setWidget, from src/lib/stores/moments.ts);
 * the widget works out only whether today is weighed and whether its food line is
 * still today's. No weight on it: a home screen is seen by whoever is near the phone.
 */
public class SlimWidget extends AppWidgetProvider {
    static final String ACTION_DAY = "com.toxicminds.recompos.WIDGET_DAY";
    /** Before the app has written anything: what to do, not an empty card. */
    static final String FIRST_LINE = "Open Slim Chance to see your chance here.";
    /** Where Scan and Photo open the app (widgetRoute in src/lib/moments/nativeAlarms.ts). */
    static final String SCAN = "slimchance://food/scan";
    static final String PHOTO = "slimchance://food/photo";
    private static final int[] COINS = {
        R.drawable.coins_0, R.drawable.coins_1, R.drawable.coins_2, R.drawable.coins_3,
        R.drawable.coins_4, R.drawable.coins_5, R.drawable.coins_6, R.drawable.coins_7,
        R.drawable.coins_8, R.drawable.coins_9, R.drawable.coins_10,
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
        Look look = new Look(ctx);
        if (Build.VERSION.SDK_INT >= 31) {
            // Android picks the largest of these that fits the widget, per orientation.
            Map<SizeF, RemoteViews> sizes = new LinkedHashMap<>();
            sizes.put(new SizeF(110f, 40f), look.small(false, false));
            sizes.put(new SizeF(200f, 40f), look.small(false, true));
            sizes.put(new SizeF(300f, 40f), look.small(true, true));
            sizes.put(new SizeF(110f, 100f), look.full(false, false, true));
            sizes.put(new SizeF(220f, 100f), look.full(false, false, false));
            sizes.put(new SizeF(300f, 100f), look.full(true, false, false));
            sizes.put(new SizeF(220f, 170f), look.full(false, true, false));
            sizes.put(new SizeF(300f, 170f), look.full(true, true, false));
            mgr.updateAppWidget(ids, new RemoteViews(sizes));
        } else {
            for (int id : ids) {
                int h = mgr.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
                mgr.updateAppWidget(id, h < 100 ? look.small(true, true) : look.full(true, h >= 170, false));
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

    private static PendingIntent dayTurns(Context ctx) {
        Intent i = new Intent(ctx, SlimWidget.class).setAction(ACTION_DAY);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** What the widget shows now, and where its taps go. */
    private static final class Look {
        final Context ctx;
        final boolean has, weighed;
        final String title, food, protein;
        final int lit;
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
            lit = w.isNull("lit") ? 0 : Math.max(0, Math.min(10, w.optInt("lit", 0)));
            // Food is the day's: after midnight, until the app writes again, a new day.
            food = !has ? "Open the app once to fill this in." : fresh ? w.optString("food", "") : "New day: nothing logged yet";
            protein = has && fresh ? w.optString("protein", "") : "";

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
         *  done, then Scan and Photo); labels when wide; the sentence when tall. */
        RemoteViews full(boolean labels, boolean sentence, boolean narrow) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
            coins(v);
            v.setViewVisibility(R.id.widget_done, weighed ? View.VISIBLE : View.GONE);
            v.setTextViewText(R.id.widget_food, protein.isEmpty() ? food : food + " · " + protein);
            v.setViewVisibility(R.id.widget_food, food.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.widget_title, title);
            v.setViewVisibility(R.id.widget_title, sentence || !has ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_weigh, weighed ? View.GONE : View.VISIBLE);
            boolean tools = !narrow || weighed;
            v.setViewVisibility(R.id.widget_scan, tools ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_photo, tools ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_scan_label, labels ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.widget_photo_label, labels ? View.VISIBLE : View.GONE);
            click(v, R.id.widget_weigh, weigh);
            click(v, R.id.widget_scan, scan);
            click(v, R.id.widget_photo, photo);
            click(v, android.R.id.background, open);
            return v;
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
