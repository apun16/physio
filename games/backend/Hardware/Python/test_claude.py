import serial

ser = serial.Serial('COM7', 115200, timeout=1)
ser.reset_input_buffer()

while True:
    line = ser.readline().decode('utf-8', errors='ignore').strip()

    # nothing received, or a status message from the ESP32: skip silently
    if not line or line.startswith('#'):
        continue

    try:
        roll, pitch, yaw, steer, move_x = map(float, line.split(','))
    except ValueError:
        continue  # incomplete or garbled line

    print(f'roll={roll:.1f}  steer={steer:.2f}  move_x={move_x:.2f}')
    # Game 1: wheel_angle = steer * 90
    # Game 2: car_x += move_x * speed