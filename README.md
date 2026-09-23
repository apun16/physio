# physio

upper-body physiotherapy game that turns real-world movement into an interactive training world. Patients complete short exercises, receive immediate visual and haptic feedback, and unlock new challenges as their range of motion, control, and strength improve.

## The Core Loop

1. A patient chooses an exercise and calibration is performed for their current ability.
2. An IMU translates upper-body movement into a game avatar or vehicle on screen.
3. A force sensor measures squeezing or grip effort and turns it into an in-game action.
4. The patient completes a short challenge with live cues for trajectory, posture, range, and force.
5. The session is summarized with progress, consistency, and a recommended next step.

Measurements are normalized against the patient's calibration rather than a generic ideal. The system can therefore encourage improvement without punishing limited mobility.

## Three-Level Experience

### Level 1: Move

The patient guides a character through targets using an IMU. The game rewards smooth, controlled movement and makes the exercise understandable before adding complexity.

### Level 2: Steer

The patient drives a small car along a sequence of curves. The dashboard shows the current trajectory beside an optimal trajectory, allowing the patient to see overshoot, hesitation, and improvement in real time.

### Level 3: Control

The patient combines movement and force. A squeeze sensor controls an action inspired by a cookie-clicker mechanic while the IMU keeps the vehicle on course. The final level tests coordination, strength, and consistency together.

Each level unlocks after a configurable combination of completion, accuracy, smoothness, and safe force. Therapists can adjust thresholds and hide metrics that should not be shown to a particular patient.

## Technical Direction

```text
IMU + force sensor
	|
	v
sensor adapter -> calibration and smoothing -> game state
					     |
			 +-------------------+-------------------+
			 |                                       |
			 v                                       v
		    game renderer                         session metrics
			 |                                       |
			 +-------------------+-------------------+
					     v
				  progress and performance summary
```

The sensor adapter should expose a stable event format so simulated sensor data can drive the demo when hardware is unavailable. The processing layer should handle calibration, smoothing, range-of-motion normalization, force thresholds, and safe loss-of-signal behavior separately from the game logic.

## What Makes It More Than a Game

The experience produces interpretable rehabilitation signals instead of only a score:

- range of motion reached
- trajectory accuracy
- movement smoothness
- force consistency
- repetitions completed
- fatigue or performance change across a session

An OpenAI-powered performance summary can translate those measurements into a concise patient-facing recap and a therapist-facing session note. It should cite the measured values it used and clearly label observations as observations rather than medical diagnoses.

## Pulse Circuit (Level 2 Prototype)

A hardware-ready pseudo-3D steering game built with Python and Pygame, implementing the "Steer" level described above. Lives in `games/frontend/`.

### Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

### Controls

- Left / right arrow keys: steer
- A / D: steer
- Acceleration is automatic
- Escape: quit

The game consumes normalized steering through the `SteeringSource` protocol in
`main.py`. A future serial, Bluetooth, or HID adapter can replace
`KeyboardSteering` without changing the race simulation.

### Verify

```bash
python -m py_compile main.py
SDL_VIDEODRIVER=dummy python main.py --smoke-test
```

## Skyward Journey (Level 1)

Side-view Move session in the Next.js app. Link walks automatically; combat uses an input provider so IMU hardware can replace the laptop tester later. No Python process is required.

```bash
cd games/frontend
npm install
npm run dev
```

Open `/games/move`. Combat tester (not walking): `J/K/L` slash, `F` shield, `E` bow.

## Therapy Game Compiler

The patient-facing compiler lives at `/therapy`. It accepts pasted text, images, and PDFs, extracts text in the browser where possible, and uses OCR for image or scanned-document fallback. The review screen shows every exercise claim with its source snippet and confidence before a game can be created.

### Demo flow

```bash
cd games/frontend
npm install
npm run dev
```

1. Open `http://localhost:3000/therapy`.
2. Choose one of the synthetic demo notes or upload a PDF/image/text note.
3. Review the extracted body part, side, movement, dosage, holds, equipment, restrictions, and compensation warnings.
4. If the note conflicts or omits required information, answer the single clarification question using only instructions supplied by the therapist.
5. Select **Create My Game**, enable the laptop camera, and move once through the therapist-prescribed range during calibration.
6. Play Arc Runner, Fruit Catcher, or Sit Shapes. Camera confidence gates every scored attempt.

The included fixtures cover a clear shoulder exercise, conflicting typed/handwritten repetition counts, an incomplete shoulder note, a hand-closure note, and a seated leg-shape note. They are fictional and contain no patient data.

### Cloudflare Agent

`agent/` contains the durable `TherapyGameAgent`. One Durable Object instance is addressed per therapy session:

```text
/agents/therapy-game-agent/:sessionId
```

Set the Worker secret and deploy:

```bash
cd agent
npx wrangler secret put OPENAI_API_KEY
npm run check
npm run deploy
```

Set `THERAPY_AGENT_URL` in the Next.js server environment to the deployed Worker URL. Set `NEXT_PUBLIC_THERAPY_AGENT_URL` to the same origin only when live WebSocket confidence/session updates are enabled. Without that configuration, the frontend uses a deterministic, safety-constrained parser for the synthetic local demo.

The Agent uses the OpenAI Responses API with validated tool calls for claim extraction, conflict detection, clarification, GameSpec generation, calibration state, low-confidence pauses, unscorable attempts, and session summaries. The completion workflow persists summarized metrics only.

### Safety limits

- We transform therapist-provided instructions; we do not diagnose, prescribe, increase range, increase repetitions, or change treatment.
- Missing or conflicting required details block game launch.
- Raw camera video and landmarks remain in the browser by default. Only structured movement metrics and confidence events may be sent to the Agent.
- A repetition is never scored below the GameSpec confidence threshold.
- Webcam-only hand mode is labeled **hand-closure tracking**, not grip-strength measurement. Strength/hold scoring requires supported grip hardware.
- Calibration asks the patient to demonstrate only the range already prescribed by their therapist.

### Verify

```bash
cd games/frontend
npm test
npm run build

cd ../../agent
npm run check
```
