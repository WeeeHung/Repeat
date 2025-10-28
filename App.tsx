import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { WorkoutPlan, Exercise, WorkoutStatus } from './types';
import { WEEKLY_PLAN, DAYS_OF_WEEK } from './constants';
import { WORKOUT_DATA } from './data/workouts';
import { getTTSAudio } from './services/geminiService';
import { audioService } from './services/audioService';
import { TimerCircle } from './components/TimerCircle';

const REST_PERIOD_S = 30;
const SET_REST_PERIOD_S = 90;
const TOTAL_SETS = 4;

export default function App() {
    const [status, setStatus] = useState<WorkoutStatus>('idle');
    const [workoutPlan, setWorkoutPlan] = useState<WorkoutPlan | null>(null);
    const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
    const [currentSet, setCurrentSet] = useState(1);
    const [timer, setTimer] = useState(0);
    const [totalDuration, setTotalDuration] = useState(0);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isAudioLoading, setIsAudioLoading] = useState(false);

    const timerIntervalRef = useRef<number | null>(null);
    const audioCacheRef = useRef<Map<string, string>>(new Map());
    const audioPlaybackQueueRef = useRef<string[]>([]);
    const isPlayingAudioRef = useRef(false);

    const today = new Date();
    const dayOfWeek = today.getDay();
    const dayName = DAYS_OF_WEEK[dayOfWeek];
    const focus = WEEKLY_PLAN[dayOfWeek];

    const processPlaybackQueue = useCallback(async () => {
        if (isPlayingAudioRef.current || audioPlaybackQueueRef.current.length === 0) return;

        isPlayingAudioRef.current = true;
        
        while (audioPlaybackQueueRef.current.length > 0) {
            const audioData = audioPlaybackQueueRef.current.shift();
            if (audioData) {
                try {
                    await audioService.playTTS(audioData);
                } catch (error) {
                    console.error("Failed to play audio from queue:", error);
                    setErrorMessage("Audio guidance is currently unavailable.");
                }
            }
        }
        
        isPlayingAudioRef.current = false;
    }, []);

    const preGenerateAudio = useCallback(async (text: string) => {
        if (!text || audioCacheRef.current.has(text)) return;
        try {
            const audioData = await getTTSAudio(text);
            audioCacheRef.current.set(text, audioData);
        } catch (error) {
            console.error(`Failed to pre-generate audio for "${text}":`, error);
        }
    }, []);
    
    const speak = useCallback((text: string) => {
        const cachedAudio = audioCacheRef.current.get(text);

        const queueAndPlay = (audioData: string) => {
            audioPlaybackQueueRef.current.push(audioData);
            processPlaybackQueue();
        };

        if (cachedAudio) {
            queueAndPlay(cachedAudio);
        } else {
            console.warn(`Audio for "${text}" was not pre-generated. Playing with delay.`);
            getTTSAudio(text)
                .then(audioData => {
                    audioCacheRef.current.set(text, audioData);
                    queueAndPlay(audioData);
                })
                .catch(error => {
                    console.error("Error in fallback audio generation:", error);
                    setErrorMessage("Audio guidance is currently unavailable.");
                });
        }
    }, [processPlaybackQueue]);


    const stopTimer = useCallback(() => {
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }
    }, []);

    const startTimer = useCallback((duration: number, isExercise: boolean, isResume: boolean = false) => {
        stopTimer();
        setTimer(duration);
        if (!isResume) {
            setTotalDuration(duration);
        }

        timerIntervalRef.current = window.setInterval(() => {
            setTimer(prev => {
                if (prev <= 1) {
                    stopTimer();
                    return 0;
                }
                 if(isExercise && prev === 11) {
                    speak("10 seconds left, push through!");
                }
                 // Speak a form tip halfway through an exercise
                if (isExercise && workoutPlan && prev === Math.floor(totalDuration / 2)) {
                    const currentExercise = workoutPlan.workout[currentExerciseIndex];
                    if (currentExercise.form_tips && currentExercise.form_tips.length > 0) {
                        const randomTip = currentExercise.form_tips[Math.floor(Math.random() * currentExercise.form_tips.length)];
                        speak(randomTip);
                    }
                }
                return prev - 1;
            });
        }, 1000);
    }, [stopTimer, speak, workoutPlan, currentExerciseIndex, totalDuration]);
    
    useEffect(() => {
        if (timer > 0 || !workoutPlan || !['active_exercise', 'active_rest', 'active_set_rest'].includes(status)) {
            return;
        }

        if (status === 'active_exercise') {
            const isLastExerciseInSet = currentExerciseIndex === workoutPlan.workout.length - 1;
            const isLastSet = currentSet === TOTAL_SETS;

            if (isLastExerciseInSet) {
                if (isLastSet) {
                    setStatus('finished');
                    speak(workoutPlan.voice_script.outro);
                } else {
                    setStatus('active_set_rest');
                    speak(`Set ${currentSet} complete. Take a well-deserved ${SET_REST_PERIOD_S} second rest.`);
                    startTimer(SET_REST_PERIOD_S, false);
                }
            } else {
                setStatus('active_rest');
                const nextExercise = workoutPlan.workout[currentExerciseIndex + 1];
                speak("Rest.");
                setTimeout(() => {
                    if (nextExercise) {
                        speak(`Up next is ${nextExercise.name}.`);
                        speak(nextExercise.instructions);
                    }
                }, 1500);
                startTimer(REST_PERIOD_S, false);
            }
        } else if (status === 'active_rest') {
            const nextIndex = currentExerciseIndex + 1;
            setCurrentExerciseIndex(nextIndex);
            setStatus('active_exercise');
            const nextExercise = workoutPlan.workout[nextIndex];
            speak(`Let's go. ${nextExercise.name}.`);
            startTimer(nextExercise.duration_seconds, true);

        } else if (status === 'active_set_rest') {
            const newSet = currentSet + 1;
            setCurrentSet(newSet);
            setCurrentExerciseIndex(0);
            setStatus('active_exercise');
            const firstExercise = workoutPlan.workout[0];
            speak(`Starting set ${newSet}. First up: ${firstExercise.name}.`);
            startTimer(firstExercise.duration_seconds, true);
        }
    }, [timer, status, workoutPlan, currentExerciseIndex, currentSet, speak, startTimer]);

    const preGenerateAllWorkoutAudio = useCallback(async (plan: WorkoutPlan) => {
        setIsAudioLoading(true);
        const textsToGenerate = new Set<string>();
        
        textsToGenerate.add(plan.voice_script.intro);
        textsToGenerate.add(plan.voice_script.outro);
        textsToGenerate.add("10 seconds left, push through!");
        textsToGenerate.add("Rest.");

        plan.workout.forEach(ex => {
            textsToGenerate.add(ex.name);
            textsToGenerate.add(ex.instructions);
            textsToGenerate.add(`Up next is ${ex.name}.`);
            textsToGenerate.add(`Let's go. ${ex.name}.`);
             if (ex.form_tips) {
                ex.form_tips.forEach(tip => textsToGenerate.add(tip));
            }
        });

        for(let i = 1; i <= TOTAL_SETS; i++) {
            textsToGenerate.add(`Set ${i} complete. Take a well-deserved ${SET_REST_PERIOD_S} second rest.`);
            textsToGenerate.add(`Starting set ${i}. First up: ${plan.workout[0].name}.`);
        }

        const generationPromises = Array.from(textsToGenerate).map(text => preGenerateAudio(text));
        
        await Promise.all(generationPromises);
        setIsAudioLoading(false);
    }, [preGenerateAudio]);


    const handleFetchWorkout = useCallback(async (isTired = false) => {
        audioService.unlockAudio(); // Unlock audio on the first user gesture
        setStatus('loading');
        setErrorMessage(null);
        
        let workoutKey = focus;
        if (isTired) {
             workoutKey = "Active Recovery (Mobility / Yoga)";
        }

        const plan = WORKOUT_DATA[workoutKey];

        if (plan) {
            setWorkoutPlan(plan);
            await preGenerateAllWorkoutAudio(plan);
            setStatus('ready');
        } else if (focus === "Rest / Reflection") {
             setStatus('idle');
        }
        else {
            setStatus('error');
            setErrorMessage(`Could not find a workout for today's focus: ${focus}`);
        }
    }, [focus, preGenerateAllWorkoutAudio]);

    const handleStartWorkout = () => {
        if (!workoutPlan) return;

        audioService.unlockAudio(); // Also unlock here as a fallback
        speak(workoutPlan.voice_script.intro);
        
        setCurrentExerciseIndex(0);
        setCurrentSet(1);
        
        const firstExercise = workoutPlan.workout[0];
        if (firstExercise) {
            startTimer(firstExercise.duration_seconds, true);
        }
        setStatus('active_exercise');
    };

    const handlePauseResume = () => {
        if (status === 'paused') {
             // Determine previous state based on what the total duration was set to
            const wasExercise = workoutPlan?.workout.some(ex => ex.duration_seconds === totalDuration) ?? true;
            const wasSetRest = totalDuration === SET_REST_PERIOD_S;

            let prevState: WorkoutStatus = 'active_exercise';
            if (wasSetRest) {
                prevState = 'active_set_rest';
            } else if (!wasExercise) {
                prevState = 'active_rest';
            }
            
            setStatus(prevState);
            startTimer(timer, prevState === 'active_exercise', true);
        } else {
            stopTimer();
            setStatus('paused');
        }
    };
    
    const handleReset = () => {
        stopTimer();
        setStatus('idle');
        setWorkoutPlan(null);
        setCurrentExerciseIndex(0);
        setCurrentSet(1);
        setTimer(0);
        setErrorMessage(null);
        audioCacheRef.current.clear();
        audioPlaybackQueueRef.current = [];
        isPlayingAudioRef.current = false;
    }
    
    const renderContent = () => {
        if (status === 'error') {
            return (
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-red-400 mb-4">Something Went Wrong</h2>
                    <p className="text-gray-300 mb-6">{errorMessage}</p>
                    <button onClick={handleReset} className="px-6 py-3 bg-cyan-600 rounded-lg font-semibold hover:bg-cyan-500 transition-colors">Go Back</button>
                </div>
            );
        }
        
        if (status === 'loading') {
            return (
                <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 border-4 border-t-cyan-400 border-r-cyan-400 border-b-cyan-400 border-l-gray-600 rounded-full animate-spin"></div>
                    <p className="mt-4 text-lg text-gray-300">
                        {isAudioLoading ? "Preparing workout..." : "Getting your workout ready..."}
                    </p>
                </div>
            );
        }

        if (status === 'idle') {
            const isRestDay = focus.toLowerCase().includes('rest');
            return (
                <div className="text-center p-4">
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-white">
                        <i className="fa-solid fa-dumbbell mr-3 text-cyan-400"></i>
                        Repeat
                    </h1>
                    <p className="text-lg text-gray-400 mt-2">{dayName}</p>
                    <div className="my-8 p-6 bg-gray-800 rounded-2xl shadow-lg">
                        <h2 className="text-3xl font-bold text-cyan-400">{focus}</h2>
                    </div>
                     {isRestDay ?
                        <p className="text-gray-300 text-lg">Today is your rest day. Enjoy the recovery!</p> :
                        <div className="space-y-4">
                           <button onClick={() => handleFetchWorkout(false)} className="w-full px-8 py-4 bg-cyan-600 rounded-xl font-bold text-lg hover:bg-cyan-500 transition-transform hover:scale-105">Let's Go!</button>
                           <button onClick={() => handleFetchWorkout(true)} className="w-full px-8 py-4 bg-gray-700 rounded-xl font-semibold text-lg hover:bg-gray-600 transition-transform hover:scale-105">I'm feeling tired today</button>
                        </div>
                    }
                </div>
            );
        }
        
         if (status === 'ready' && workoutPlan) {
            return (
                <div className="flex flex-col h-full w-full text-center">
                    <div>
                        <h2 className="text-3xl font-bold text-cyan-400">{workoutPlan.focus}</h2>
                        <p className="text-gray-400">{`4 Sets / ${workoutPlan.total_duration}`}</p>
                    </div>
                    <div className="flex-grow my-4 overflow-y-auto pr-2">
                        <ul className="space-y-3">
                            {workoutPlan.workout.map((ex, index) => (
                                <li key={index} className="p-3 bg-gray-700/50 rounded-lg text-left">
                                    <p className="font-semibold text-white">{ex.name}</p>
                                    <p className="text-sm text-gray-300">{ex.reps_sets_display}</p>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="space-y-3 pt-4 border-t border-gray-700">
                        <button onClick={handleStartWorkout} className="w-full px-8 py-4 bg-green-600 rounded-xl font-bold text-lg hover:bg-green-500 transition-transform hover:scale-105">Start Workout</button>
                        <button onClick={handleReset} className="w-full px-8 py-4 bg-gray-700 rounded-xl font-semibold text-lg hover:bg-gray-600">Go Back</button>
                    </div>
                </div>
            );
        }
        
         if (status === 'finished') {
            return (
                <div className="text-center">
                    <h2 className="text-4xl font-bold text-cyan-400 mb-4">Workout Complete!</h2>
                    <p className="text-gray-300 text-lg mb-8">You're one step closer to your goal. See you tomorrow.</p>
                    <button onClick={handleReset} className="px-8 py-4 bg-cyan-600 rounded-lg font-semibold hover:bg-cyan-500 transition-colors">Finish</button>
                </div>
            )
        }

        if (workoutPlan && (status === 'active_exercise' || status === 'active_rest' || status === 'active_set_rest' || status === 'paused')) {
            const currentExercise = workoutPlan.workout[currentExerciseIndex];
            const nextUpExercise = workoutPlan.workout[currentExerciseIndex + 1];
            const isLastExerciseInSet = currentExerciseIndex === workoutPlan.workout.length - 1;
            
            const getTimerLabel = () => {
                if (status === 'active_exercise' || (status === 'paused' && totalDuration !== REST_PERIOD_S && totalDuration !== SET_REST_PERIOD_S)) return "WORK";
                if (status === 'active_set_rest' || (status === 'paused' && totalDuration === SET_REST_PERIOD_S)) return "SET REST";
                return "REST";
            }
            const timerLabel = getTimerLabel();
            
            return (
                <div className="flex flex-col items-center justify-between h-full w-full text-center">
                    <div className="w-full">
                         <p className="text-gray-400 font-medium">
                            {timerLabel !== "WORK" ? `Set ${currentSet} / ${TOTAL_SETS}` : `Exercise ${currentExerciseIndex + 1} / ${workoutPlan.workout.length} · Set ${currentSet} / ${TOTAL_SETS}`}
                        </p>
                        <h2 className="text-2xl sm:text-3xl font-bold text-cyan-400 break-words px-2 mt-1">
                            {timerLabel === "WORK" ? currentExercise.name : "Rest & Prepare"}
                        </h2>
                        {timerLabel === "WORK" && <p className="text-gray-400">{currentExercise.reps_sets_display}</p>}
                    </div>
                    
                    <TimerCircle 
                        seconds={timer}
                        totalSeconds={totalDuration}
                        label={timerLabel}
                    />

                    <div className="w-full px-4 space-y-4">
                        <div className="bg-gray-700/50 p-3 rounded-lg min-h-[4rem]">
                            <p className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Up Next</p>
                            <p className="text-lg text-white font-medium">
                                 {
                                    (status === 'active_exercise' || (status === 'paused' && timerLabel === 'WORK'))
                                    ? (isLastExerciseInSet ? 'Long Rest' : 'Rest')
                                    : (nextUpExercise ? nextUpExercise.name : 'Finish Workout')
                                }
                            </p>
                        </div>

                        {(timerLabel === 'WORK') && <p className="text-center text-gray-300 min-h-[4em]">{currentExercise.instructions}</p>}

                        <div className="flex items-center justify-center gap-4">
                            <button onClick={handlePauseResume} className="w-20 h-20 flex items-center justify-center bg-gray-700 rounded-full text-3xl hover:bg-gray-600">
                                <i className={`fa-solid ${status === 'paused' ? 'fa-play' : 'fa-pause'}`}></i>
                            </button>
                            <button onClick={handleReset} className="w-20 h-20 flex items-center justify-center bg-red-600 rounded-full text-3xl hover:bg-red-500" title="End Workout">
                                <i className="fa-solid fa-stop"></i>
                            </button>
                        </div>
                    </div>
                </div>
            )
        }

        return null;
    };

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 font-sans">
            <div className="w-full max-w-md mx-auto bg-gray-800/50 backdrop-blur-sm rounded-3xl shadow-2xl p-6 sm:p-8 flex items-center justify-center min-h-[85vh]">
                {renderContent()}
            </div>
        </div>
    );
}