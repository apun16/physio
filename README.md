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
