package com.toxicminds.recompos;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.HashSet;
import java.util.Set;

/**
 * The web app's side of the morning briefing and the evening hold. Whenever
 * the app is open it writes the coming moments here (src/lib/nativeAlarms.ts);
 * MomentReceiver posts each at the first unlock inside its window, with the
 * app closed.
 */
@CapacitorPlugin(name = "Moments")
public class MomentsPlugin extends Plugin {
    /** The running app, if there is one, so a button pressed on the
     *  notification reaches it at once. Weak: never keep a closed app alive. */
    private static WeakReference<MomentsPlugin> running = new WeakReference<>(null);

    @Override
    public void load() {
        running = new WeakReference<>(this);
    }

    /** Hand a button press to the app if it's running; otherwise it waits in
     *  the queue for pending(). */
    static void emit(JSONObject item) {
        MomentsPlugin plugin = running.get();
        if (plugin == null) return;
        try {
            plugin.notifyListeners("pending", JSObject.fromJSONObject(item));
        } catch (Exception ignored) {
            // The queue still has it.
        }
    }

    /** What was entered on the notification and not yet saved by the app. */
    @PluginMethod
    public void pending(PluginCall call) {
        JSObject o = new JSObject();
        try {
            o.put("items", new JSArray(prefs().getString("pending", "[]")));
        } catch (Exception e) {
            o.put("items", new JSArray());
        }
        call.resolve(o);
    }

    /** { ids }: saved by the app, so off the queue. */
    @PluginMethod
    public void ack(PluginCall call) {
        Set<String> done = new HashSet<>();
        JSArray ids = call.getArray("ids");
        try {
            for (int i = 0; ids != null && i < ids.length(); i++) done.add(ids.getString(i));
            synchronized (MomentReceiver.QUEUE) {
                JSONArray queue = new JSONArray(prefs().getString("pending", "[]")), left = new JSONArray();
                for (int i = 0; i < queue.length(); i++) {
                    JSONObject item = queue.getJSONObject(i);
                    if (!done.contains(item.optString("id"))) left.put(item);
                }
                prefs().edit().putString("pending", left.toString()).commit();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not clear the queue: " + e.getMessage());
        }
    }

    /** { moments: [{ date, key, after, until, title, body }] }, minutes from midnight. */
    @PluginMethod
    public void arm(PluginCall call) {
        JSArray moments = call.getArray("moments");
        if (moments == null) {
            call.reject("No moments");
            return;
        }
        // commit, not apply: check() reads these straight back.
        prefs().edit().putBoolean("on", true).putString("moments", moments.toString()).commit();
        MomentReceiver.check(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void disarm(PluginCall call) {
        prefs().edit().putBoolean("on", false).remove("moments").commit();
        MomentReceiver.cancel(getContext());
        call.resolve(state());
    }

    /** { date, key }: post that armed moment now (the card's "Show it now").
     *  Resolves { buttons: [their titles] }. */
    @PluginMethod
    public void show(PluginCall call) {
        java.util.List<String> buttons = MomentReceiver.show(getContext(), call.getString("date", ""), call.getString("key", ""));
        if (buttons == null) {
            call.reject("Not shown: notifications are off for Slim Chance, or there is nothing to show yet.");
            return;
        }
        JSArray titles = new JSArray();
        for (String t : buttons) titles.put(t);
        JSObject o = new JSObject();
        o.put("buttons", titles);
        call.resolve(o);
    }

    /** { date, title, weighed, unit }: the home-screen widget's sentence and
     *  whether that day is weighed (src/lib/stores/moments.ts, widgetLines). */
    @PluginMethod
    public void setWidget(PluginCall call) {
        prefs().edit()
            .putString("widget_date", call.getString("date", ""))
            .putString("widget_title", call.getString("title", ""))
            .putBoolean("widget_weighed", Boolean.TRUE.equals(call.getBoolean("weighed", false)))
            .putString("widget_unit", call.getString("unit", "kg"))
            .commit();
        SlimWidget.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(MomentReceiver.PREFS, Context.MODE_PRIVATE);
    }

    private JSObject state() {
        SharedPreferences p = prefs();
        JSObject o = new JSObject();
        o.put("on", p.getBoolean("on", false));
        for (String key : new String[] { "morning", "evening" }) {
            JSObject k = new JSObject();
            k.put("shown", p.getString("shown:" + key, null));
            k.put("postedAt", p.getLong("postedAt:" + key, 0));
            o.put(key, k);
        }
        return o;
    }
}
