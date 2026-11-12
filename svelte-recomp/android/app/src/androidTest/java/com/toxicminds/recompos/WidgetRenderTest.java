package com.toxicminds.recompos;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.util.SizeF;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.time.LocalDate;
import java.util.Map;

/**
 * Draws the home-screen widget the way a launcher does (RemoteViews.apply) at
 * real home-screen sizes, in light and dark, for each state of the day, and
 * saves every drawing as a PNG that CI keeps for a person to look at. Build 22's
 * widget shipped "massive and empty" because nobody saw it before the owner did.
 * A view a widget may not hold fails here, not as "Problem loading widget".
 */
@RunWith(AndroidJUnit4.class)
public class WidgetRenderTest {
    /** Widget sizes in dp, as 4- and 5-column launchers give them: 2x1, 3x1, 4x1,
     *  2x2, short and tall 3x2 and 4x2. Between them every layout is drawn. */
    private static final int[][] SIZES = {
        { 150, 70 }, { 250, 70 }, { 330, 70 }, { 150, 170 }, { 250, 150 }, { 330, 150 }, { 250, 190 }, { 330, 190 },
    };

    @Test
    public void everySizeDrawsInLightAndDark() {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File out = new File(app.getFilesDir(), "widget");
        if (!out.isDirectory() && !out.mkdirs()) throw new IllegalStateException("no folder for the drawings");
        String today = LocalDate.now().toString(), yesterday = LocalDate.now().minusDays(1).toString();
        String day = "\"title\":\"Your chance of slimming is a coin toss. Every morning sharpens it.\",\"unit\":\"kg\","
            + "\"lit\":6,\"food\":\"1,580 of 2,100 kcal\",\"protein\":\"62 of 160 g protein\"";
        String[][] states = {
            { "morning", "{\"date\":\"" + today + "\",\"weighed\":false," + day + "}" },
            { "weighed", "{\"date\":\"" + today + "\",\"weighed\":true," + day + "}" },
            { "newday", "{\"date\":\"" + yesterday + "\",\"weighed\":true," + day + "}" },
            { "empty", "" },
        };
        for (String[] state : states) {
            app.getSharedPreferences(MomentReceiver.PREFS, Context.MODE_PRIVATE).edit()
                .putString("widget_json", state[1]).putString("widget_unit", "kg")
                .remove("acted:" + today + ":morning").commit();
            Map<SizeF, RemoteViews> layouts = SlimWidget.layouts(app);
            for (boolean night : new boolean[] { false, true }) {
                Configuration c = new Configuration(app.getResources().getConfiguration());
                c.uiMode = (c.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
                    | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
                Context ctx = app.createConfigurationContext(c);
                for (int[] s : SIZES) {
                    String name = state[0] + "-" + (night ? "dark" : "light") + "-" + s[0] + "x" + s[1] + ".png";
                    draw(ctx, pick(layouts, s[0], s[1]), s[0], s[1], new File(out, name));
                }
            }
        }
    }

    /** As Android picks: the largest layout that fits, else the smallest. */
    private static RemoteViews pick(Map<SizeF, RemoteViews> layouts, int w, int h) {
        RemoteViews best = null, smallest = null;
        float bestArea = -1, smallArea = Float.MAX_VALUE;
        for (Map.Entry<SizeF, RemoteViews> e : layouts.entrySet()) {
            float a = e.getKey().getWidth() * e.getKey().getHeight();
            if (a < smallArea) { smallArea = a; smallest = e.getValue(); }
            if (e.getKey().getWidth() <= w && e.getKey().getHeight() <= h && a > bestArea) { bestArea = a; best = e.getValue(); }
        }
        return best != null ? best : smallest;
    }

    private static void draw(Context ctx, RemoteViews rv, int wDp, int hDp, File file) {
        float d = ctx.getResources().getDisplayMetrics().density;
        int w = Math.round(wDp * d), h = Math.round(hDp * d);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            FrameLayout host = new FrameLayout(ctx);
            View v = rv.apply(ctx, host);
            host.addView(v, new FrameLayout.LayoutParams(w, h));
            host.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
            host.layout(0, 0, w, h);
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            b.eraseColor(0xFF6B7080); // a wallpaper behind the card, so its corners show
            host.draw(new Canvas(b));
            try (FileOutputStream o = new FileOutputStream(file)) {
                b.compress(Bitmap.CompressFormat.PNG, 100, o);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
    }
}
