import time
import serial

ports_to_check = ['COM3', 'COM5', 'COM7', 'COM8']

for p in ports_to_check:
  print(f'Testing {p}...')
  try:
    ser = serial.Serial(p, 115200, timeout=1)
    time.sleep(1.5)  # Give it a moment to catch data
    line = ser.readline().decode('utf-8', errors='ignore').strip()
    if line:
      print(
          f' SUCCESS! Found data on {p} ---> Incoming packet: "{line}"'
      )
      ser.close()
      break
    else:
      print(f' Connected to {p}, but no data received yet.')
      ser.close()
  except Exception as e:
    print(f' Could not open {p} (might be incoming-only or busy).')