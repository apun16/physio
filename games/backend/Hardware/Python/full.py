import serial
import msvcrt   # Windows keyboard input

# --- CONFIGURATION ---
SERIAL_PORT = 'COM6'
BAUD_RATE = 115200

ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
ser.reset_input_buffer()

print("==========================================================================")
print("Keys: c=center  l/r=pitch limits  a/d=left/right  w/s=up/down")
print("      f=save resting FSR baseline  m=save max squeeze  b=recalibrate gyro  q=quit")
print("==========================================================================")

while True:
    # --- send a command if a key was pressed ---
    if msvcrt.kbhit():
        key = msvcrt.getwch().lower()
        if key == 'q':
            break
        # Added 'f' (rest FSR) and 'm' (max squeeze FSR) to allowed commands
        if key in 'clrabdwsfm':
            ser.write(key.encode())
            print(f'\r>> sent command "{key}"\n', end='')

    # --- read one complete line ---
    line = ser.readline().decode('utf-8', errors='ignore').strip()

    if not line:
        continue
    if line.startswith('#'):           # status message from the ESP32
        print(line)
        continue

    try:
        # Unpack 8 values: roll, pitch, yaw, steer, moveX, moveY, rawFsr, squeeze
        roll, pitch, yaw, steer, move_x, move_y, raw_fsr, squeeze = map(float, line.split(','))
        raw_fsr = int(raw_fsr)
        
        # Game 0-255 mapped byte value
        squeeze_255 = int(squeeze * 255)
    except ValueError:
        continue

    print(f'steer={steer:.2f} | X={move_x:.2f} | Y={move_y:.2f} | FSR={raw_fsr:4d} | squeeze={squeeze:.2f} ({squeeze_255:3d})')