// BACK REBUILD — six weeks from "hurt my back" to lifting normally again.
//
// Shape follows standard return-to-load practice for non-specific back and
// neck pain rather than anything exotic:
//   • Move every day. Walking and McGill's "Big 3" (curl-up, side plank,
//     bird dog) build trunk endurance without loading a flexed spine.
//   • Re-learn the hip hinge with no load (a dowel), then a low-spinal-load
//     hinge (cable pull-through), then dumbbell RDLs, then the trap bar.
//   • Train everything that doesn't hurt the whole time — chest-supported
//     rows, anti-rotation (Pallof), carries — instead of resting it all.
//   • Look after the neck and upper back as well as the lower back: chin tucks
//     for the deep neck flexors, wall angels and prone Y raises for the
//     mid-back, and nothing heavy through the neck. Carries with the shoulders
//     down (no shrugging), eyes level under a bar (never looking up), pulldowns
//     to the front only.
//   • Pain decides the pace, not the calendar (see RULES): progress on a
//     green week, repeat on amber, back off on red.
//
// This is general guidance for an uncomplicated back strain, not a diagnosis.
// RED_FLAGS are the situations where the right move is a doctor, not an app.
//
// Sessions use the app's PlanSession shape, so the Train page renders them,
// logs sets against them and shows their videos with no special casing. Each
// phase is two weeks: `w1` is the prescription for its first week, `w2` for
// its second. Every video id is checked by `npm run check:videos`.

import type { PlanExercise, PlanSession } from '../training/index.ts';

export interface ProgramPhase {
  /** Program weeks this phase covers, e.g. [1, 2]. */
  weeks: [number, number];
  name: string;
  goal: string;
  effort: string;
  badminton: string;
  /** The badminton rule in one line, for the briefing and Today. */
  badmintonShort: string;
  /** Whether games are on this phase: false means drills or a walk only. */
  play: boolean;
  /** Gym sessions in week order: first gym day of the week gets A, then B, then C. */
  sessions: [PlanSession, PlanSession, PlanSession];
}

const ex = (phase: string, name: string, muscle: string, w1: string, w2: string, rest: string, tip: string, vid: string): PlanExercise =>
  ({ phase, name, muscle, w1, w2, rest, tip, vid });

// ── Shared building blocks ─────────────────────────────────────────────────
const WARM = 'Warm-up (5 min)';
const CATCAMEL = ex(WARM, 'Cat-Camel', 'Spine · Mobility', '1 × 8 slow', '1 × 8 slow', '—',
  'Motion, not a stretch: round and arch only as far as is comfortable. It greases the joints before you load them.', 'P4z-5Oz9zXE');
const BIRDDOG_WARM = ex(WARM, 'Bird Dog', 'Core · Back extensors', '2 × 5/side, 5 s hold', '2 × 5/side, 5 s hold', '—',
  'Reach long, not high. Hips stay level — imagine a glass of water on your lower back.', 'QQot16miua8');
const BRIDGE_WARM = ex(WARM, 'Glute Bridge', 'Glutes', '2 × 12', '2 × 12', '—',
  'Drive through the heels and squeeze your glutes at the top. Ribs down: the lift comes from the hips, not an arched back.', 'PhTDzR0TpZs');
const WALK = ex('Finish', 'Easy walk', 'Recovery', '10 min', '10 min', '—',
  'Walking after training calms a sensitive back better than lying down.', '');

export const DAILY: PlanExercise[] = [
  ex('Every day — 15 min', 'Walk', 'Recovery', '20–30 min', '30 min', '—',
    'The best-evidenced thing for a recovering back. Split it into 2–3 shorter walks if one long one aggravates it.', ''),
  CATCAMEL,
  ex('Every day — 15 min', 'McGill Curl-Up', 'Abs · Spine-sparing', '5 / 3 / 1 reps, 10 s holds', '6 / 4 / 2 reps, 10 s holds', '—',
    'Hands under the small of your back to keep its natural curve. Lift head and shoulders as one block just off the floor, the neck long and still — no crunch. If it pulls on the neck, leave the head down and just brace.', 'EiicBbQknBk'),
  ex('Every day — 15 min', 'Side Plank (knees)', 'Obliques · QL', '5 / 3 / 1 × 10 s per side', '6 / 4 / 2 × 10 s per side', '—',
    'Elbow under shoulder, knees bent, hips pushed forward so knee, hip and shoulder line up.', 'CofbfhHCWCY'),
  ex('Every day — 15 min', 'Bird Dog', 'Core · Back extensors', '5 / 3 / 1 × 10 s per side', '6 / 4 / 2 × 10 s per side', '—',
    'Make a fist and squeeze; hold each rep 10 s. Sweep the hand and knee back under you between reps.', 'QQot16miua8'),
  ex('Every day — 15 min', 'Chin Tuck', 'Deep neck flexors', '2 × 10, 5 s holds', '3 × 10, 5 s holds', '—',
    'Sit or lie tall and slide your chin straight back, as if making a double chin. Hold 5 s. The back of the neck gets long; nothing should pinch or tingle.', 'KqR1EoEmq9c'),
  ex('Every day — 15 min', 'Wall Angel', 'Mid-back · Shoulders', '1 × 8 slow', '2 × 8 slow', '—',
    'Back, head and arms against a wall. Slide the arms up and down only as far as they stay in touch; the mid-back and shoulder blades do the work, the neck stays long.', 'cvx06snMQ3A'),
];

export const PHASES: ProgramPhase[] = [
  {
    weeks: [1, 2],
    name: 'Calm & connect',
    goal: 'Move every day, groove the hip hinge with no load, and keep training everything that doesn’t hurt.',
    effort: 'Easy — finish every set with 4+ reps in the tank (RPE 5–6).',
    badminton: 'No matches yet. Footwork or shadow drills only, 30 min at most — lunges, twists and smashes are exactly what a healing back dislikes.',
    badmintonShort: 'no games yet. Footwork drills or a walk, 30 min.',
    play: false,
    sessions: [
      {
        key: 'rebuild-a', name: 'Rebuild A — Hinge & legs', duration: '~40 min',
        focus: 'Re-learn the hip hinge, light box squats, single-leg balance',
        exercises: [
          CATCAMEL, BIRDDOG_WARM, BRIDGE_WARM,
          ex('Strength', 'Hip Hinge with Dowel', 'Hamstrings · Pattern', '3 × 10', '3 × 10', '45s',
            'Dowel touches head, upper back and tailbone the whole time. Push the hips back until the hamstrings stretch. If the dowel leaves your back, you bent your spine instead of your hips.', '2W_gXhut5S8'),
          ex('Strength', 'Goblet Box Squat', 'Quads · Glutes', '3 × 8 light (8–12 kg)', '3 × 8 (+2 kg if green)', '90s',
            'Sit back to a box at knee height, touch, stand. Brace as if someone is about to poke your stomach; ribs stay down.', 'mIJub2k6YNg'),
          ex('Strength', 'Split Squat (bodyweight)', 'Quads · Glutes', '2 × 8/side', '3 × 8/side', '60s',
            'Hold a rack for balance. Torso tall, back knee drops straight down.', 'SGHnCftrZkA'),
          ex('Core', 'Side Plank (knees)', 'Obliques · QL', '3 × 15 s/side', '3 × 20 s/side', '30s',
            'Knees, hips, shoulders in one line. Breathe normally — no breath-holding.', 'CofbfhHCWCY'),
          ex('Core', 'Dead Bug', 'Deep core', '3 × 6/side', '3 × 8/side', '45s',
            'Low back stays heavy on the floor. Move slowly; exhale as the arm and leg go out.', 'GbSC02oU3To'),
          WALK,
        ],
      },
      {
        key: 'rebuild-b', name: 'Rebuild B — Upper, back supported', duration: '~40 min',
        focus: 'Push and pull with the spine supported, anti-rotation, a light carry',
        exercises: [
          CATCAMEL, BIRDDOG_WARM,
          ex('Strength', 'Chest-Supported DB Row', 'Lats · Mid-back', '3 × 10', '3 × 12', '75s',
            'Chest on an incline bench, so your lower back does no work. Elbows to the hips, pause 1 s at the top.', 'ym-Mp8tCF00'),
          ex('Strength', 'Lat Pulldown', 'Lats', '3 × 10', '3 × 12', '75s',
            'Sit tall and keep the ribs down — no leaning back to heave the weight. Always to the front, never behind the neck.', 'SALxEARiMkw'),
          ex('Strength', 'Incline Dumbbell Press', 'Upper chest · Shoulders', '3 × 10 light', '3 × 10', '75s',
            'Feet flat, glutes on the bench, no big arch.', '8fXfwG4ftaQ'),
          ex('Strength', 'Face Pull', 'Rear delts · Upper back', '2 × 15', '3 × 15', '45s',
            'Pull the rope to your forehead, thumbs back, elbows high.', 'eTCBSFlCJ_s'),
          ex('Strength', 'Prone Y Raise', 'Lower traps · Upper back', '2 × 10, no weight', '3 × 10, no weight', '45s',
            'Chest on an incline bench, thumbs up, raise the arms into a Y. Shoulder blades down and back; the neck stays long, chin slightly tucked.', 'juoKsTqy77E'),
          ex('Core', 'Pallof Press', 'Anti-rotation core', '3 × 10/side', '3 × 12/side', '45s',
            'The cable tries to twist you. Don’t let it — that IS the exercise. Hips and shoulders stay square.', '_2xWmYNnFS8'),
          ex('Carry', 'Farmer Carry (light)', 'Grip · Trunk', '3 × 30 m', '3 × 40 m', '60s',
            'Walk tall with short steps, shoulders down and back: the legs and trunk carry it, the traps don’t shrug it. Pick up and put down with a hip hinge, never a rounded back.', 'z7E_YU9P1jU'),
        ],
      },
      {
        key: 'rebuild-c', name: 'Rebuild C — Full body', duration: '~40 min',
        focus: 'Your first loaded hinge, squats, push, pull, an offset carry',
        exercises: [
          CATCAMEL, BIRDDOG_WARM,
          ex('Strength', 'Goblet Box Squat', 'Quads · Glutes', '3 × 8', '3 × 10', '90s',
            'Same as Monday. Add a little only if the week has been green.', 'mIJub2k6YNg'),
          ex('Strength', 'Cable Pull-Through', 'Glutes · Hamstrings', '3 × 12 light', '3 × 12', '60s',
            'Your first loaded hinge: the cable pulls backwards, so the spine stays light. Hips back, then squeeze the glutes to stand.', 'IU-ERkjTKXA'),
          ex('Strength', 'Incline Push-Up', 'Chest · Triceps', '3 × 8', '3 × 10', '60s',
            'Hands on a bench or bar; body is one plank from head to heels.', 'Gvm5Q29UHbk'),
          ex('Strength', 'Seated Cable Row', 'Mid-back · Lats', '3 × 10', '3 × 12', '60s',
            'Sit tall; the torso doesn’t rock. Squeeze the shoulder blades together.', 'xQNrFHEMhI4'),
          ex('Carry', 'Suitcase Carry', 'Obliques · Grip', '3 × 20 m/side', '3 × 30 m/side', '60s',
            'One weight, one hand, and don’t lean — the opposite side of your trunk holds you upright. Shoulders level and down.', '6gXYfAChWz0'),
          ex('Core', 'Bird Dog', 'Core · Back extensors', '3 × 6/side, 10 s', '3 × 8/side, 10 s', '30s',
            'Slow and level. Quality beats reps.', 'QQot16miua8'),
          WALK,
        ],
      },
    ],
  },
  {
    weeks: [3, 4],
    name: 'Load the hinge',
    goal: 'Put real load through the hinge and squat again, and bring back single-leg strength.',
    effort: 'Moderate — 2–3 reps in the tank (RPE 6–7). Add load only after a green week.',
    badminton: 'Light rallying, 45 min at most. No smashes, no jump smashes, no diving. Ten minutes of warm-up first.',
    badmintonShort: 'light rallies, 45 min at most, no smashes. Warm up 10 min.',
    play: true,
    sessions: [
      {
        key: 'rebuild-a', name: 'Rebuild A — Hinge & legs', duration: '~45 min',
        focus: 'Dumbbell RDLs, full goblet squats, Bulgarian split squats',
        exercises: [
          CATCAMEL, BIRDDOG_WARM, BRIDGE_WARM,
          ex('Strength', 'Dumbbell Romanian Deadlift', 'Hamstrings · Glutes', '3 × 8 (2 × 12 kg)', '3 × 8 (+2–4 kg)', '90s',
            'The same hinge as the dowel. Dumbbells slide down the thighs to just below the knee; stop where your back would start to round.', 'hQgFixeXdZo'),
          ex('Strength', 'Goblet Squat', 'Quads · Glutes', '3 × 8', '3 × 8 (+4 kg)', '90s',
            'Full depth you own, no box. 3 s down, stand up smoothly.', 'lRYBbchqxtI'),
          ex('Strength', 'Bulgarian Split Squat', 'Quads · Glutes', '2 × 8/side', '3 × 8/side', '75s',
            'Rear foot on a bench, most weight on the front leg, torso slightly forward.', 'hPlKPjohFS0'),
          ex('Strength', '45° Back Extension', 'Glutes · Back extensors', '2 × 10 bodyweight', '3 × 10 bodyweight', '60s',
            'Hinge at the hips over the pad with a neutral spine. Squeeze the glutes to rise and stop at a straight line — no arching at the top.', 'H8Swl1N-uis'),
          ex('Core', 'Side Plank', 'Obliques · QL', '3 × 20 s/side', '3 × 25 s/side', '30s',
            'Off the knees now, if week 2 was comfortable.', 'CofbfhHCWCY'),
          ex('Core', 'Dead Bug', 'Deep core', '3 × 8/side', '3 × 10/side', '45s',
            'Slow. The low back never lifts.', 'GbSC02oU3To'),
        ],
      },
      {
        key: 'rebuild-b', name: 'Rebuild B — Upper', duration: '~45 min',
        focus: 'Heavier rows and presses, landmine pressing, heavier carries',
        exercises: [
          CATCAMEL, BIRDDOG_WARM,
          ex('Strength', 'Chest-Supported DB Row', 'Lats · Mid-back', '3 × 10', '3 × 10 (+2 kg)', '75s',
            'Still chest-supported: the back gets stronger from carries and hinges, not from rows.', 'ym-Mp8tCF00'),
          ex('Strength', 'Lat Pulldown', 'Lats', '3 × 10', '3 × 10 (+2.5 kg)', '75s', 'Sit tall, ribs down. To the front, never behind the neck.', 'SALxEARiMkw'),
          ex('Strength', 'Incline Dumbbell Press', 'Upper chest · Shoulders', '3 × 10', '3 × 8 (+2 kg)', '90s', 'Feet flat, no big arch.', '8fXfwG4ftaQ'),
          ex('Strength', 'Half-Kneeling Landmine Press', 'Shoulders · Core', '3 × 8/side', '3 × 10/side', '60s',
            'Kneeling locks the pelvis: squeeze the glute of the down knee and press up and slightly forward.', 'fx6lSVNvu-4'),
          ex('Strength', 'Face Pull', 'Rear delts · Upper back', '3 × 15', '3 × 15', '45s', 'Elbows high, thumbs back.', 'eTCBSFlCJ_s'),
          ex('Strength', 'Prone Y Raise', 'Lower traps · Upper back', '3 × 10 (1–2 kg)', '3 × 12 (1–2 kg)', '45s', 'Shoulder blades down and back; neck long.', 'juoKsTqy77E'),
          ex('Core', 'Pallof Press', 'Anti-rotation core', '3 × 12/side', '3 × 12/side (heavier)', '45s', 'Square hips, slow press.', '_2xWmYNnFS8'),
          ex('Carry', 'Farmer Carry', 'Grip · Trunk', '3 × 40 m', '3 × 40 m (heavier)', '60s', 'Tall, short steps, shoulders down — no shrug. Hinge to pick up.', 'z7E_YU9P1jU'),
        ],
      },
      {
        key: 'rebuild-c', name: 'Rebuild C — Full body', duration: '~45 min',
        focus: 'Trap-bar deadlift from high handles, squat, push, pull, carry',
        exercises: [
          CATCAMEL, BIRDDOG_WARM,
          ex('Strength', 'Trap-Bar Deadlift (high handles)', 'Glutes · Hamstrings · Back', '3 × 6 light', '3 × 6 (+10 kg)', '120s',
            'High handles shorten the pull. Push the floor away; hips and shoulders rise together. Eyes on the floor two metres ahead — never look up under the bar. Stop 3 reps short of hard.', '5BpuTmfQjro'),
          ex('Strength', 'Goblet Squat', 'Quads · Glutes', '3 × 10', '3 × 10 (+2 kg)', '90s', 'Own the bottom.', 'lRYBbchqxtI'),
          ex('Strength', 'Incline Push-Up', 'Chest · Triceps', '3 × 10', '3 × 12 (lower incline)', '60s', 'One plank, head to heels.', 'Gvm5Q29UHbk'),
          ex('Strength', 'Seated Cable Row', 'Mid-back · Lats', '3 × 10', '3 × 12', '60s', 'No rocking.', 'xQNrFHEMhI4'),
          ex('Carry', 'Suitcase Carry', 'Obliques · Grip', '3 × 30 m/side', '3 × 30 m/side (heavier)', '60s', 'Don’t lean; shoulders level and down.', '6gXYfAChWz0'),
          ex('Core', 'Bird Dog', 'Core · Back extensors', '3 × 8/side, 10 s', '3 × 10/side, 10 s', '30s', 'Level hips.', 'QQot16miua8'),
        ],
      },
    ],
  },
  {
    weeks: [5, 6],
    name: 'Return to strength',
    goal: 'Back to your normal lifts at about 70–80% of your pre-injury loads, with the habits that got you here.',
    effort: 'Working — 1–2 reps in the tank (RPE 7–8) on the main lifts only.',
    badminton: 'Normal play after two green weeks. Keep the first matches at about 70% effort and warm up properly.',
    badmintonShort: 'normal play at about 70% after two green weeks. Warm up first.',
    play: true,
    sessions: [
      {
        key: 'rebuild-a', name: 'Rebuild A — Strength (lower)', duration: '~55 min',
        focus: 'Trap-bar deadlift, Bulgarian split squats, back extensions',
        exercises: [
          CATCAMEL, BIRDDOG_WARM, BRIDGE_WARM,
          ex('Strength', 'Trap-Bar Deadlift', 'Glutes · Hamstrings · Back', '4 × 5', '4 × 5 (+10 kg)', '150s',
            'Standard handles now. Brace, push the floor away, lock out with the glutes — never by leaning back. Eyes level or down, never up.', '5BpuTmfQjro'),
          ex('Strength', 'Goblet Squat', 'Quads · Glutes', '4 × 8', '4 × 8 (heavier)', '90s', 'Strong and slow.', 'lRYBbchqxtI'),
          ex('Strength', 'Bulgarian Split Squat', 'Quads · Glutes', '3 × 8/side', '3 × 8/side (+DBs)', '75s', 'Front leg does the work.', 'hPlKPjohFS0'),
          ex('Strength', '45° Back Extension', 'Glutes · Back extensors', '3 × 12', '3 × 10 holding a plate', '60s', 'Neutral spine, glutes finish.', 'H8Swl1N-uis'),
          ex('Core', 'Side Plank', 'Obliques · QL', '3 × 30 s/side', '3 × 30 s/side', '30s', 'Long line, steady breath.', 'CofbfhHCWCY'),
        ],
      },
      {
        key: 'rebuild-b', name: 'Rebuild B — Strength (upper)', duration: '~50 min',
        focus: 'Back to pressing heavier, rows, landmine, carries',
        exercises: [
          CATCAMEL, BIRDDOG_WARM,
          ex('Strength', 'Incline Dumbbell Press', 'Upper chest · Shoulders', '4 × 8', '4 × 8 (+2 kg)', '90s', 'Feet flat, controlled.', '8fXfwG4ftaQ'),
          ex('Strength', 'Chest-Supported DB Row', 'Lats · Mid-back', '4 × 10', '4 × 10 (+2 kg)', '75s', 'Pause at the top.', 'ym-Mp8tCF00'),
          ex('Strength', 'Lat Pulldown', 'Lats', '3 × 10', '3 × 10 (heavier)', '75s', 'Ribs down. To the front, never behind the neck.', 'SALxEARiMkw'),
          ex('Strength', 'Half-Kneeling Landmine Press', 'Shoulders · Core', '3 × 10/side', '3 × 10/side (heavier)', '60s', 'Glute on, press forward-up.', 'fx6lSVNvu-4'),
          ex('Strength', 'Face Pull', 'Rear delts · Upper back', '3 × 15', '3 × 15', '45s', 'High elbows.', 'eTCBSFlCJ_s'),
          ex('Carry', 'Farmer Carry', 'Grip · Trunk', '3 × 40 m', '4 × 40 m (heavier only if the neck stays quiet)', '90s', 'Tall, shoulders down and back — the traps don’t shrug it.', 'z7E_YU9P1jU'),
        ],
      },
      {
        key: 'rebuild-c', name: 'Rebuild C — Full body', duration: '~50 min',
        focus: 'Deadlift volume, squats, push-ups, rows, heavy offset carry',
        exercises: [
          CATCAMEL, BIRDDOG_WARM,
          ex('Strength', 'Trap-Bar Deadlift', 'Glutes · Hamstrings · Back', '3 × 6', '3 × 6 (+5 kg)', '120s', 'Lighter than the first session: volume, not a max. Eyes down, neck long.', '5BpuTmfQjro'),
          ex('Strength', 'Dumbbell Romanian Deadlift', 'Hamstrings · Glutes', '3 × 10', '3 × 10 (heavier)', '90s', 'Hips back, flat back.', 'hQgFixeXdZo'),
          ex('Strength', 'Push-Up', 'Chest · Triceps', '3 × 8', '3 × 10', '60s', 'Floor push-ups if the incline felt easy.', 'Gvm5Q29UHbk'),
          ex('Strength', 'Seated Cable Row', 'Mid-back · Lats', '3 × 10', '3 × 10 (heavier)', '60s', 'Tall torso.', 'xQNrFHEMhI4'),
          ex('Carry', 'Suitcase Carry', 'Obliques · Grip', '3 × 30 m/side', '3 × 40 m/side', '60s', 'Upright, shoulders level and down — no shrug, no lean.', '6gXYfAChWz0'),
          ex('Core', 'Dead Bug', 'Deep core', '3 × 10/side', '3 × 10/side', '45s', 'Slow.', 'GbSC02oU3To'),
        ],
      },
    ],
  },
];

export const WEEKS = 6;

export const RULES = [
  { tone: 'good' as const, title: 'Green — follow the plan', body: 'Pain 0–3/10 while training, and back to normal by the next morning.' },
  { tone: 'warn' as const, title: 'Amber — repeat the week', body: 'Pain 4–5/10, or the back is worse the next morning. Repeat this week and take about 20% off the loads.' },
  { tone: 'bad' as const, title: 'Red — back off', body: 'Pain 6+/10, sharp or shooting pain, or symptoms down a leg or an arm. Stop loading that movement; walking and the daily basics only. Not settling within a week? See a physio.' },
];

export const RED_FLAGS = [
  'Numbness around the groin, inner thighs or buttocks (the “saddle” area)',
  'New trouble controlling your bladder or bowels',
  'A leg or foot getting weaker — tripping, foot slapping, can’t stand on toes or heels',
  'Pain with fever, unexplained weight loss, or after a fall or accident',
  'Severe night pain that no position eases',
  'An arm or hand getting weaker, or numbness and tingling that keeps spreading down it',
  'Clumsy hands (buttons, handwriting, dropping things) or walking that feels unsteady',
];

/** Short explainers worth watching once before day one. */
export const INTRO_VIDEOS = [
  { vid: 'lUo4gOkrbiE', label: 'Can you lift after a back injury? (1 min)' },
  { vid: '2_e4I-brfqs', label: 'The McGill Big 3, explained (9 min)' },
  { vid: '-PW0bKD-Tms', label: 'How to recover from any injury (10 min)' },
];
