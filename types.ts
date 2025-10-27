
export interface Exercise {
  name: string;
  duration_seconds: number;
  reps_sets_display: string;
  instructions: string;
  muscles: string[];
  gif_url?: string;
  form_tips?: string[];
}

export interface WorkoutPlan {
  day: string;
  focus: string;
  workout: Exercise[];
  total_duration: string;
  voice_script: {
    intro: string;
    outro: string;
    motivation: string[];
  };
}

export type WorkoutStatus = 'idle' | 'loading' | 'ready' | 'active_exercise' | 'active_rest' | 'active_set_rest' | 'paused' | 'finished' | 'error';