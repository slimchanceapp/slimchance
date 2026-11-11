package com.toxicminds.recompos;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * The home-screen widget: Today's sentence on the chance and, until today's
 * weigh-in, a "Weigh in" button that opens the number pad (QuickWeighActivity)
 * over the home screen. The app writes the sentence whenever it's open
 * (MomentsPlugin.setWidget, from src/lib/stores/moments.ts); the widget only
 * works out whether today is weighed. No weight on it: a home screen is seen
 * by whoever is near the phone.
 */
public class SlimWidget extends AppWidgetProvider {
    static final String ACTION_DAY = "com.toxicminds.recompos.WIDGET_DAY";
    static final String FIRST_LINE = "Each morning on the scale lights a coin.";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
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
        SharedPreferences p = ctx.getSharedPreferences(MomentReceiver.PREFS, Context.MODE_PRIVATE);
        String today = LocalDate.now().toString();
        // Weighed today: the app said so today, or a weight went in from here
        // or from the briefing and waits for the app to save it.
        boolean weighed = (today.equals(p.getString("widget_date", "")) && p.getBoolean("widget_weighed", false))
            || MomentReceiver.weighedFrom(p, today);
        String title = p.getString("widget_title", "");

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        v.setTextViewText(R.id.widget_title, title.isEmpty() ? FIRST_LINE : title);
        v.setTextViewText(R.id.widget_status, weighed ? "Weighed in today" : "Slim Chance");
        v.setViewVisibility(R.id.widget_weigh, weighed ? View.GONE : View.VISIBLE);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) {
            v.setOnClickPendingIntent(android.R.id.background,
                PendingIntent.getActivity(ctx, 10, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        // kg and lb on the number pad, dated the day it's typed (no date
        // extra); stone in the app, since the pad has no space for "17 9".
        Intent weigh = "st".equals(p.getString("widget_unit", "kg")) ? open
            : new Intent(ctx, QuickWeighActivity.class).putExtra("key", "morning")
                .putExtra("unit", p.getString("widget_unit", "kg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (weigh != null) {
            v.setOnClickPendingIntent(R.id.widget_weigh,
                PendingIntent.getActivity(ctx, 11, weigh, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        mgr.updateAppWidget(ids, v);

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
}
