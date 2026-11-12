package com.toxicminds.recompos;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.util.SizeF;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Draws the home-screen widget the way a launcher does (RemoteViews.apply) at
 * real home-screen sizes, in light and dark, for each state of the day, and
 * saves every drawing as a PNG that CI keeps for a person to look at. Build 22's
 * widget shipped "massive and empty" because nobody saw it before the owner did.
 * A view a widget may not hold fails here, not as "Problem loading widget"; so
 * does a part cut off at the bottom, or a stretch of nothing inside the widget.
 */
@RunWith(AndroidJUnit4.class)
public class WidgetRenderTest {
    /** Widget sizes in dp, as launchers give them: 2x1, 3x1, 4x1, 2x2, short and
     *  tall 3x2 and 4x2, a 3- and 4-column 4x2 on taller cells, the owner's Pixel 7
     *  at 4x2 (373x314: build 24 drew coins and a sentence over 150 dp of
     *  nothing there), its 3-column twin, and a 4x3. */
    private static final int[][] SIZES = {
        { 150, 70 }, { 250, 70 }, { 330, 70 }, { 150, 170 }, { 250, 150 }, { 330, 150 }, { 250, 190 }, { 330, 190 },
        { 250, 250 }, { 373, 250 }, { 280, 314 }, { 373, 314 }, { 373, 400 },
    };

    @Test
    public void everySizeDrawsInLightAndDark() {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File out = new File(app.getFilesDir(), "widget");
        if (!out.isDirectory() && !out.mkdirs()) throw new IllegalStateException("no folder for the drawings");
        String today = LocalDate.now().toString(), yesterday = LocalDate.now().minusDays(1).toString();
        // What the app writes (widgetLines in src/lib/stores/moments.ts).
        String food = "\"unit\":\"kg\",\"food\":\"1,580 of 2,100 kcal\",\"protein\":\"62 of 160 g protein\","
            + "\"kcal\":1580,\"share\":2100,\"proteinG\":62,\"proteinTarget\":160,\"week\":[95,120,88,75,-1,-1,-1],"
            + "\"next\":{\"date\":\"" + today + "\",\"food\":\"0 of 1,867 kcal\",\"protein\":\"0 of 160 g protein\","
            + "\"kcal\":0,\"share\":1867,\"proteinG\":0,\"proteinTarget\":160,\"week\":[95,120,88,75,-1,-1,-1]}";
        String low = "\"title\":\"Your chance of slimming is low right now.\",\"hint\":\"A week inside your budget turns it.\",\"lit\":3," + food;
        String toss = "\"title\":\"Your chance of slimming is a coin toss. Every morning sharpens it.\",\"hint\":\"\",\"lit\":6," + food;
        String[][] states = {
            { "morning", "{\"date\":\"" + today + "\",\"weighed\":false," + low + "}" },
            { "weighed", "{\"date\":\"" + today + "\",\"weighed\":true," + low + "}" },
            { "tossup", "{\"date\":\"" + today + "\",\"weighed\":true," + toss + "}" },
            { "newday", "{\"date\":\"" + yesterday + "\",\"weighed\":true," + low + "}" },
            { "empty", "" },
        };
        List<String> wrong = new ArrayList<>();
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
                    draw(ctx, pick(layouts, s[0], s[1]), s[0], s[1], new File(out, name), wrong);
                }
                // Each layout at the least size it is used for: what fits there
                // fits at every size Android gives it (more height only widens
                // the gaps), so a size set too low fails here.
                for (Map.Entry<SizeF, RemoteViews> e : layouts.entrySet()) {
                    int w = Math.round(e.getKey().getWidth()), h = Math.round(e.getKey().getHeight());
                    String name = state[0] + "-" + (night ? "dark" : "light") + "-least-" + w + "x" + h + ".png";
                    draw(ctx, e.getValue(), w, h, new File(out, name), wrong);
                }
            }
        }
        // Every drawing is made and kept first, then everything wrong is said at once.
        if (!wrong.isEmpty()) throw new AssertionError(wrong.size() + " drawings are wrong:\n" + String.join("\n", wrong));
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

    private static void draw(Context ctx, RemoteViews rv, int wDp, int hDp, File file, List<String> wrong) {
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
            String name = file.getName();
            String cut = cutOff(v, d);
            if (cut != null) wrong.add(name + ": " + cut);
            String gap = emptyBand(b, d);
            if (gap != null) wrong.add(name + ": " + gap);
        });
    }

    /** A layout taller than the widget pushes its last parts, the buttons,
     *  past the bottom edge, where nobody can see or tap them. */
    private static String cutOff(View root, float d) {
        if (!(root instanceof ViewGroup)) return null;
        ViewGroup g = (ViewGroup) root;
        int floor = g.getHeight() - g.getPaddingBottom();
        for (int i = 0; i < g.getChildCount(); i++) {
            View c = g.getChildAt(i);
            if (c.getVisibility() == View.VISIBLE && c.getHeight() > 0 && c.getBottom() > floor + 1)
                return "a part ends " + Math.round((c.getBottom() - floor) / d) + " dp past the bottom edge";
        }
        return null;
    }

    /** The owner's 4x2 on build 24: coins and a sentence over 150 dp of nothing
     *  (2026-11-12). Inside the widget, no run of empty rows may be taller than
     *  48 dp or a fifth of the widget, whichever is more. */
    private static String emptyBand(Bitmap b, float d) {
        int w = b.getWidth(), h = b.getHeight();
        int x0 = Math.round(16 * d), x1 = w - Math.round(16 * d);
        int bg = b.getPixel(w / 2, Math.round(5 * d)); // the card, above its first line
        int[] row = new int[x1 - x0];
        int run = 0, worst = 0;
        boolean seen = false;
        for (int y = Math.round(4 * d); y < h - Math.round(4 * d); y++) {
            b.getPixels(row, 0, row.length, x0, y, row.length, 1);
            boolean empty = true;
            for (int px : row) if (px != bg) { empty = false; break; }
            if (empty) run++;
            else {
                if (seen) worst = Math.max(worst, run);
                seen = true;
                run = 0;
            }
        }
        float allowed = Math.max(48 * d, h / 5f);
        return worst > allowed ? Math.round(worst / d) + " dp of nothing inside (at most " + Math.round(allowed / d) + ")" : null;
    }
}
