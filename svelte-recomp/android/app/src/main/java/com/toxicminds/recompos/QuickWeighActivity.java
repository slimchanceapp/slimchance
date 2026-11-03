package com.toxicminds.recompos;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

/**
 * "Log weight" from the morning notification, on the number pad (the owner,
 * 2026-11-03: half asleep, the notification's typed reply opened the full
 * keyboard, and Android lets no app choose that one). A small dialog over
 * whatever is on screen: one box, big digits, Save. It saves through the same
 * path as the typed reply (MomentReceiver.act), so the checks are the same,
 * "far from your trend: send it again" included. Stone keeps the typed reply:
 * the number pad has no space for "17 9".
 */
public class QuickWeighActivity extends AppCompatActivity {
    private AlertDialog dialog;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        final String date = getIntent().getStringExtra("date");
        final String key = getIntent().getStringExtra("key");
        if (date == null || key == null) { finish(); return; }
        String word = "lb".equals(getIntent().getStringExtra("unit")) ? "lb" : "kg";

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(24), dp(4), dp(24), 0);
        final TextView note = new TextView(this);
        note.setVisibility(View.GONE);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        final EditText field = new EditText(this);
        field.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        field.setTextSize(TypedValue.COMPLEX_UNIT_SP, 40);
        field.setGravity(Gravity.CENTER);
        field.setHint(word);
        field.setSingleLine(true);
        field.setImeOptions(EditorInfo.IME_ACTION_DONE);
        box.addView(note);
        box.addView(field);

        dialog = new AlertDialog.Builder(this)
            .setTitle("This morning’s weight")
            .setView(box)
            .setPositiveButton("Save", null)
            .setNegativeButton("Cancel", (d, w) -> finish())
            .setOnCancelListener(d -> finish())
            .create();
        dialog.setOnShowListener(d -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> save(field, note, date, key));
            field.requestFocus();
        });
        field.setOnEditorActionListener((v, id, ev) -> {
            if (id != EditorInfo.IME_ACTION_DONE) return false;
            save(field, note, date, key);
            return true;
        });
        if (dialog.getWindow() != null) dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        dialog.show();
    }

    private void save(EditText field, TextView note, String date, String key) {
        CharSequence typed = field.getText();
        if (typed == null || typed.toString().trim().isEmpty()) return;
        MomentReceiver.act(this, MomentReceiver.ACT_WEIGHT, date, key, typed);
        // act() leaves a note when it can't take the number yet: not a weight,
        // or far from the trend (then the same number again confirms it).
        SharedPreferences p = getSharedPreferences(MomentReceiver.PREFS, MODE_PRIVATE);
        String said = p.getString("note:" + date + ":" + key, null);
        if (said != null) {
            note.setText(said);
            note.setVisibility(View.VISIBLE);
            return;
        }
        dialog.dismiss();
        finish();
    }

    @Override
    protected void onDestroy() {
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
