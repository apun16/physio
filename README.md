# Pulse Circuit

A hardware-ready pseudo-3D steering game built with Python and Pygame.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

## Controls

- Left / right arrow keys: steer
- A / D: steer
- Acceleration is automatic
- Escape: quit

The game consumes normalized steering through the `SteeringSource` protocol in
`main.py`. A future serial, Bluetooth, or HID adapter can replace
`KeyboardSteering` without changing the race simulation.

## Verify

```bash
python -m py_compile main.py
SDL_VIDEODRIVER=dummy python main.py --smoke-test
```