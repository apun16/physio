import serial
import msvcrt   # Windows keyboard input

ser = serial.Serial('COM7', 115200, timeout=1)
ser.reset_input_buffer()

print("Keys: c=center  l/r=roll limits  a/d=left/right limits  b=gyro recalibrate  q=quit")

while True:
    # --- send a command if a key was pressed ---
    if msvcrt.kbhit():
        key = msvcrt.getwch().lower()
        if key == 'q':
            break
        if key in 'clrabd':
            ser.write(key.encode())
            print(f'>> sent "{key}"')

    # --- read one complete line ---
    line = ser.readline().decode('utf-8', errors='ignore').strip()

    if not line:
        continue
    if line.startswith('#'):           # status message from the ESP32
        print(line)
        continue

    try:
        roll, pitch, yaw, steer, move_x = map(float, line.split(','))
    except ValueError:
        continue

    print(f'roll={roll:.1f}  steer={steer:.2f}  move_x={move_x:.2f}')