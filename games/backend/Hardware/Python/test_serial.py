import serial


PORT = 'COM7'
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=1)


def get_steering_angle():
  if ser.in_waiting > 0:
    line = ser.readline().decode('utf-8').strip()
    if line:

      try:
        pitch_str, roll_str = line.split(',')
  
        return float(pitch_str), float(roll_str)
      except ValueError:
        pass  
  return None, None


# example of how you may use it in pygame
while True:
  pitch, roll = get_steering_angle()

  if roll is not None:
   print(f'Steering Angle (Roll): {roll}°')
   print(f'Control Angle (Pitch): {pitch}°')
    