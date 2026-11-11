/**
 * Exercise library for the Quick Builder.
 *
 * Every `vid` here is a YouTube id that `npm run check:videos` has verified as
 * (a) public and (b) `playableInEmbed`. That check exists because 11 of the 12
 * ids this file originally shipped had since been deleted or made private — the
 * app rendered a "Watch full video" button on nearly every exercise and every
 * one of them opened a dead player. Nothing detected it, because a dead YouTube
 * id fails INSIDE the iframe: the network request succeeds, so VideoEmbed's
 * `onerror` never fires and no fallback shows.
 *
 * Prefer channels unlikely to delete their back catalogue (NASM,
 * Bodybuilding.com, LIVESTRONG, PureGym, CrossFit, Hinge Health, Howcast) over
 * an individual creator's. Re-run the checker before shipping.
 *
 * This file also used to export `workoutSchedule` / `workoutSessions` — a
 * hardcoded Mon/Thu gym + Wed/Sat badminton week belonging to one person. It
 * had no importers (the live plan comes from `workoutPlanDefaults` via the DB),
 * so it was deleted rather than depersonalised.
 */

export interface BuildExercise {
  name: string; muscle: string; sets: string; rest: string;
  tip: string; vid?: string;
}

export interface BuildGroup {
  name: string; icon: string; exercises: BuildExercise[];
}

export const buildGroups: Record<string, BuildGroup> = {
  'full-body': {
    name:'Full Body',icon:'💪',
    exercises:[
      {name:'Goblet Squat',muscle:'Quads · Glutes',sets:'4 × 12',rest:'90s',
       tip:'Hold dumbbell at chest. Elbows inside knees. Drive through heels.',vid:'lRYBbchqxtI'},
      {name:'Incline Dumbbell Press',muscle:'Upper Chest',sets:'3 × 12',rest:'75s',
       tip:'Bench 30-45°, elbows at 45° from body.',vid:'8fXfwG4ftaQ'},
      {name:'Lat Pulldown',muscle:'Lats · Upper Back',sets:'3 × 12',rest:'75s',
       tip:'Slight backward lean. Pull bar to upper chest.',vid:'SALxEARiMkw'},
      {name:'Dumbbell Shoulder Press',muscle:'Shoulders',sets:'3 × 12',rest:'75s',
       tip:'Neutral grip, press slightly inward at top.',vid:'0JfYxMRsUCQ'},
      {name:'Plank Hold',muscle:'Core',sets:'3 × 40s',rest:'45s',
       tip:'Squeeze glutes and abs. Push floor away.',vid:'mwlp75MS6Rg'},
    ]
  },
  'upper-body': {
    name:'Upper Body',icon:'💪',
    exercises:[
      {name:'Incline Dumbbell Press',muscle:'Upper Chest',sets:'3 × 12',rest:'75s',
       tip:'Bench 30-45°, elbows 45° from body.',vid:'8fXfwG4ftaQ'},
      {name:'Lat Pulldown',muscle:'Lats',sets:'4 × 12',rest:'75s',
       tip:'Pull to upper chest, full stretch at top.',vid:'SALxEARiMkw'},
      {name:'Seated Cable Row',muscle:'Mid Back',sets:'3 × 12',rest:'75s',
       tip:'Row to belly button, squeeze 1 sec.',vid:'xQNrFHEMhI4'},
      {name:'Dumbbell Shoulder Press',muscle:'Shoulders',sets:'3 × 12',rest:'75s',
       tip:'Press slightly inward at top.',vid:'0JfYxMRsUCQ'},
      {name:'Dumbbell Bicep Curl',muscle:'Biceps',sets:'3 × 12',rest:'60s',
       tip:'Elbow pinned at hip. Slow negative.',vid:'ykJmrZ5v0Oo'},
      {name:'Tricep Rope Pushdown',muscle:'Triceps',sets:'3 × 15',rest:'60s',
       tip:'Elbows pinned. Flare at bottom.',vid:'kiuVA0gs3EI'},
    ]
  },
  'lower-body': {
    name:'Lower Body',icon:'🦵',
    exercises:[
      {name:'Goblet Squat',muscle:'Quads · Glutes',sets:'4 × 12',rest:'90s',
       tip:'Deep squat, elbows inside knees.',vid:'lRYBbchqxtI'},
      {name:'Leg Press',muscle:'Quads · Hamstrings',sets:'3 × 15',rest:'90s',
       tip:'Push through heels. Never lock out.',vid:'p5dCqF7wWUw'},
      {name:'Romanian Deadlift',muscle:'Hamstrings · Glutes',sets:'4 × 10',rest:'90s',
       tip:'Push hips back. Bend at waist.',vid:'5rIqP63yWFg'},
      {name:'Walking Lunges',muscle:'Quads · Glutes',sets:'3 × 10 each',rest:'75s',
       tip:'Front knee 90°. Keep torso upright.',vid:'DlhojghkaQ0'},
    ]
  },
  'core': {
    name:'Core',icon:'🔥',
    exercises:[
      {name:'Plank Hold',muscle:'Full Core',sets:'3 × 45s',rest:'45s',
       tip:'Push floor away. Squeeze glutes.',vid:'mwlp75MS6Rg'},
      {name:'Dead Bug',muscle:'Deep Core',sets:'3 × 10 each',rest:'45s',
       tip:'Lower back flat to floor. Move slow.',vid:'GbSC02oU3To'},
      {name:'Bicycle Crunch',muscle:'Obliques',sets:'3 × 16',rest:'45s',
       tip:'Elbow to opposite knee. Slow twist.',vid:'HWX93vAoLvw'},
      {name:'Russian Twist',muscle:'Obliques',sets:'3 × 12 each',rest:'45s',
       tip:'Feet off ground. Rotate torso.',vid:'wkD8rjkodUI'},
    ]
  }
};
